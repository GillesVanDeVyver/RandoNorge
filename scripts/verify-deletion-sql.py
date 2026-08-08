"""Dry-run the retention-cron purge and the REMOVE_USER.md deletion SQL
against a throwaway in-memory SQLite database built from migrations/*.sql.

D1 is SQLite, so this exercises the real statements against the real schema
without touching a database that matters. Run it after changing either
purgeExpiredRows() in worker/index.js or the deletion steps in
docs/REMOVE_USER.md — the two places where wrong SQL means either an IP log
that never expires or a "deleted" account whose email address is still in
the database.

    python3 scripts/verify-deletion-sql.py

Checks:
  1. the cron deletes expired sessions/tokens and spent rate-limit buckets
     while leaving live sessions and still-active buckets alone,
  2. the REMOVE_USER.md statements remove every trace of one user's email,
     including the non-cascading verification and invite_redemption rows,
  3. a second user whose address is a substring of the first is untouched.
"""

import glob
import os
import sqlite3
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAIL = []


def check(label, got, want):
    ok = got == want
    print(f"  {'PASS' if ok else 'FAIL'}  {label}: got {got!r}, want {want!r}")
    if not ok:
        FAIL.append(label)


db = sqlite3.connect(":memory:")
db.executescript("PRAGMA foreign_keys = ON;")
migrations = sorted(glob.glob(os.path.join(REPO, "migrations", "*.sql")))
if not migrations:
    sys.exit("no migrations found — run this from inside the repo")
for path in migrations:
    with open(path) as fh:
        db.executescript(fh.read())
print("schema applied from {} migrations: {}".format(
    len(migrations),
    ", ".join(sorted(
        r[0] for r in
        db.execute("select name from sqlite_master where type='table'")
    )),
))

NOW_MS = 1_800_000_000_000          # arbitrary "now" in epoch ms
NOW_ISO = "2027-01-15T12:00:00.000Z"
DAY_MS = 24 * 60 * 60 * 1000

TARGET = "Someone@Example.com"      # mixed case on purpose
OTHER = "one@example.com"           # substring-collision trap from the runbook

# --- two users -------------------------------------------------------------
for uid, email in (("u1", TARGET), ("u2", OTHER)):
    db.execute(
        'insert into "user" (id,name,email,emailVerified,createdAt,updatedAt,username)'
        " values (?,?,?,1,?,?,?)",
        (uid, uid, email, NOW_ISO, NOW_ISO, uid),
    )
    db.execute(
        'insert into "account" (id,accountId,providerId,userId,createdAt,updatedAt)'
        " values (?,?,?,?,?,?)",
        (f"a-{uid}", email, "credential", uid, NOW_ISO, NOW_ISO),
    )
    db.execute(
        'insert into "route" (id,userId,name,geometry,createdAt,updatedAt)'
        " values (?,?,?,?,?,?)",
        (f"r-{uid}", uid, "tur", "{}", NOW_ISO, NOW_ISO),
    )
    db.execute(
        'insert into "track" (id,userId,routeId,name,geometry,startedAt,finishedAt,createdAt)'
        " values (?,?,?,?,?,?,?,?)",
        (f"t-{uid}", uid, f"r-{uid}", "opptak", "{}", NOW_ISO, NOW_ISO, NOW_ISO),
    )
    db.execute(
        'insert into "invite_redemption" (code,email) values (?,?)',
        ("ALPHA1", email),
    )
    # An in-app feedback message. replyTo carries the address on purpose: it is
    # the one column of migration 0008 that can hold personal data beyond the
    # userId, so it is what the leak scan below has to find if the cascade ever
    # stops working.
    db.execute(
        'insert into "feedback" (id,userId,message,replyTo,createdAt)'
        " values (?,?,?,?,?)",
        (f"f-{uid}", uid, "skiene sporer ikke", email, NOW_ISO),
    )
    # one expired session (epoch-ms form) and one live session (ISO form)
    db.execute(
        'insert into "session" (id,expiresAt,token,createdAt,updatedAt,ipAddress,userAgent,userId)'
        " values (?,?,?,?,?,?,?,?)",
        (f"s-old-{uid}", NOW_MS - DAY_MS, f"tok-old-{uid}", NOW_ISO, NOW_ISO,
         "203.0.113.7", "curl", uid),
    )
    db.execute(
        'insert into "session" (id,expiresAt,token,createdAt,updatedAt,ipAddress,userAgent,userId)'
        " values (?,?,?,?,?,?,?,?)",
        (f"s-live-{uid}", "2099-01-01T00:00:00.000Z", f"tok-live-{uid}", NOW_ISO,
         NOW_ISO, "203.0.113.8", "Firefox", uid),
    )

# --- verification tokens, incl. the prefixed reset form --------------------
for ident, expires in (
    (TARGET, NOW_MS - 1),                       # expired, bare address
    (f"reset-password:{TARGET}", "2099-01-01"),  # live, prefixed
    (OTHER, "2099-01-01"),                       # live, the other user
):
    db.execute(
        'insert into "verification" (id,identifier,value,expiresAt,createdAt,updatedAt)'
        " values (?,?,?,?,?,?)",
        (f"v-{ident}", ident, "x", expires, NOW_ISO, NOW_ISO),
    )

# --- rate-limit buckets ----------------------------------------------------
db.execute('insert into "app_rate_limit" (key,count,resetAt) values (?,?,?)',
           ("account-exists:203.0.113.7", 3, NOW_MS - 1))          # spent
db.execute('insert into "app_rate_limit" (key,count,resetAt) values (?,?,?)',
           ("invite-signup:203.0.113.9", 1, NOW_MS + 60_000))      # still active
db.execute('insert into "rateLimit" (id,key,count,lastRequest) values (?,?,?,?)',
           ("rl-old", "/sign-in/email:203.0.113.7", 5, NOW_MS - 2 * DAY_MS))
db.execute('insert into "rateLimit" (id,key,count,lastRequest) values (?,?,?,?)',
           ("rl-new", "/sign-in/email:203.0.113.9", 2, NOW_MS - 60_000))
db.commit()

# ==========================================================================
print("\n[1] retention cron (worker/index.js purgeExpiredRows)")
expired_sql = """delete from "{}" where (case
     when typeof("expiresAt") = 'text' then "expiresAt" < ?1
     else "expiresAt" < ?2
   end)"""
db.execute(expired_sql.format("session"), (NOW_ISO, NOW_MS))
db.execute(expired_sql.format("verification"), (NOW_ISO, NOW_MS))
db.execute('delete from "app_rate_limit" where "resetAt" < ?', (NOW_MS,))
db.execute('delete from "rateLimit" where "lastRequest" < ?', (NOW_MS - DAY_MS,))
db.commit()

one = lambda q, p=(): db.execute(q, p).fetchone()[0]
check("expired sessions purged", one("select count(*) from session where id like 's-old-%'"), 0)
check("live sessions kept", one("select count(*) from session where id like 's-live-%'"), 2)
check("expired token purged", one("select count(*) from verification where expiresAt < ?", (NOW_MS,)), 0)
check("live tokens kept", one("select count(*) from verification"), 2)
check("spent app bucket purged", one("select count(*) from app_rate_limit where key like 'account-exists:%'"), 0)
check("active app bucket kept", one("select count(*) from app_rate_limit where key like 'invite-signup:%'"), 1)
check("stale auth bucket purged", one("select count(*) from rateLimit where id='rl-old'"), 0)
check("recent auth bucket kept", one("select count(*) from rateLimit where id='rl-new'"), 1)

# ==========================================================================
print("\n[2] account deletion (docs/REMOVE_USER.md step 2)")
db.execute(
    "delete from verification where lower(identifier) = lower(?)"
    " or lower(identifier) like '%:' || lower(?)", (TARGET, TARGET))
db.execute("delete from invite_redemption where lower(email) = lower(?)", (TARGET,))
db.execute("delete from user where lower(email) = lower(?)", (TARGET,))
db.commit()

check("user row gone", one("select count(*) from user where lower(email)=lower(?)", (TARGET,)), 0)
check("sessions cascaded", one("select count(*) from session where userId='u1'"), 0)
check("account cascaded", one("select count(*) from account where userId='u1'"), 0)
check("route cascaded", one("select count(*) from route where userId='u1'"), 0)
check("track cascaded", one("select count(*) from track where userId='u1'"), 0)
check("feedback cascaded", one("select count(*) from feedback where userId='u1'"), 0)
check("invite_redemption purged", one("select count(*) from invite_redemption where lower(email)=lower(?)", (TARGET,)), 0)
check("reset token purged", one("select count(*) from verification where identifier like '%'||?", (TARGET,)), 0)
addr = TARGET.lower()
leaks = [t for (t, c) in (("user", "email"), ("invite_redemption", "email"),
                          ("verification", "identifier"), ("account", "accountId"),
                          ("feedback", "replyTo"))
         if one(f'select count(*) from "{t}" where lower("{c}") like ?', (f"%{addr}%",))]
check("no table still contains the address", leaks, [])

print("\n[3] the other user is untouched")
check("other user present", one("select count(*) from user where email=?", (OTHER,)), 1)
check("other user's live token kept", one("select count(*) from verification where identifier=?", (OTHER,)), 1)
check("other user's redemption kept", one("select count(*) from invite_redemption where email=?", (OTHER,)), 1)
check("other user's route kept", one("select count(*) from route where userId='u2'"), 1)
check("other user's track kept", one("select count(*) from track where userId='u2'"), 1)
check("other user's feedback kept", one("select count(*) from feedback where userId='u2'"), 1)

print("\n[4] verify query from REMOVE_USER.md step 3")
row = db.execute("""
  select
    (select count(*) from user              where lower(email)      = lower(?1)) as users,
    (select count(*) from invite_redemption where lower(email)      = lower(?1)) as redemptions,
    (select count(*) from verification      where lower(identifier) = lower(?1)
        or lower(identifier) like '%:' || lower(?1))                             as tokens
""", (TARGET,)).fetchone()
check("verify query returns all zeros", list(row), [0, 0, 0])

print("\n" + ("ALL CHECKS PASSED" if not FAIL else f"{len(FAIL)} FAILED: {FAIL}"))
sys.exit(1 if FAIL else 0)
