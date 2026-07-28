# Week 3 verification — GDPR + accounts hygiene (checked 2026-07-28)

Audit of the four Week 3 deliverables in `Fjellrute-Launch-Plan.md` line 52
against the actual state of the repository. Two were fully done, one was done
except for a specific missing statement, and one was not done and had a real
data-remnant bug behind it.

| Week 3 item | Verdict |
| --- | --- |
| Privacy policy page — *what's stored* | Done |
| Privacy policy page — *where (Cloudflare EU jurisdiction note)* | Done — region confirmed and written; **but no EU jurisdiction is set, see below** |
| Account deletion that actually deletes | Done — `DELETE /api/account` + complete manual path; **no UI yet** |
| E-mail only used for verification | Done |
| Publish Google OAuth consent screen | Done (2026-07-21) — two fields left to confirm |

> **Remediation, same day.** The data-remnant findings in section 2 are fixed:
> `docs/REMOVE_USER.md` now purges `invite_redemption`, the retention cron now
> purges both rate-limit tables, and the privacy policy discloses those
> counters in §2 and their cleanup in §5 (both languages, both the canonical
> `src/terms/privacy.ts` and the `public/privacy.html` mirror).
> `scripts/verify-deletion-sql.py` replays all of that SQL against a scratch
> SQLite copy of the schema and asserts the outcome — 22 checks, all passing.
> A self-service `DELETE /api/account` has since been added
> (`worker/account.js`), re-authenticating with the account's email address and
> its password where one exists. `scripts/verify-account-deletion.mjs` runs
> that endpoint's real deletion code against a scratch schema — including a
> negative control proving the leak scan can fail. The storage-location
> sentence is now written too, the region having been confirmed — but that
> lookup surfaced a decision with a deadline, in section 1. The endpoint still
> has no UI, so privacy policy §6 still correctly tells users to email.

## 1. Privacy policy — content done, location now written, jurisdiction open

The policy exists and is well past the "one screen" the plan allowed for.
`src/terms/privacy.ts` is the canonical bilingual source, versioned with
`PRIVACY_VERSION = '2026-07-16'`, rendered in-app by `TermsPage.tsx` (the
acceptance gate) and `TermsDialog.tsx` (the info dialog). A static mirror
lives at `public/privacy.html` and is present in the build as
`dist/privacy.html`, so `https://fjellrute.no/privacy.html` resolves — the
closed-alpha intercept in `worker/index.js` only captures the exact path `/`,
so the mirror is not shadowed by `coming-soon.html`.

My first pass compared the two by eye and called them equivalent. That was too
generous, as `scripts/verify-privacy-sync.mjs` — written afterwards, because
two hand-maintained copies of a versioned legal text is a standing trap — then
showed: the mirror's §6 linked the word "Datatilsynet" but dropped the
`datatilsynet.no` domain the canonical text spells out, and §4 used
typographic quotes where the canonical used straight ones. Both are now fixed
in the direction of the canonical text, and the script compares all eight
sections in both languages, exactly, and requires the mirror's date to equal
`PRIVACY_VERSION`. Run it with `pnpm test:privacy`.

On *what is stored* the policy is thorough and honest: account data, session
rows including IP and user-agent with the legitimate-interest basis spelled
out, saved routes and recorded tracks with the explicit warning that a track
reveals where you have been, the on-device-only handling of live GPS, the
single strictly-necessary cookie, and the third-party tile requests that leak
the client IP to Kartverket, NVE and AWS. Legal bases are cited per category.

One category was missing, found while enumerating the stores: `wrangler.jsonc`
sets `observability.enabled: true`, so Cloudflare's Workers Logs captures the
Worker's diagnostic output — including, now, the `console.log` in
`worker/account.js` recording which user id was deleted. Retention is three
days on the free plan and seven at most on any plan, so it is genuinely
short-lived, but it was disclosed nowhere and it means a log line can briefly
outlive the account it refers to. §5 now says so in both languages. The R2
bucket needed no disclosure: `fjellrute-terrain` holds generated terrain tiles
only, no personal data, which is worth stating here because "where is the data"
should be answered for every binding, not just the obvious one.

On *where* it originally said nothing: §4 named Cloudflare as the processor
that "hosts the application and the database" and covered US transfers with the
EU–US Data Privacy Framework plus SCCs, but no form of the words jurisdiction,
Europe, EU-only storage or region appeared in either file. That was the gap
`docs/LEGAL-REVIEW-2026-07-16.md` left open ("check where the D1 database is
physically located and consider Cloudflare's EU jurisdiction options").

`npx wrangler d1 info fjellrute-db` now answers it:

```
running_in_region      EEUR
jurisdiction           null
read_replication.mode  disabled
database_size          242 kB
created_at             2026-07-12
```

So the database primary sits in Cloudflare's Eastern Europe region — inside the
EU — with no read replicas anywhere else. §4 of both files now says that, and
declines to promise more: Cloudflare's network is global, and where data does
cross the Atlantic the DPF and SCC wording already in §4 is what covers it. The
Week 3 item is met.

### The jurisdiction is a decision with a deadline

`jurisdiction: null` is the interesting line. Cloudflare added jurisdictions to
D1 in November 2025: `--jurisdiction eu` constrains a database to run and store
data in EU data centres, which is a different and stronger thing than the region
this database happens to have landed in. `fjellrute-db` was created on
2026-07-12, after the feature shipped, without it.

It cannot be added later. Per Cloudflare's docs, "jurisdictions can only be set
on database creation and cannot be added or updated after the database exists."
Getting one means creating a second database and moving the data:

```sh
npx wrangler d1 create fjellrute-db-eu --jurisdiction eu
npx wrangler d1 export fjellrute-db --remote --output fjellrute-dump.sql
npx wrangler d1 execute fjellrute-db-eu --remote --file fjellrute-dump.sql
# then swap database_id in wrangler.jsonc and redeploy
```

Which is why this belongs in Week 3 rather than later. The database is 242 kB
with a day's traffic of one read and one write — the migration is a five-minute
export/import with nothing at stake. In week 10, with founding users' accounts,
routes and recorded tracks in it, the same operation means a maintenance window,
a dump containing everyone's personal data sitting on a laptop, and a real
chance of losing a write made during the swap. The cost of this decision only
ever goes up, and the window closes quietly.

It is a judgement call, not a compliance failure. EEUR is already in the EU, and
plenty of Norwegian services run on weaker footing than that. But "our database
is contractually restricted to the EU" is a sentence a route-planning service
holding GPS tracks may well want to be able to write — and it is the kind of
question a B2B customer or a Datatilsynet enquiry asks. If the answer should
ever be yes, do it this week; if not, record the decision here so the next
person does not have to rediscover it.

Either way, whether the §4 and §5 additions warrant bumping `PRIVACY_VERSION`
is still open — §8 promises material changes are presented for acceptance
again, so a bump makes every existing alpha user re-accept. That is cheap now
and expensive later, for the same reason.

## 2. Account deletion — not done, and the manual path leaves data behind

There is no user-facing deletion anywhere. Grepping `src/` for `deleteUser`,
`delete-account`, "Delete account" and "Slett konto" returns nothing; Better
Auth's `deleteUser` option is not enabled in `worker/auth.js` (the `user`
block only declares the `username` additional field); and `worker/index.js`
exposes no `DELETE` route for accounts — the endpoint list is
`/api/auth/*`, `/api/account-exists`, `/api/routes`, `/api/tracks`,
`/api/me/username` and `/api/public/*`. Privacy policy section 6 routes users
to `contact@fjellrute.no` and promises handling within a month, which does
satisfy GDPR Article 17 at solo-dev scale, but it is not "account deletion
that actually deletes" in the sense the plan means.

More importantly, the manual runbook does not delete everything. Three
findings, in order of seriousness.

**`invite_redemption` keeps the e-mail address forever.** *(Fixed.)* Migration 0006
creates `invite_redemption (id, code, email, redeemed_at)` with no foreign key
to `user` and therefore no cascade, and `worker/invite.js:66` inserts a row on
every successful sign-up. `docs/REMOVE_USER.md` purges `verification` and
`user` only, so after a "complete" deletion the person's e-mail address and
the timestamp they joined remained in D1 indefinitely. Since every alpha
account goes through the invite gate, this affected every founding user. The
runbook now carries the missing statement, which any future delete endpoint
must run too:

```sql
delete from invite_redemption where lower(email) = lower('someone@example.com');
```

The `invite_code` row itself is left alone: it holds no personal data, and its
`used_count` records that a code was spent, which remains true.

**Rate-limit tables accumulate IP addresses and are never purged.** *(Fixed.)* Migration
0005 creates `app_rate_limit`, keyed by strings that embed the client IP
verbatim — `account-exists:<ip>` at `worker/index.js:125` and
`invite-signup:<ip>` at line 295 — plus `rateLimit` for Better Auth's own
`/api/auth/*` throttling. The migration comment anticipated "a future cleanup
job" that had never been written: `purgeExpiredRows()` deleted expired
`session` and `verification` rows only. An IP address is personal data, so
these were indefinite IP logs — the same storage-limitation problem the cron
was added to solve for sessions, one table over. Both are now in the cron's
existing `env.DB.batch([...])`: `app_rate_limit` by `resetAt` (using the
`app_rate_limit_resetAt_idx` index that migration 0005 already provides), and
Better Auth's `rateLimit`, which has no expiry column, by `lastRequest` older
than 24 h — far beyond its longest configured window of 3600 s, so no live
throttle can be loosened.

**`docs/REMOVE_USER.md` is stale in a way that could mislead.** *(Fixed.)* It stated that
`wrangler.jsonc` sets `"remote": true` for the D1 binding, so `--remote`
targets "the same [database] `wrangler dev` uses". That is no longer true —
the D1 binding has no `remote` flag now and dev runs against an isolated local
copy (only the second R2 binding carries `remote: true`). It also listed only
`session`, `account` and `route` as cascading; `track` cascades too, via
migration 0002 — correct behaviour, but undocumented in the one place someone
would check before deleting a user's data. Both statements are corrected, the
lookup query now counts tracks as well as routes, and the verify step checks
all three tables that hold the address instead of only `user`.

### The endpoint

`DELETE /api/account` (`worker/account.js`) is the self-service path, added
after this audit. It requires a valid session, then two confirmations: the
caller must type their own email address, and — if the account has a password —
supply it, verified through the same `verifyPassword()` the sign-in path uses.
The typed address stops accidents; the password is the part that stops someone
holding only a borrowed session cookie.

Google-only accounts have no password to check, so for them the typed address
is the only guard. Closing that properly means emailing a one-time confirmation
link before deleting, the way Better Auth's own `deleteUser` flow works. That
is not built; meanwhile the endpoint is rate-limited to five attempts per IP per
hour, which also stops it being used as an unthrottled password oracle — it
sits outside `/api/auth/*` and therefore outside Better Auth's own limiter.

Deletion itself is one `env.DB.batch([...])` in `deleteAccountRows()`:
`verification` by identifier, `invite_redemption` by email, and `user` by id,
letting the existing cascades take `session`, `account`, `route` and `track`.
Better Auth's sign-out runs first so the response carries proper
cookie-clearing headers; if the delete then failed the caller would merely be
signed out, with the account intact.

**Not yet wired to any UI.** The endpoint exists but nothing in `src/` calls it,
so privacy policy §6 still correctly tells users to email — that sentence
should only be softened once there is a button.

## 3. E-mail only used for verification — done

`sendEmail()` has exactly two call sites, both in `worker/auth.js`: line 130
sends the password-reset message and line 150 the address-confirmation
message. There is no newsletter, marketing, digest or announcement path, and
no third-party audience or contact list — `worker/email.js` posts directly to
the Resend API per message. Privacy policy section 2 describes this accurately
("to send verification and password-reset emails") and section 4 discloses
Resend as the processor for it. Password reset is account security rather than
verification strictly speaking, but it is disclosed and is plainly necessary,
so the item is satisfied.

## 4. Google OAuth consent screen — published, two fields to confirm

`docs/AUTH_SETUP.md` records the work as done on 2026-07-21: the consent
screen was published to production, out of Testing mode, and the redirect URI
`https://fjellrute.no/api/auth/callback/google` was added to client
`14850983815-…apps.googleusercontent.com` (the same ID as `GOOGLE_CLIENT_ID`
in `wrangler.jsonc`). Scopes are the default e-mail/profile set, so no Google
review was required, and the week-10 lockout risk the plan warns about is
closed.

Two things cannot be verified from the repository and are worth a two-minute
look in the Google Cloud console, since the plan ties this item to the privacy
policy URL. First, that the consent screen's **privacy policy link** actually
points at `https://fjellrute.no/privacy.html` — nothing in the repo records
which URL was entered, and that link is the whole reason the static mirror
exists. Second, that the **application home page** field is set to a URL that
currently serves something sensible; the domain root serves
`coming-soon.html` during the closed alpha, which is fine, but the app itself
lives at `/alpha/`. Recording both values in `AUTH_SETUP.md` next to the
existing "Done" note would make this checkable next time.

## Summary of remaining work

Every item on the Week 3 checklist is now met. What is left is one decision that
expires, one two-minute confirmation, and one piece of UI.

**Decide on the EU jurisdiction this week** (section 1). Recreating
`fjellrute-db` with `--jurisdiction eu` is trivial at 242 kB and awkward once
founding users have tracks in it, and it cannot be done to an existing database
at all. Decide yes or no, and if no, write down why.

Confirm the consent screen's privacy-policy and home-page URLs in the Google
Cloud console and record them in `AUTH_SETUP.md` next to the existing "Done"
note, so the link between the two Week 3 items is checkable next time.

Wire a delete button to `DELETE /api/account` — an "Slett konto" action in
`AccountOverview.tsx` collecting the email confirmation and password — and then
soften the "email us for account deletion" sentence in privacy policy §6. Until
then the endpoint is unreachable for real users and §6 stays as it is.

## Keeping this honest

Whenever the policy text changes, run `pnpm test:privacy`; whenever the deletion
or retention SQL changes, run `pnpm test:deletion`. `pnpm test:gdpr` runs both.

`scripts/verify-privacy-sync.mjs` imports `PRIVACY` from the canonical
TypeScript source, strips the markup out of `public/privacy.html`, and requires
an exact match section by section in both languages, plus a mirror date equal to
`PRIVACY_VERSION`. Its negative controls plant a changed word, a dropped
paragraph and a stale date in the mirror and require each to be caught, so a
clean run means the comparison was actually live.

The deletion harnesses: `pnpm test:deletion`
rebuilds the schema from `migrations/` in memory and runs two harnesses:
`scripts/verify-account-deletion.mjs` imports `deleteAccountRows()` from
`worker/account.js` so the shipped code is what executes, then walks the live
schema asserting that no column of any table still contains the deleted
address — with a negative control that plants the address in an untouched table
to prove the scan can fail. `scripts/verify-deletion-sql.py` replays the cron
and runbook SQL, checking that expired data goes and live data stays. Both
include the substring trap the runbook warns about: deleting
`someone@example.com` must leave `one@example.com` untouched.
