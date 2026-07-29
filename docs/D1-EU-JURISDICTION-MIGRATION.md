# Moving `fjellrute-db` into Cloudflare's EU jurisdiction

**Status: done 2026-07-29, except the deletion in step 10.** Decided 2026-07-28
(Week 3) to do this now rather than later, and executed in one sitting as
intended.

Production runs on `fjellrute-db-eu` (`1d6f92bf-83c8-4dce-80f6-d20b4a09674b`),
jurisdiction `eu` confirmed, with a verified copy of all ten tables — row counts
matched, the `account` / `route` / `session` / `track` cascades survived, 7
migration records copied — deployed and smoke-tested through a real sign-in,
route save and delete. Step 7 needed a hand edit; see step 10 for why.

**One thing is left: `fjellrute-db` still exists, and must be deleted by
2026-08-05.** The dump is already gone. Step 9 (the privacy policy) was done and
deployed the same evening in `PRIVACY_VERSION` `2026-07-29`, version
`1d0855e9-0b33-42c4-a21d-6191080f93d1`, and confirmed by fetching the live
`/privacy.html`.

Not part of the migration but discovered by it: wrangler's add-a-binding prompt
had also left a **duplicate R2 binding** in `wrangler.jsonc`, which nothing
checked for and which therefore deployed unnoticed for far longer than the D1 one
survived. Removed 2026-07-29; see step 7's warning and §7 of
`docs/TODO_WEEK3.md`.

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
>
> **While you are in the file, check the other binding lists.** That prompt is not
> specific to D1, and nothing outside this script checks for duplicates. On
> 2026-07-29 the same artefact was found in `r2_buckets` — a second entry for
> `fjellrute-terrain` bound as `fjellrute_terrain` with `remote: true` — which had
> been deploying silently for some time precisely because no guardrail covered it.
> The tell, either way, is the bindings table `wrangler deploy` prints: one row per
> resource, or something added an entry you did not.

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

Then build and deploy — the policy text is not a runtime lookup, it ships in the
bundle and in the Worker, so an unbuilt edit changes nothing for users:

```sh
pnpm build && npx wrangler deploy
```

> **Done 2026-07-29.** Both harnesses pass, including
> `PASS bumping PRIVACY_VERSION re-gates an already-accepted account`. What was
> written is worth recording, because the obvious edit would have been wrong: the
> hedge was **narrowed, not deleted**. The jurisdiction restricts where the
> database is *stored*; it does not move the Worker, which still executes at
> whichever Cloudflare location is nearest the visitor. So §4 now states the
> storage restriction flatly — created in the EU jurisdiction, a restriction that
> can only be set at creation, not replicated to any other region — and then states
> the request-routing caveat as a specific fact, referring onward to the existing
> SCC and Data Privacy Framework safeguards in the same section. "Your data never
> leaves the EU" would have been the easy sentence, and false.

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
- Step 8 cutover (Worker deployed against `fjellrute-db-eu`): **2026-07-29**,
  ~22:00 CEST — deployed and smoke-tested (sign in, route library, save, delete)
- Dump `fjellrute-dump.sql` deleted by: **2026-08-05** — *deleted 2026-07-29*
- Old database `fjellrute-db` deleted by: **2026-08-05** (cutover + 7 days)

**How 2026-08-05 was arrived at.** The copy and the cutover happened within half
an hour of each other on 2026-07-29, so the two clocks that step 10 keeps separate
landed on the same date this time. That is a coincidence of a quick evening, not
the rule: had step 7 taken until the following week, the dump's deadline would
still have been 2026-08-05 while the old database's would have moved out with the
cutover. The rule is what is written above the lines.

The run did stop once, at step 7, because `wrangler.jsonc` had two
`database_name` keys — wrangler's own *"Would you like Wrangler to add it on your
behalf?"* prompt during the create had appended a second `d1_databases` entry
(`fjellrute_db_eu`, `remote: true`) alongside the real `DB` binding. The script
refuses to guess which one to rewrite, which is correct: the wrong guess deploys
production against the wrong database. The binding was swapped by hand, and step 8
then went through.

**The dump is already gone**, ahead of its deadline, which is the right direction
to be early in: it was 86 kB holding every account, email address and recorded GPS
track in the service, and once step 5 passed its only remaining value was a
rollback that `fjellrute-db` — untouched, every row present — provides better.

**`fjellrute-db` is the one thing still on a clock.** It is now the redundant
copy rather than production, so 2026-08-05 is a real deadline and not a
formality. Until then it is the rollback; after then it is just a second copy of
everyone's personal data, which is the storage-limitation problem this week's work
existed to remove. If you find that line still unstruck after 2026-08-05, the
deletion has been forgotten, which is exactly the failure this section exists to
prevent.

## Rollback

Before step 10, rollback is: put the old `database_id` and name back in
`wrangler.jsonc`, `npx wrangler deploy`, and the service is on the original
database again. Nothing else in the config depends on which database is bound.
