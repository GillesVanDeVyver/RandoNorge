# Moving `fjellrute-db` into Cloudflare's EU jurisdiction

**Status: complete, 2026-07-29.** All ten steps, decided 2026-07-28 (Week 3) and
executed in one sitting as intended — including step 10, which was expected to
take another week and did not.

Production runs on `fjellrute-db-eu` (`1d6f92bf-83c8-4dce-80f6-d20b4a09674b`),
jurisdiction `eu` confirmed, with a verified copy of all ten tables — row counts
matched, the `account` / `route` / `session` / `track` cascades survived, 7
migration records copied — deployed and smoke-tested through a real sign-in,
route save and delete. Step 7 needed a hand edit; see step 10 for why.

**Nothing is left.** Step 9 (the privacy policy) was deployed the same evening in
`PRIVACY_VERSION` `2026-07-29`, version `1d0855e9-0b33-42c4-a21d-6191080f93d1`,
confirmed by fetching the live `/privacy.html` and by a real sign-in through the
re-presented acceptance gate. Step 10 is also done: both the dump and
`fjellrute-db` were deleted on 2026-07-29, seven days inside the deadline.

**Read the Rollback section before assuming this document describes a reversible
change.** It no longer is. The old database and the export taken from it are both
gone, so the rollback the earlier steps repeatedly promise does not exist any
more; the remaining recovery path is D1 Time Travel on `fjellrute-db-eu`.

Not part of the migration but discovered by it: wrangler's add-a-binding prompt
had also left a **duplicate R2 binding** in `wrangler.jsonc`, which nothing
checked for and which therefore deployed unnoticed for far longer than the D1 one
survived. Removed 2026-07-29; see step 7's warning, and the comment above
`r2_buckets` in `wrangler.jsonc`.

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

> **Answered on 2026-08-08 — no command needs it, and the flag does not exist.**
> This paragraph used to hedge that commands addressing a jurisdictional
> database might need `--jurisdiction eu` repeated on every invocation, the way
> jurisdictional R2 buckets do. They do not: wrangler only ever sends a
> `cf-r2-jurisdiction` header (grep `wrangler-dist/cli.js`), there is no D1
> equivalent, and the `d1` subcommands accept no `--jurisdiction` flag at all.
> Every remote command in this document ran against `fjellrute-db-eu` with a
> plain `--remote`.
>
> Remember the replacement instead, because it is the failure that actually
> happened: `7404 The database … could not be found` from a `d1` command means
> the **wrong Cloudflare account**, not a jurisdiction that needs declaring.
> Applying migration 0008 cost an afternoon on that distinction — see
> `deploy_instructions.md` → "Which Cloudflare account".

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
date, so a rollback does not depend on this file's history. (In this repository
that comment has since been relabelled as a historical record, because the
database it names was deleted the same evening — see Rollback. For a future run,
the instruction above is still the right one.)

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

Edit **both** `packages/core/src/terms/privacy.ts` and `apps/web/public/privacy.html`, in English and
Norwegian, bump `PRIVACY_VERSION` in **both** `packages/core/src/terms/privacy.ts` and
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
- Old database `fjellrute-db` deleted by: **2026-08-05** — *deleted 2026-07-29,
  the same evening as the cutover*

**How 2026-08-05 was arrived at.** The copy and the cutover happened within half
an hour of each other on 2026-07-29, so the two clocks that step 10 keeps separate
landed on the same date this time. That is a coincidence of a quick evening, not
the rule: had step 7 taken until the following week, the dump's deadline would
still have been 2026-08-05 while the old database's would have moved out with the
cutover. The rule is what is written above the lines.

**Both deletions happened the same evening, and the second one traded away the
safety margin the deadline existed to provide.** Written down plainly because the
dates above make it look like a schedule kept early rather than a step skipped.
The seven days were not about the deadline; they were about a class of fault that
only shows up under real use — a write path nobody smoke-tested, an index that
matters at 500 rows and not at 5, a migration record that is present but wrong.
The rollback window for that class of fault ended up being about twenty minutes,
which is how long passed between the cutover and the deletion.

Nothing has gone wrong, and the verification that preceded the cutover was genuine
— every row counted, every cascade checked, a real sign-in and a real write. The
point is only that verification and endurance answer different questions, and this
run answered the first one twice. If a future migration follows this document,
follow the deadline rather than this example: it costs nothing to let a database
sit for six more days, and it is the only part of the plan that cannot be
reconstructed afterwards.

The run did stop once, at step 7, because `wrangler.jsonc` had two
`database_name` keys — wrangler's own *"Would you like Wrangler to add it on your
behalf?"* prompt during the create had appended a second `d1_databases` entry
(`fjellrute_db_eu`, `remote: true`) alongside the real `DB` binding. The script
refuses to guess which one to rewrite, which is correct: the wrong guess deploys
production against the wrong database. The binding was swapped by hand, and step 8
then went through.

**The dump is gone**, ahead of its deadline, which is the right direction to be
early in: it was 86 kB holding every account, email address and recorded GPS track
in the service, and once step 5 passed its only remaining value was a rollback
that `fjellrute-db` provided better — while `fjellrute-db` existed.

**`fjellrute-db` is gone too.** Deleted 2026-07-29. Nothing in this document is
now waiting on a date, and there is exactly one copy of the data: production.

## Rollback

**There is no longer a rollback for this migration.** Both copies it depended on —
`fjellrute-db` and `fjellrute-dump.sql` — were deleted on 2026-07-29. The
`wrangler.jsonc` comment holding the old name and id is a historical record, not
an instruction: restoring those values would bind the Worker to a database that no
longer exists, and the failure would look like every query erroring at once.

`scripts/migrate-d1-to-eu.sh` still prints *"the old database is untouched and
still has every row"* and *"the old database still exists — step 10 is yours"*, and
that is **correct and should stay**. Those lines are printed during a run, at a
moment when the script has just created the new database from the old one, so the
old one necessarily exists. They describe the state at the time they appear, not
the state of this repository now. Do not "fix" them into agreeing with this
section; a future run needs them.

What remains is **D1 Time Travel**, which is a different and narrower thing. It
restores a *live* database to an earlier point in time from Cloudflare's own
write-ahead log, so it covers the faults that are actually plausible from here —
a bad migration, a mistaken bulk `UPDATE`, a deletion that took more rows than
intended. It does not cover a dropped database, and it is not a backup you hold a
copy of.

Confirm the window before relying on it, because it depends on the plan and is not
readable from this repository:

```sh
npx wrangler d1 time-travel info fjellrute-db-eu
npx wrangler d1 time-travel restore fjellrute-db-eu --timestamp <ISO-8601>
```

Check that *before* you need it, not after. A restore also rewinds the whole
database, so anything written between the chosen timestamp and now is lost —
recovering one deleted route by rewinding an hour would discard every other
account's hour as well.

**The tempting wrong answer is to keep a periodic SQL export.** A dump is a
plaintext file containing every account, email address and GPS track in the
service, and it lives wherever it was written — a laptop, a backup, a cloud sync
folder — outside every access control the application has. That is the
storage-limitation and data-minimisation problem this whole migration existed to
reduce, and it would be reintroduced in a worse form than the one that was
removed. If durable backup becomes a real requirement rather than a reflex, it
needs to be designed as one: encrypted, retained for a stated period, inside the
EU, and disclosed in privacy policy §4 alongside everything else that holds user
data.
