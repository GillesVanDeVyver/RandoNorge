# Moving `fjellrute-db` into Cloudflare's EU jurisdiction

**Status: steps 1–6 done 2026-07-29, stopped at step 7.** Decided 2026-07-28
(Week 3) to do this now rather than later. Written to be executed in one sitting,
top to bottom.

`fjellrute-db-eu` exists at `1d6f92bf-83c8-4dce-80f6-d20b4a09674b`, jurisdiction
`eu` confirmed, with a verified copy of all ten tables (row counts matched, the
`account` / `route` / `session` / `track` cascades survived, 7 migration records
copied). **Production is still on `fjellrute-db`** — the run stopped before the
binding swap, so resume at step 7. Dates and the reason are in step 10.

## The short version

`scripts/migrate-d1-to-eu.sh` is these ten steps with the checks that are easy
to skip when typing them by hand late in the evening. Read this document first —
it is the authority on *why* each step is there — then:

```sh
scripts/migrate-d1-to-eu.sh --dry-run   # shows every command, changes nothing
scripts/migrate-d1-to-eu.sh             # asks before each change
```

It stops rather than continuing on: a jurisdiction it cannot confirm as `eu`, a
row count that does not match, a foreign-key cascade that did not survive the
copy, a `wrangler.jsonc` it cannot edit unambiguously, or a leftover dump from
an earlier run. It never deletes the old database or the dump — step 10 stays
manual — and never edits the privacy policy, which is a judgement about wording.

Every step is safe to re-run, and `--from N` resumes at one. The script's own
guardrails are tested by `pnpm test:migration`, which drives it against a stub
`wrangler` backed by two local SQLite files and requires each refusal above to
actually happen.

The steps below remain the reference for doing it by hand, and for
understanding what the script is doing when it stops.

## Why now

`npx wrangler d1 info fjellrute-db` reports `jurisdiction: null`. The database
happens to run in `EEUR` — Eastern Europe, inside the EU — but that is where
Cloudflare placed it, not a restriction it is held to. A jurisdiction is the
restriction, and per Cloudflare's docs it "can only be set on database creation
and cannot be added or updated after the database exists."

So this is a create-and-copy, and its cost scales with the data. Today the
database is 242 kB with one read and one write in the last 24 hours, and the
alpha has no users. Once founding users have accounts, routes and recorded GPS
tracks in it, the same operation means a maintenance window, a dump of
everyone's personal data sitting on a laptop, and a real risk of losing writes
made during the swap.

## Before you start

Confirm wrangler is authenticated — if `d1 info` returns
`Authentication error [code: 10000]` while still listing `d1 (write)` among the
token scopes, the OAuth token has expired:

```sh
npx wrangler logout && npx wrangler login
```

Write down the current database id so a rollback is possible:
`fc24cf1f-35c7-4c9d-8a5a-4de38a3865fb`.

Do the whole thing in one sitting. Between the export and the config swap, any
write that reaches the old database is lost, because the new one was copied
before it happened. The closed-alpha gate means this is currently theoretical,
which is exactly why now is the time.

## Step 1 — create the new database

```sh
npx wrangler d1 create fjellrute-db-eu --jurisdiction eu
```

Record the `database_id` it prints, then confirm the flag took effect:

```sh
npx wrangler d1 info fjellrute-db-eu
```

The output must show `jurisdiction eu`. If it shows `null`, stop — the database
was created without the restriction and, since jurisdiction cannot be added
later, the only fix is to delete it and repeat this step.

> Cloudflare's docs do not say whether commands addressing a jurisdictional
> database need `--jurisdiction eu` repeated on every invocation, the way
> jurisdictional R2 buckets do. If any command below fails to find
> `fjellrute-db-eu`, try appending `--jurisdiction eu` before assuming anything
> is wrong, and note here which commands needed it.

## Step 2 — export the old database

```sh
npx wrangler d1 export fjellrute-db --remote --output fjellrute-dump.sql
```

This dump contains every account, e-mail address and recorded GPS track in the
service. `.sql` is a committed file type in this repo (`migrations/`,
`scripts/`), so `git add -A` would have taken it happily; `.gitignore` now
excludes `*-dump.sql` for that reason. Keep the filename ending in `-dump.sql`,
and delete the file once step 5 has passed.

## Step 3 — read the dump before importing it

Two things to check, because they change what step 6 has to do:

```sh
grep -c "CREATE TABLE" fjellrute-dump.sql
grep -n "d1_migrations" fjellrute-dump.sql | head
```

The first should find the eleven tables `d1 info` counted. The second decides
step 6: if `d1_migrations` appears, the dump carries D1's record of which
migrations have run, and the new database will know it is up to date. If it does
not appear, the new database will believe no migration has ever run.

## Step 4 — import

```sh
npx wrangler d1 execute fjellrute-db-eu --remote --file fjellrute-dump.sql
```

## Step 5 — verify the copy before trusting it

Run this against both databases and compare. Every count must match.

```sh
npx wrangler d1 execute fjellrute-db --remote --command \
  'select (select count(*) from "user") as users,
          (select count(*) from "account") as accounts,
          (select count(*) from "session") as sessions,
          (select count(*) from "route") as routes,
          (select count(*) from "track") as tracks,
          (select count(*) from "invite_code") as codes,
          (select count(*) from "invite_redemption") as redemptions;'
```

```sh
npx wrangler d1 execute fjellrute-db-eu --remote --command \
  'select (select count(*) from "user") as users,
          (select count(*) from "account") as accounts,
          (select count(*) from "session") as sessions,
          (select count(*) from "route") as routes,
          (select count(*) from "track") as tracks,
          (select count(*) from "invite_code") as codes,
          (select count(*) from "invite_redemption") as redemptions;'
```

Also confirm the schema came across with its foreign keys intact — the whole
deletion story in `docs/REMOVE_USER.md` depends on the cascades:

```sh
npx wrangler d1 execute fjellrute-db-eu --remote --command \
  "select name, sql from sqlite_master where type = 'table' and sql like '%on delete cascade%';"
```

`session`, `account`, `route` and `track` should all appear.

## Step 6 — reconcile the migrations record

Only if step 3 found no `d1_migrations` in the dump. Left undone, the next
`wrangler d1 migrations apply` would try to replay 0001–0006 against a database
that already has those tables, and fail partway.

```sh
npx wrangler d1 migrations list fjellrute-db-eu --remote
```

If it lists every migration as unapplied while the tables plainly exist, insert
the bookkeeping rows by hand. Take the names from the **old database**, not from
`migrations/`:

```sh
npx wrangler d1 execute fjellrute-db --remote --command \
  'select name from d1_migrations order by name;'
```

What is true of the copy is exactly what was true of the original. A list typed
from the directory goes stale the moment a migration is added — this document
listed 0001–0006 until 0007 arrived — and claiming a migration ran when it did
not is the worse direction of error: the next `migrations apply` would skip it
forever.

```sh
npx wrangler d1 execute fjellrute-db-eu --remote --command \
  "insert or ignore into d1_migrations (name, applied_at) values
     ('0001_auth_and_routes.sql', datetime('now')),
     ('0002_tracks.sql',          datetime('now'));"   # …and the rest, verbatim
```

Then re-run `migrations list`. Anything still pending is a migration that never
ran on the old database either — right now that is `0007_policy_acceptance.sql`,
which should then be applied normally:

```sh
npx wrangler d1 migrations apply fjellrute-db-eu --remote
```

## Step 7 — point the Worker at it

In `wrangler.jsonc`, change `database_id` on the `DB` binding to the new id and
`database_name` to `fjellrute-db-eu`. Leave the old id in a comment with the
date, so a rollback does not depend on this file's history.

> **Expect the script to stop here, and expect a second binding to be the reason.**
> On 2026-07-29 it refused with *"expected exactly one database_name and one
> database_id, found 2 and 2"*. The extra pair was not stale config: answering
> **yes** to wrangler's *"Would you like Wrangler to add it on your behalf?"* in
> the create step writes a whole new `d1_databases` entry — binding
> `fjellrute_db_eu`, `remote: true` — next to the existing `DB` one. It also
> answers the *"connect to the remote resource for local dev?"* question yes,
> which is the setting the comment in `wrangler.jsonc` warns against. Say **no**
> to the add-on-your-behalf prompt and
> step 7 stays automatic. If you already said yes, the fix is to delete the added
> entry and edit `DB` in place, so the app keeps reaching its database through
> `env.DB`. Adopting the new binding name instead would mean renaming every
> `env.DB` in `worker/`, which is a larger change for no benefit.

The local dev database is keyed to the binding, so `wrangler dev` will start
against an empty one. Reapply the schema locally:

```sh
npx wrangler d1 migrations apply fjellrute-db-eu --local
```

## Step 8 — deploy and smoke-test

```sh
npx wrangler deploy
```

Then, against the deployed site: sign in, load the route library, save a route,
and delete it again. A read-only check is not enough — the point of failure
worth catching is a write path pointed at a database that no longer exists.

## Step 9 — strengthen the privacy policy

Only now, with `d1 info` showing `jurisdiction eu`, does the policy get to claim
the restriction. §4 currently says the database "is located in Cloudflare's
Eastern Europe region … Cloudflare's network is worldwide, however, so we cannot
promise that no data ever passes outside the EU". That hedge can become a
straight statement that the database is restricted to EU data centres.

Edit **both** `src/terms/privacy.ts` and `public/privacy.html`, in English and
Norwegian, bump `PRIVACY_VERSION` in **both** `src/terms/privacy.ts` and
`worker/policyVersions.js`, and run:

```sh
pnpm test:privacy && pnpm test:policies
```

The first fails if the two policy copies drift or if the mirror's date does not
match the new version; the second if the two version constants do. Bumping the
version re-presents the acceptance gate to every signed-in user, which is the
point of §8 — see the acceptance mechanism in `worker/policies.js`.

## Step 10 — delete the old database, and the dump

The old database is a complete second copy of everyone's personal data. Leaving
it parked indefinitely is the storage-limitation problem this week's work was
supposed to remove, one database over.

Keep it just long enough to be a rollback (a week is plenty at alpha scale). The
two deletions are not one action and should not wait for each other — the dump
stops being useful as soon as step 5 passes, while the old database stays useful
until the new one has served real traffic:

```sh
rm fjellrute-dump.sql                  # as soon as step 5 has passed
npx wrangler d1 delete fjellrute-db    # only after step 8 has held up
```

**Delete by:** **seven days after the cutover in step 8** — that is the rule;
write the actual date on the line below the moment you run the migration, because
an unwritten deadline is the one that slips.

- Copy made (steps 2–6 verified): **2026-07-29**, ~21:33 CEST
- Step 8 cutover (Worker deployed against `fjellrute-db-eu`): _____________
- Dump `fjellrute-dump.sql` deleted by: **2026-08-05** (copy + 7 days)
- Old database `fjellrute-db` deleted by: _____________ (cutover + 7 days)

**Why two of these are filled in and two are not.** The 2026-07-29 run got as far
as step 6 and then stopped at step 7: `wrangler.jsonc` had two `database_name`
keys, because wrangler's own *"Would you like Wrangler to add it on your behalf?"*
prompt during the create appended a second `d1_databases` entry (`fjellrute_db_eu`,
`remote: true`) alongside the real `DB` binding. The script refuses to guess which
one to rewrite, which is correct — the wrong guess deploys production against the
wrong database. So the copy exists and is verified, but **production is still
served by `fjellrute-db`** and the cutover has not happened.

That splits one clock into two, and they are not interchangeable:

- **The dump is a second copy of everyone's personal data, sitting on a laptop,
  starting 2026-07-29.** That clock runs now and is the reason 2026-08-05 is
  written above. It does not wait for the cutover, and it does not restart if the
  cutover slips. Step 2 above says to delete the dump once step 5 passes; step 5
  has passed, so the only thing the file still buys is a rollback that
  `fjellrute-db` — untouched, every row present — already provides better.
  Deleting it early is the right kind of early.
- **`fjellrute-db` cannot be deleted yet at all.** Before the cutover it is not
  the redundant copy, it is *the live production database*; `fjellrute-db-eu` is
  the spare. Dating its deletion from 2026-07-29 would put a deadline on deleting
  the database the service is actually running on. Its line stays blank until
  step 8, then becomes cutover + 7.

If you find the cutover line still blank days from now, the migration has stalled
half-done, which is its own small problem: two live databases holding the same
personal data, one of them serving nothing. If you find the *deletion* lines still
blank after the cutover, the deletion has been forgotten, which is exactly the
failure this section exists to prevent.

## Rollback

Before step 10, rollback is: put the old `database_id` and name back in
`wrangler.jsonc`, `npx wrangler deploy`, and the service is on the original
database again. Nothing else in the config depends on which database is bound.
