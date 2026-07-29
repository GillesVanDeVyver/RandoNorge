# Week 3 — done

**Week 3 of the launch plan (Jul 27 – Aug 2): GDPR + accounts hygiene. Finished
2026-07-29.** Committed in `98ac10c`, `d98226b`, `90d4118`, `28b7824`, `0b7f157`
and `cfecf1a`, and deployed as version `1d0855e9-0b33-42c4-a21d-6191080f93d1`.

This file was much longer while the work was in progress. The detail is not lost:
`git show cfecf1a:docs/TODO_WEEK3.md` has the full narrative,
`WEEK3-GDPR-CHECK-2026-07-28.md` has the audit and its reasoning, and
`D1-EU-JURISDICTION-MIGRATION.md` has the database move step by step.

## What shipped

Policy-acceptance tracking: migration `0007` stores the accepted terms and privacy
versions on the user row, the server decides what "current" means, and the gate
re-presents when a version moves. Confirmed working by a real sign-in after the
version bump — the first time that path had ever run against a live account.

The database moved into Cloudflare's EU jurisdiction. Production runs on
`fjellrute-db-eu` with a verified copy of everything, and privacy policy §4 now
states the restriction instead of hedging about it. It says the *storage*
restriction firmly and the request-routing caveat as a specific fact, because the
jurisdiction pins where data is stored and does not move the Worker.

The OAuth landing page explains what the app does and what it does with Google user
data, in both languages, as static HTML behind no login.

`contact@fjellrute.no` and `hei@fjellrute.no` receive mail, which they did not
before — the domain had no MX records, and `contact@` is the published GDPR contact.

One production bug fixed: five handlers returned a database write promise from
inside a `try`, so a failed write skipped the `catch` and became a bare 500.

Both redundant copies of user data are gone — the SQL dump and the old database.

## What is left

Nothing is on a deadline. In rough order of value:

1. **Commit the working tree.** The uncommitted diff is this rewrite, the
   `wrangler.jsonc` comment correction below, and nine stale
   `d1 migrations apply fjellrute-db` commands repointed to `fjellrute-db-eu`
   (seven `migrations/*.sql` headers and two in `wrangler.jsonc`'s own comment).
   Run `pnpm test` first.
2. **Exercise the five remaining sign-in flows.** Taking `/` away from the app and
   moving it to `/alpha/` broke six flows at once, and only sign-in has been tried
   on the live site. Still unverified: Google sign-in, email sign-up through the
   terms gate, resend-verification, forgot-password, password reset, sign-out. Do
   the password reset first — it also tells you whether Resend still delivers after
   Cloudflare added an SPF record at the zone root.
3. **Decide about the Google logo.** Branding verification has now been rejected
   three times, every finding an *absence* the page demonstrably contains. The only
   cost of failing is that the consent screen shows the URL instead of your logo,
   and the logo is the sole reason verification is required at all. Removing it
   (console → Branding → App logo → Remove) ends the requirement permanently.
   Nothing is blocked either way: no scope is sensitive, the app is in production,
   sign-in works.
4. **Stop forwarded mail landing in Gmail's spam folder.** Expected, not a
   misconfiguration: Cloudflare forwards while preserving the original sender, so
   SPF cannot match. Filter on `To: contact@fjellrute.no` → **Never send it to
   Spam**, repeat for `hei@`. These are the messages asking for alpha access.
5. **`.claude/settings.local.json` is untracked.** Commit it or ignore it; it is a
   preference about your own tooling, and until you pick one `git status` stays
   dirty.

Optional and known: replying as `contact@fjellrute.no` needs Gmail "send mail as"
via Resend SMTP, or your personal address is exposed in GDPR replies; DMARC reports
now arrive at `hei@` and can be turned off by dropping `rua=`; a screenshot on the
landing page would help if a reviewer still doubts the app exists.

## Two things not to get wrong later

**There is no rollback for the database move.** The old database and the export
were both deleted on 2026-07-29, so there is exactly one copy of the data. The old
name and id in `wrangler.jsonc` are a historical record — restoring them would bind
the Worker to a database that no longer exists. Recovery is D1 Time Travel, which
restores a live database to an earlier minute and cannot recover a dropped one. Run
`npx wrangler d1 time-travel info fjellrute-db-eu` once now, while nothing is
wrong. Do not answer this with a periodic SQL export: a plaintext file of every
account and GPS track is the problem this week reduced. See the Rollback section of
`D1-EU-JURISDICTION-MIGRATION.md`.

**Answer "no" when wrangler offers to add a binding on your behalf.** It appends a
second entry named after the resource with `"remote": true`, which points local dev
at production data. It did this twice: to `d1_databases`, where it stopped the
migration script, and to `r2_buckets`, where nothing checks for duplicates and it
therefore deployed unnoticed — how long is unknown, but it predates this week.
Both are removed. The tell is the bindings table `wrangler deploy` prints: one row
per resource.

## Toolchain

**Node ≥ 22.18, and `corepack enable pnpm`.** Neither requirement announces itself;
there is no `.nvmrc` and `engines` pins only the package manager. Three floors, in
order: Vite needs 22.12, `verify-account-deletion.mjs` needs `node:sqlite`
unflagged at 22.13, and `verify-privacy-sync.mjs` imports `src/terms/privacy.ts`
directly, which needs TypeScript stripping unflagged at 22.18. Below that,
`scripts/lib/type-stripping.mjs` re-execs with `--experimental-strip-types`, which
is why older versions appear to work. `npx pnpm@10.11.1 <cmd>` is the fallback that
installs nothing; a `(base)` conda prompt can shadow an installed `pnpm`.

## Checking the state

```sh
pnpm test                # deletion ×2, privacy, policies ×2, landing, appbase
pnpm test:migration      # the migration script's guardrails, against a stub
pnpm lint                # 8 pre-existing problems, none from Week 3
git status --short
npx wrangler d1 list                               # one database, in the EU
npx wrangler d1 info fjellrute-db-eu               # jurisdiction eu
npx wrangler d1 time-travel info fjellrute-db-eu   # the only recovery path
grep -h "PRIVACY_VERSION = " src/terms/privacy.ts worker/policyVersions.js
```

Both `PRIVACY_VERSION` lines must read `2026-07-29`. If they ever differ, every
signed-in user is either permanently gated or never gated — which is what
`pnpm test:policies` exists to prevent.
