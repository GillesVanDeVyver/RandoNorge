"""Run the real policy-acceptance SQL against a throwaway in-memory SQLite
database built from migrations/*.sql.

D1 is SQLite, so the statements in worker/policies.js can be exercised against
the real schema without touching a database that matters. They are *extracted
from the Worker source* rather than retyped here: a copy would drift, and a
drifted copy passing is worse than no check at all.

What this protects, which nothing else can:

  * the three columns from migration 0007 exist and start out null, so an
    account created before the migration is treated as "has not accepted"
    rather than silently credited with an acceptance it never gave;
  * the UPDATE's placeholders and the Worker's .bind() list are the same
    length — add a column to one and not the other and the only sign is a D1
    error at runtime, on the request that records consent;
  * the UPDATE is scoped to one user id and touches nothing but those three
    columns and "updatedAt";
  * the acceptance lives on the user row and nowhere else, so deleting an
    account takes the consent record with it (GDPR art. 17) and there is no
    second copy to forget about.

    python3 scripts/verify-policy-sql.py

Wired into `pnpm test:policies`, alongside scripts/verify-policy-acceptance.mjs
which covers the JavaScript-shaped invariants.
"""

import glob
import os
import re
import sqlite3
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAIL = []


def check(label, got, want):
    ok = got == want
    print(f"  {'PASS' if ok else 'FAIL'}  {label}: got {got!r}, want {want!r}")
    if not ok:
        FAIL.append(label)


def ok(label, condition, detail=""):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}")
    if not condition:
        if detail:
            print(f"        {detail}")
        FAIL.append(label)


# ===========================================================================
# Pull the statements out of the Worker.
#
# Each one is written as adjacent single-quoted literals joined by `+` so the
# source stays inside the line limit, e.g.
#
#     await env.DB.prepare(
#       'update "user" set "acceptedTermsVersion" = ?, ' +
#         '"acceptedPrivacyVersion" = ?, ... where id = ?',
#     )
#       .bind(TERMS_VERSION, PRIVACY_VERSION, now, now, userId)
#
# so: find each `env.DB.prepare(`, walk forward counting parentheses to its
# match, concatenate the single-quoted pieces inside, then read the .bind()
# arguments that follow. The literals contain only double quotes, so a plain
# quote-pair scan is enough — there is nothing to escape.
# ===========================================================================
source = open(os.path.join(REPO, "worker", "policies.js")).read()


def prepared_statements(js):
    out = []
    for m in re.finditer(r"env\.DB\.prepare\(", js):
        i = m.end()
        depth = 1
        while i < len(js) and depth:
            if js[i] == "(":
                depth += 1
            elif js[i] == ")":
                depth -= 1
            i += 1
        inner = js[m.end() : i - 1]
        sql = " ".join(re.findall(r"'([^']*)'", inner))
        sql = re.sub(r"\s+", " ", sql).strip()
        # The .bind(...) call that follows, if any.
        tail = js[i : i + 400]
        bm = re.search(r"^\s*\)?\s*\.bind\(([^)]*)\)", tail, re.S)
        binds = []
        if bm:
            binds = [a.strip() for a in bm.group(1).split(",") if a.strip()]
        out.append((sql, binds))
    return out


statements = prepared_statements(source)
print(f"extracted {len(statements)} statement(s) from worker/policies.js")
for sql, binds in statements:
    print(f"  {sql}")
    print(f"    bound: {', '.join(binds) or '(none)'}")

# Two and only two. A third statement would be doing something to the
# acceptance record that this file has not been told about.
ok("worker/policies.js prepares exactly two statements", len(statements) == 2,
   "if that changed on purpose, add the new statement to this harness")
if len(statements) != 2:
    sys.exit(1)

selects = [s for s in statements if s[0].lower().startswith("select")]
updates = [s for s in statements if s[0].lower().startswith("update")]
ok("one is a select and one is an update",
   len(selects) == 1 and len(updates) == 1)
if not (selects and updates):
    sys.exit(1)
SELECT_SQL, SELECT_BINDS = selects[0]
UPDATE_SQL, UPDATE_BINDS = updates[0]

# The extractor is regex-shaped, so prove it found real SQL rather than an
# empty string that would make every execute() below vacuously fine.
ok("the extracted SQL is real", 'from "user"' in SELECT_SQL
   and 'update "user" set' in UPDATE_SQL.lower(),
   f"select={SELECT_SQL!r} update={UPDATE_SQL!r}")

# ===========================================================================
print("\n[binds] every placeholder is given a value")
for what, sql, binds, n in (
    ("select", SELECT_SQL, SELECT_BINDS, 1),
    ("update", UPDATE_SQL, UPDATE_BINDS, 5),
):
    check(f"{what}: placeholders", sql.count("?"), n)
    check(f"{what}: bound values", len(binds), n)

# Order matters and SQLite will not complain: swap two same-typed binds and
# the terms version lands in the privacy column.
check("update binds the versions in column order",
      UPDATE_BINDS[:2], ["TERMS_VERSION", "PRIVACY_VERSION"])
check("update binds the user id last", UPDATE_BINDS[-1], "userId")
check("select binds the user id", SELECT_BINDS, ["userId"])

# ===========================================================================
print("\n[scope] the update touches only what it should")
set_clause = re.search(r"set (.*?) where ", UPDATE_SQL, re.I).group(1)
set_columns = re.findall(r'"([^"]+)"\s*=\s*\?', set_clause)
check("columns assigned", sorted(set_columns), sorted([
    "acceptedTermsVersion", "acceptedPrivacyVersion",
    "policiesAcceptedAt", "updatedAt",
]))
ok('the update is scoped by "where id = ?"',
   re.search(r"where id = \?\s*$", UPDATE_SQL) is not None,
   "an unscoped update would record one user's acceptance for everybody")
ok('"updatedAt" is maintained', "updatedAt" in set_columns,
   "Better Auth writes this column on every change; leaving it stale here "
   "makes the row look untouched")

# ===========================================================================
# The schema, from the real migrations.
# ===========================================================================
db = sqlite3.connect(":memory:")
db.executescript("PRAGMA foreign_keys = ON;")
migrations = sorted(glob.glob(os.path.join(REPO, "migrations", "*.sql")))
if not migrations:
    sys.exit("no migrations found — run this from inside the repo")
for path in migrations:
    with open(path) as fh:
        db.executescript(fh.read())
print(f"\nschema applied from {len(migrations)} migrations")

one = lambda q, p=(): db.execute(q, p).fetchone()[0]
COLUMNS = ["acceptedTermsVersion", "acceptedPrivacyVersion", "policiesAcceptedAt"]
user_columns = {r[1]: r for r in db.execute('pragma table_info("user")')}

print("\n[schema] migration 0007 landed")
for col in COLUMNS:
    ok(f'"user" has "{col}"', col in user_columns)
    if col in user_columns:
        _, _, _, notnull, default, _ = user_columns[col]
        ok(f'"{col}" is nullable with no default',
           not notnull and default is None,
           "a default would manufacture consent for pre-existing accounts")

# Nowhere else. A second copy is a second thing to delete on erasure.
elsewhere = [
    (t, c) for (t,) in db.execute(
        "select name from sqlite_master where type='table'")
    for c in [r[1] for r in db.execute(f'pragma table_info("{t}")')]
    if c in COLUMNS and t != "user"
]
check("no other table stores an accepted version", elsewhere, [])

# ===========================================================================
print("\n[null] an account created before 0007 has not accepted anything")
NOW_ISO = "2026-07-28T09:00:00.000Z"
for uid in ("u1", "u2"):
    db.execute(
        'insert into "user" (id,name,email,emailVerified,createdAt,updatedAt,username)'
        " values (?,?,?,0,?,?,?)",
        (uid, uid, f"{uid}@example.com", NOW_ISO, NOW_ISO, uid),
    )
db.commit()

row = db.execute(SELECT_SQL, ("u1",)).fetchone()
check("the select returns three columns", len(row), 3)
check("all three are null for an untouched row", list(row), [None, None, None])

# readState()'s rule, applied to that row: null != the current version, so the
# gate is presented. This is the case that must not silently pass as accepted.
#
# These two are stand-ins, not the real constants — whether the app and the
# Worker agree on the current version is verify-policy-acceptance.mjs's job,
# and duplicating it here would just be a third copy to bump. What matters
# below is the *shape* of the comparison, which is the same for any label.
TERMS_VERSION = "0000-01-01"
PRIVACY_VERSION = "0000-01-02"
stale = row[0] != TERMS_VERSION or row[1] != PRIVACY_VERSION
ok("null counts as stale, so the gate is shown", stale)

# ===========================================================================
print("\n[accept] the update records exactly one acceptance")
db.execute(UPDATE_SQL, (TERMS_VERSION, PRIVACY_VERSION, NOW_ISO, NOW_ISO, "u1"))
db.commit()

row = db.execute(SELECT_SQL, ("u1",)).fetchone()
check("accepted terms version stored", row[0], TERMS_VERSION)
check("accepted privacy version stored", row[1], PRIVACY_VERSION)
check("acceptance timestamp stored", row[2], NOW_ISO)
ok("the row is no longer stale",
   not (row[0] != TERMS_VERSION or row[1] != PRIVACY_VERSION))
check('"updatedAt" was bumped', one('select "updatedAt" from "user" where id=?',
                                    ("u1",)), NOW_ISO)
check("the other account is untouched",
      list(db.execute(SELECT_SQL, ("u2",)).fetchone()), [None, None, None])
check("nothing else on the row changed",
      list(db.execute('select name,email,username from "user" where id=?',
                      ("u1",)).fetchone()),
      ["u1", "u1@example.com", "u1"])

# ===========================================================================
print("\n[bump] a new policy version makes a stored acceptance stale again")
# This is privacy policy §8's promise. The staleness rule is equality, so a
# bumped constant re-presents the gate without any migration or backfill.
bumped = "0000-02-01"
ok("bumping PRIVACY_VERSION re-gates an already-accepted account",
   row[1] != bumped,
   "equality comparison is what makes the re-acceptance gate work at all")
db.execute(UPDATE_SQL, (TERMS_VERSION, bumped, NOW_ISO, NOW_ISO, "u1"))
db.commit()
check("accepting the new text clears it",
      db.execute(SELECT_SQL, ("u1",)).fetchone()[1], bumped)

# ===========================================================================
print("\n[erasure] deleting the account deletes the consent record")
db.execute('delete from "user" where id = ?', ("u1",))
db.commit()
check("no acceptance survives the user row",
      one('select count(*) from "user" where "acceptedTermsVersion" is not null'),
      0)
check("the select finds nothing for a deleted user",
      db.execute(SELECT_SQL, ("u1",)).fetchone(), None)

# ===========================================================================
# Negative controls. Every check above is only as good as the extraction, and
# a regex that quietly matches nothing reports success forever.
# ===========================================================================
print("\n[control] the checks detect the regressions they exist for")

unscoped = prepared_statements(
    source.replace('"updatedAt" = ? where id = ?', '"updatedAt" = ?'))
unscoped_update = [s for s, _ in unscoped if s.lower().startswith("update")]
ok("an unscoped UPDATE would be caught",
   bool(unscoped_update)
   and re.search(r"where id = \?\s*$", unscoped_update[0]) is None)

missing_bind = prepared_statements(
    source.replace(".bind(TERMS_VERSION, PRIVACY_VERSION, now, now, userId)",
                   ".bind(TERMS_VERSION, PRIVACY_VERSION, now, userId)"))
missing = [b for s, b in missing_bind if s.lower().startswith("update")]
ok("a dropped bind value would be caught",
   bool(missing) and len(missing[0]) != UPDATE_SQL.count("?"),
   f"planted bind list: {missing}")

swapped = prepared_statements(
    source.replace(".bind(TERMS_VERSION, PRIVACY_VERSION,",
                   ".bind(PRIVACY_VERSION, TERMS_VERSION,"))
swap = [b for s, b in swapped if s.lower().startswith("update")]
ok("swapped version binds would be caught",
   bool(swap) and swap[0][:2] != ["TERMS_VERSION", "PRIVACY_VERSION"])

extra_column = prepared_statements(
    source.replace('"updatedAt" = ? where id = ?',
                   '"updatedAt" = ?, "email" = ? where id = ?'))
extra = [s for s, _ in extra_column if s.lower().startswith("update")]
extra_cols = re.findall(r'"([^"]+)"\s*=\s*\?',
                        re.search(r"set (.*?) where ", extra[0], re.I).group(1))
ok("an extra column in the SET clause would be caught",
   "email" in extra_cols)

ok("the extractor returns nothing when there is nothing to find",
   prepared_statements("const x = 1;") == [])

print("\n" + ("ALL CHECKS PASSED — consent is recorded per account, scoped, "
              "and erasable" if not FAIL else f"{len(FAIL)} FAILED: {FAIL}"))
sys.exit(1 if FAIL else 0)
