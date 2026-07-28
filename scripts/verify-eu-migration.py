"""Drive scripts/migrate-d1-to-eu.sh against a stub wrangler and check that it
does the right thing — including refusing to.

The script it tests will be run once, by hand, against the production database,
and several of its steps cannot be undone: a database created without the
jurisdiction cannot be fixed, and a binding swapped after a bad import points
the service at incomplete data. So the guardrails matter more than the happy
path, and a guardrail nobody has watched fire is a guess.

The stub is a small `wrangler` that keeps two real SQLite files in a temp
directory and answers the handful of subcommands the script uses, in wrangler's
JSON shapes. That makes the export/import/verify cycle real — actual SQL, an
actual dump, actual row counts — while `deploy` and `login` are stubs, since
there is nothing local to point them at.

Scenarios, each from a clean temp directory:

  1. happy path        — runs to the end; the binding is swapped, the counts
                         match, the migration records are copied
  2. jurisdiction null — the create silently produced an unrestricted database:
                         must stop before exporting anything
  3. count mismatch    — the import lost rows: must stop before the swap
  4. missing cascade   — the copy dropped a foreign key: must stop before the
                         swap, because account deletion depends on it
  5. leftover dump     — a previous run's copy of everyone's data is still on
                         disk: must stop and say so
  6. dry run           — changes nothing at all

    python3 scripts/verify-eu-migration.py
"""

import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAIL = []

OLD_ID = "old-id-0000"
NEW_ID = "new-id-1111"

# The stub. Written out as a file so the script under test can exec it exactly
# as it would exec the real thing.
STUB = r'''#!/usr/bin/env python3
"""A fake `wrangler` over two SQLite files. Only what the script calls."""
import json, os, sqlite3, sys

STATE = os.environ["STUB_STATE"]
OLD, NEW = "fjellrute-db", "fjellrute-db-eu"
IDS = {OLD: "%OLD_ID%", NEW: "%NEW_ID%"}


def path(name):
    return os.path.join(STATE, name + ".sqlite")


def log(*parts):
    with open(os.path.join(STATE, "calls.log"), "a") as fh:
        fh.write(" ".join(parts) + "\n")


def jurisdiction(name):
    f = os.path.join(STATE, name + ".jurisdiction")
    return open(f).read().strip() if os.path.exists(f) else "null"


def die(msg):
    sys.stderr.write(msg + "\n")
    sys.exit(1)


args = sys.argv[1:]
log(*args)

if args[:1] == ["whoami"]:
    print("stub user")
    sys.exit(0)

if args[:1] == ["deploy"]:
    open(os.path.join(STATE, "deployed"), "w").close()
    print("deployed (stub)")
    sys.exit(0)

if args[:2] == ["d1", "info"]:
    name = args[2]
    if not os.path.exists(path(name)):
        die(f"no such database: {name}")
    body = {"uuid": IDS.get(name, "?"), "name": name,
            "num_tables": 0, "jurisdiction": jurisdiction(name)}
    if jurisdiction(name) == "absent":
        del body["jurisdiction"]        # older wrangler: not reported at all
    if "--json" in args:
        print(json.dumps(body))
    else:
        for k, v in body.items():
            print(f"{k} {v}")
    sys.exit(0)

if args[:2] == ["d1", "create"]:
    name = args[2]
    sqlite3.connect(path(name)).close()
    want = "eu" if "--jurisdiction" in args else "null"
    # The whole point of scenario 2: the flag was passed and did not take.
    if os.environ.get("STUB_CREATE_JURISDICTION"):
        want = os.environ["STUB_CREATE_JURISDICTION"]
    with open(os.path.join(STATE, name + ".jurisdiction"), "w") as fh:
        fh.write(want)
    print(json.dumps({"uuid": IDS[name], "name": name, "jurisdiction": want}))
    sys.exit(0)

if args[:2] == ["d1", "export"]:
    name = args[2]
    out = args[args.index("--output") + 1]
    db = sqlite3.connect(path(name))
    with open(out, "w") as fh:
        for line in db.iterdump():
            fh.write(line + "\n")
    sys.exit(0)

if args[:2] == ["d1", "execute"]:
    name = args[2]
    if not os.path.exists(path(name)):
        die(f"no such database: {name}")
    db = sqlite3.connect(path(name))
    # Foreign keys stay off for a file import: a dump lists tables
    # alphabetically, so the child rows arrive before the parent table exists.
    # This is why D1's own import guidance is to defer them.
    if "--file" in args:
        sql = open(args[args.index("--file") + 1]).read()
        if os.environ.get("STUB_LOSE_ROWS"):
            # Scenario 3: the import drops some rows, as a truncated dump or a
            # half-failed import would.
            sql = "\n".join(l for l in sql.splitlines()
                            if not l.startswith("INSERT INTO \"route\""))
        if os.environ.get("STUB_DROP_CASCADE"):
            # Scenario 4: the schema arrives without its foreign keys.
            sql = sql.replace("on delete cascade", "")
        db.executescript(sql)
        db.commit()
        print(json.dumps([{"success": True, "results": []}]))
        sys.exit(0)
    command = args[args.index("--command") + 1]
    db.execute("PRAGMA foreign_keys = ON")
    try:
        cur = db.executescript(command) if command.count(";") > 1 \
            else db.execute(command)
    except sqlite3.Error as exc:
        die(f"D1 error: {exc}")
    rows = []
    if cur is not None and cur.description:
        keys = [d[0] for d in cur.description]
        rows = [dict(zip(keys, r)) for r in cur.fetchall()]
    db.commit()
    print(json.dumps([{"success": True, "results": rows}]))
    sys.exit(0)

if args[:3] == ["d1", "migrations", "apply"]:
    print("applied (stub)")
    sys.exit(0)

die("stub wrangler: unhandled command: " + " ".join(args))
'''.replace("%OLD_ID%", OLD_ID).replace("%NEW_ID%", NEW_ID)

# A miniature of the real schema: enough tables to compare, and the cascades
# the deletion story depends on.
SEED = """
create table "user" (id text primary key, email text, username text);
create table "account" (id text primary key, userId text not null
  references "user"(id) on delete cascade);
create table "session" (id text primary key, userId text not null
  references "user"(id) on delete cascade);
create table "route" (id text primary key, userId text not null
  references "user"(id) on delete cascade);
create table "track" (id text primary key, userId text not null
  references "user"(id) on delete cascade);
create table "invite_code" (code text primary key);
create table "invite_redemption" (id integer primary key, email text);
create table d1_migrations (id integer primary key autoincrement,
  name text unique, applied_at datetime);
insert into "user" values ('u1','a@example.com','a'), ('u2','b@example.com','b');
insert into "account" values ('a1','u1'), ('a2','u2');
insert into "session" values ('s1','u1');
insert into "route" values ('r1','u1'), ('r2','u1'), ('r3','u2');
insert into "track" values ('t1','u1');
insert into "invite_code" values ('ALPHA1');
insert into "invite_redemption" values (1,'a@example.com');
insert into d1_migrations (name, applied_at) values
  ('0001_auth_and_routes.sql','x'), ('0002_tracks.sql','x'),
  ('0006_invite_codes.sql','x');
"""

CONFIG = """{
	"name": "fjellrute",
	// A comment that must survive the rewrite.
	"d1_databases": [
		{
			"binding": "DB",
			"database_name": "fjellrute-db",
			"database_id": "%s",
			"migrations_dir": "migrations"
		}
	]
}
""" % OLD_ID


def check(label, got, want):
    good = got == want
    print(f"  {'PASS' if good else 'FAIL'}  {label}: got {got!r}, want {want!r}")
    if not good:
        FAIL.append(label)


def ok(label, condition, detail=""):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}")
    if not condition:
        if detail:
            print(f"        {detail}")
        FAIL.append(label)


def scenario(name, *, env=None, args=(), jurisdiction="eu", leftover_dump=False):
    """Run the script in a fresh sandbox. Returns (result, workdir, state)."""
    work = tempfile.mkdtemp(prefix="eu-mig-")
    state = os.path.join(work, "state")
    os.makedirs(state)

    # A repo-shaped directory: the script cds to its own parent, so the script
    # and its helpers are copied in rather than run from the real repo.
    os.makedirs(os.path.join(work, "scripts", "lib"))
    os.makedirs(os.path.join(work, "migrations"))
    for rel in ("scripts/migrate-d1-to-eu.sh", "scripts/lib/d1-rows.py",
                "scripts/lib/swap-d1-binding.py"):
        shutil.copy(os.path.join(REPO, rel), os.path.join(work, rel))
    for mig in ("0001_auth_and_routes.sql", "0002_tracks.sql",
                "0006_invite_codes.sql", "0007_policy_acceptance.sql"):
        open(os.path.join(work, "migrations", mig), "w").write("-- stub\n")
    open(os.path.join(work, "wrangler.jsonc"), "w").write(CONFIG)
    open(os.path.join(work, ".gitignore"), "w").write("*-dump.sql\n")
    if leftover_dump:
        open(os.path.join(work, "fjellrute-dump.sql"), "w").write("-- old\n")

    stub = os.path.join(work, "wrangler-stub")
    with open(stub, "w") as fh:
        fh.write(STUB)
    os.chmod(stub, 0o755)

    db = sqlite3.connect(os.path.join(state, "fjellrute-db.sqlite"))
    db.executescript(SEED)
    db.commit()
    db.close()
    with open(os.path.join(state, "fjellrute-db.jurisdiction"), "w") as fh:
        fh.write("null")

    environ = dict(os.environ)
    environ.update({
        "STUB_STATE": state,
        "WRANGLER": f"{sys.executable} {stub}",
        "OLD_ID": OLD_ID,
    })
    if jurisdiction != "eu":
        environ["STUB_CREATE_JURISDICTION"] = jurisdiction
    environ.update(env or {})

    print(f"\n[{name}]")
    result = subprocess.run(
        ["bash", os.path.join(work, "scripts", "migrate-d1-to-eu.sh"),
         "--yes", *args],
        cwd=work, env=environ, capture_output=True, text=True,
    )
    return result, work, state


def rows(state, db, sql):
    conn = sqlite3.connect(os.path.join(state, db + ".sqlite"))
    try:
        return conn.execute(sql).fetchall()
    finally:
        conn.close()


def show(result, when):
    print("        --- script output ---")
    for line in (result.stdout + result.stderr).splitlines():
        print("        " + line)
    print(f"        --- ({when}) ---")


# ===========================================================================
# 1. Happy path.
# ===========================================================================
result, work, state = scenario("happy path")
if result.returncode != 0:
    show(result, "expected success")
check("exit status", result.returncode, 0)
ok("reached the end", "step 10" in result.stdout, result.stdout[-400:])

ok("the new database was created with --jurisdiction eu",
   "d1 create fjellrute-db-eu --jurisdiction eu"
   in open(os.path.join(state, "calls.log")).read())
ok("jurisdiction eu was confirmed before continuing",
   "jurisdiction eu confirmed" in result.stdout)

for table, count in (("user", 2), ("route", 3), ("track", 1),
                     ("invite_redemption", 1)):
    check(f"copied rows: {table}",
          rows(state, "fjellrute-db-eu", f'select count(*) from "{table}"')[0][0],
          count)
ok("every row count matched", "every row count matches" in result.stdout)
ok("cascades were checked", "cascades intact" in result.stdout)

copied = [r[0] for r in rows(state, "fjellrute-db-eu",
                             "select name from d1_migrations order by name")]
check("migration records copied from the old database", copied,
      ["0001_auth_and_routes.sql", "0002_tracks.sql", "0006_invite_codes.sql"])
ok("0007 was NOT claimed as applied", "0007_policy_acceptance.sql" not in copied,
   "it never ran on the old database, so the new one must still see it as pending")

config = open(os.path.join(work, "wrangler.jsonc")).read()
ok("the binding now names the EU database",
   '"database_name": "fjellrute-db-eu"' in config)
ok("the binding now carries the new id", f'"database_id": "{NEW_ID}"' in config)
ok("the old values are left in a rollback comment",
   f'"database_id": "{OLD_ID}",' in config and "Rollback" in config)
ok("the JSONC comments survived", "must survive the rewrite" in config)
ok("a backup of the config was kept",
   any(f.startswith("wrangler.jsonc.bak-") for f in os.listdir(work)))
ok("the Worker was deployed", os.path.exists(os.path.join(state, "deployed")))
ok("the old database still exists",
   os.path.exists(os.path.join(state, "fjellrute-db.sqlite")),
   "step 10 is the human's, never the script's")
ok("the dump was not deleted",
   os.path.exists(os.path.join(work, "fjellrute-dump.sql")))
ok("the script says so", "step 10 is yours" in result.stdout)

# ===========================================================================
# 2. The create silently produced an unrestricted database.
# ===========================================================================
result, work, state = scenario("jurisdiction did not take", jurisdiction="null")
check("exit status", result.returncode, 1)
ok("stopped with an explanation",
   "without the EU jurisdiction" in result.stderr, result.stderr[-300:])
ok("said to delete and retry", "d1 delete fjellrute-db-eu" in result.stderr)
ok("nothing was exported",
   not os.path.exists(os.path.join(work, "fjellrute-dump.sql")))
ok("the binding was not touched",
   f'"database_id": "{OLD_ID}"' in open(os.path.join(work, "wrangler.jsonc")).read())

# A jurisdiction wrangler will not report at all is also not good enough.
result, work, state = scenario("jurisdiction not reported", jurisdiction="absent")
check("exit status", result.returncode, 1)
ok("refused to assume", "did not report a jurisdiction" in result.stderr,
   result.stderr[-300:])

# ===========================================================================
# 3. The import lost rows.
# ===========================================================================
result, work, state = scenario("import lost rows", env={"STUB_LOSE_ROWS": "1"})
check("exit status", result.returncode, 1)
ok("the count comparison caught it", "row counts differ" in result.stderr,
   result.stderr[-400:])
ok("did not swap the binding",
   f'"database_name": "fjellrute-db"' in open(os.path.join(work, "wrangler.jsonc")).read())
ok("did not deploy", not os.path.exists(os.path.join(state, "deployed")))

# ===========================================================================
# 4. The copy arrived without its cascades.
# ===========================================================================
result, work, state = scenario("cascades lost", env={"STUB_DROP_CASCADE": "1"})
check("exit status", result.returncode, 1)
ok("the cascade check caught it",
   "cascade" in result.stderr.lower(), result.stderr[-400:])
ok("did not deploy", not os.path.exists(os.path.join(state, "deployed")))

# ===========================================================================
# 5. A previous run's dump is still lying around.
# ===========================================================================
result, work, state = scenario("leftover dump", leftover_dump=True)
check("exit status", result.returncode, 1)
ok("refused to start", "already exists" in result.stderr, result.stderr[-300:])
ok("explained what the file is",
   "personal data" in result.stderr)
ok("did not create the new database",
   not os.path.exists(os.path.join(state, "fjellrute-db-eu.sqlite")))

# ===========================================================================
# 6. --dry-run changes nothing.
# ===========================================================================
result, work, state = scenario("dry run", args=("--dry-run",))
check("exit status", result.returncode, 0)
ok("said it was a dry run", "DRY RUN" in result.stdout)
ok("created no database",
   not os.path.exists(os.path.join(state, "fjellrute-db-eu.sqlite")))
ok("wrote no dump", not os.path.exists(os.path.join(work, "fjellrute-dump.sql")))
ok("left the config alone",
   open(os.path.join(work, "wrangler.jsonc")).read() == CONFIG)
ok("did not deploy", not os.path.exists(os.path.join(state, "deployed")))
ok("showed the commands it would run", "(dry)" in result.stdout)

# ===========================================================================
# 7. The config rewriter, on the file that actually ships.
# ===========================================================================
print("\n[real wrangler.jsonc]")
sys.path.insert(0, os.path.join(REPO, "scripts", "lib"))
import importlib.util

spec = importlib.util.spec_from_file_location(
    "swap", os.path.join(REPO, "scripts", "lib", "swap-d1-binding.py"))
swap_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(swap_mod)

real = open(os.path.join(REPO, "wrangler.jsonc")).read()
swapped = swap_mod.swap(real, "fjellrute-db-eu", NEW_ID, today="2026-07-28")
ok("the real config can be rewritten unambiguously",
   f'"database_id": "{NEW_ID}"' in swapped
   and '"database_name": "fjellrute-db-eu"' in swapped)
live_ids = [line for line in swapped.splitlines()
            if re.match(r'^\s*"database_id"', line)]
check("exactly one live database_id line remains", len(live_ids), 1)
ok("the surviving one is the new id", NEW_ID in live_ids[0], live_ids[0])
ok("the old id is preserved in a comment",
   re.search(r'//\s+"database_id": "fc24cf1f-', swapped) is not None)
ok("every comment line in the original survives",
   all(line in swapped for line in real.splitlines() if line.strip().startswith("//")))
ok("nothing but the binding block changed",
   len(swapped.splitlines()) == len(real.splitlines()) + 4)

# Negative control: a second D1 binding must make it refuse rather than guess.
two = real.replace('"migrations_dir": "migrations"',
                   '"migrations_dir": "migrations"\n\t\t},\n\t\t{\n'
                   '\t\t\t"binding": "DB2",\n'
                   '\t\t\t"database_name": "other",\n'
                   '\t\t\t"database_id": "x",\n'
                   '\t\t\t"migrations_dir": "migrations"')
try:
    swap_mod.swap(two, "fjellrute-db-eu", NEW_ID)
    ok("a second binding is refused", False, "it guessed instead")
except SystemExit as exc:
    ok("a second binding is refused", "found 2 and 2" in str(exc), str(exc))

print("\n" + ("ALL CHECKS PASSED — the migration copies, verifies, and refuses"
              if not FAIL else f"{len(FAIL)} FAILED: {FAIL}"))
sys.exit(1 if FAIL else 0)
