# Week 3 — status and what is left

**Week 3 of the launch plan (Jul 27 – Aug 2): GDPR + accounts hygiene.**
Written 2026-07-28. Companion to `WEEK3-GDPR-CHECK-2026-07-28.md`, which holds
the full audit and its reasoning; this file is the short list of what is done
and what still needs doing.

State of the tree at the time of writing: everything below is committed in
`98ac10c Week3 plan` and deployed — the live Worker answers
`GET /api/me/policies` with `401`, so the new code is in production, and
`https://fjellrute.no/` serves the new landing page.

---

## Done

**Policy-acceptance tracking (privacy policy §8).** Migration
`0007_policy_acceptance.sql` adds `acceptedTermsVersion`,
`acceptedPrivacyVersion` and `policiesAcceptedAt` to the user row.
`worker/auth.js` stamps the current versions when an account is created,
`worker/policies.js` serves `GET`/`PUT /api/me/policies`, and `src/Root.tsx`
re-presents the acceptance gate whenever the stored version is behind the
current one; declining signs the user out. The server decides what "current"
means and ignores whatever version the client claims to have accepted, so the
gate cannot be cleared for text the user never saw. No consent *history* is
kept — only the latest accepted version — which is deliberate under data
minimisation (art. 5(1)(c)) and is explained in the audit.

**Privacy policy bumped** and the two copies (`src/terms/privacy.ts`,
`worker/policyVersions.js`) kept in sync by a test rather than by memory.

**The OAuth home page.** `public/coming-soon.html` is now a real bilingual
landing page: the app name as the only `<h1>`, what Fjellrute is, what you can
do with it, what an account is for (including "Continue with Google"), the
safety disclaimer, and a link to the privacy policy. Nothing sits behind a
login. Both languages are static HTML and the script only *hides* one, so a
crawler that does not run JavaScript still sees the explanation.

**Google Search Console.** `fjellrute.no` carries the
`google-site-verification=zgnw5kNLNCDG_…` TXT record, and the two OAuth
findings about domain ownership and the login wall are gone.

**Inbound mail exists.** `contact@fjellrute.no` and `hei@fjellrute.no` forward
to `fjellrute@gmail.com` via Cloudflare Email Routing. Before this, the domain
had no MX records at all and both addresses bounced — which mattered because
`contact@` is the published GDPR contact in the privacy policy and terms, and
is also the contact identifier `worker/proxy.js` sends to MET and NVE.

**One production bug found and fixed.** `worker/policies.js` returned the
database write promise from inside a `try` instead of awaiting it. A returned
promise settles after the `try` has exited, so a failed write would have
skipped the `catch`: no log line, no JSON error body, just a bare 500. The same
pattern was in `routes.js`, `tracks.js`, `username.js` and `public.js`; all five
are fixed, with a test and a deliberate regression to keep it fixed.

**Test harnesses — `pnpm test`, six of them, all passing.** Account deletion
(JS + SQL), privacy-copy sync, policy acceptance (JS + SQL), landing page. The
SQL harnesses extract the real statements out of the Worker instead of keeping
their own copy, so they cannot drift from the code, and each one plants the
regression it exists to catch and fails if the check does not notice.

**The EU-jurisdiction migration is written but not run.**
`scripts/migrate-d1-to-eu.sh` performs the create-and-copy (a D1 jurisdiction
can only be set at creation time) and refuses to continue on an unconfirmed
jurisdiction, a row count that does not match, a lost foreign-key cascade, or a
leftover dump. It never deletes the old database. Because its commands cannot
be run from a review session, its guardrails are tested against a stub
`wrangler` over real SQLite in seven scenarios — five of them failure paths —
via `pnpm test:migration`.

---

## Still to do

### 1. Finish Google OAuth verification — two findings remain

Quoted from the console:

> * Your home page does not explain the purpose of your app.
> * The app name "Fjellrute" configured for your OAuth consent screen does not
>   match the app name on your home page.

Both are odd, because the live page does explain the purpose at length and its
only `<h1>` is exactly `Fjellrute`. Worth noting that the console labels these
as "issues found from the **previous** verification attempt" — they may simply
predate the deploy. In likely order:

1. **Check whether the review ran before or after the page went live.** If the
   verification attempt that produced these two findings was submitted before
   the deploy, they are stale. Reply in the verification email thread saying the
   home page is live with the changes, and point at the sections by name ("What
   Fjellrute is", "What you can do", "Accounts"). Then resubmit.
2. **Check the exact app name string.** Google Cloud console → **APIs &
   Services → OAuth consent screen → Branding** → *App name*. It has to match
   the home page character for character. `Fjellrute.no`, `fjellrute`,
   `Fjellrute Alpha`, or a stray trailing space would all trip this, and the
   project name is not the app name. The page says `Fjellrute`.
3. **Consider that Google wants the purpose tied to the Google data.** Their
   guidance asks the home page to describe what the app does *and* what it does
   with Google user data. The "Accounts" section mentions "Continue with
   Google" but never says which data is used or why. One added sentence would
   close that gap: sign-in with Google is offered so an account can be created,
   and only the name and email address are used, to identify the account.
4. **Consider how the "closed alpha" wording reads to a reviewer.** The Status
   section says the app is open to invited testers while it is being finished. A
   reviewer skimming for a working product may read that as a placeholder page,
   which is one of the things this check exists to reject. Softening the wording
   or adding a screenshot of the app would make it plainly a product page.

**This is not blocking the closed alpha.** With only the default
email/profile scopes, an unverified app still works; users see an "unverified
app" warning screen and there is a 100-user cap. Fine for invited testers.

### 2. Forwarded mail lands in Gmail's spam folder

Expected, and not a sign anything is misconfigured. When Cloudflare forwards a
message, the mail arrives at Gmail from Cloudflare's servers while still
claiming to be from the original sender, so the sender's SPF record does not
match the delivering server. Gmail treats a brand-new forwarding stream with
suspicion until it has some history.

- Create a Gmail filter: **Settings → Filters and blocked addresses → Create a
  new filter**, `To: contact@fjellrute.no`, then tick **Never send it to
  Spam**. The original `To:` survives forwarding, so this matches reliably.
  Repeat for `hei@fjellrute.no`.
- Mark the messages already in spam as **Not spam**, which also trains it.
- Do not add `fjellrute@gmail.com` to the domain's SPF record. It would not
  help — SPF is checked against the *sender's* domain, not yours.

**One side effect of setting up Email Routing, worth knowing about.** Cloudflare
added an SPF record at the root of the zone that lists only its own mail
servers: `v=spf1 include:_spf.mx.cloudflare.net ~all`. There was no root SPF
record before, and this one does not mention Resend. Outbound auth mail should
still be fine, because Resend's return path is `send.fjellrute.no` — which has
its own `v=spf1 include:amazonses.com ~all` — and the DKIM key at
`resend._domainkey.fjellrute.no` still signs as `fjellrute.no`, so DMARC passes
on DKIM alignment. Leave it alone unless verification or password-reset mail
starts landing in spam; if it does, this record is the first thing to look at,
and adding `include:amazonses.com` to it is the fix. Worth sending yourself a
password reset from the live site once, just to confirm nothing regressed.

### 3. Confirm migration 0007 is applied to the remote database

Cannot be checked from a review session. If it was not applied, the policy
endpoint will throw for a signed-in user (`no such column:
acceptedTermsVersion`) while everything else keeps working.

```sh
npx wrangler d1 migrations apply fjellrute-db --local
npx wrangler d1 migrations apply fjellrute-db --remote
```

Applying twice is safe; a migration already recorded is skipped. Then sign in
on the live site and confirm the acceptance gate appears once and does not come
back on reload.

### 4. Run the EU-jurisdiction migration

```sh
./scripts/migrate-d1-to-eu.sh --dry-run    # read what it plans to do
./scripts/migrate-d1-to-eu.sh              # then for real
```

It stops and tells you why rather than pressing on. Read the plan before
running it for real. `docs/D1-EU-JURISDICTION-MIGRATION.md` has the same steps
by hand if you would rather do it yourself. Afterwards, keep the old database
and the dump until the new one has served real traffic for a while.

### 5. Two dates to fill in

- `docs/AUTH_SETUP.md:202` — **Verified in Search Console on:** _____
- `docs/D1-EU-JURISDICTION-MIGRATION.md:252` — **Delete by:** _____ (the date
  the old, non-EU database gets deleted; setting it is the point)

### 6. Small repo cleanups

- `scripts/lib/__pycache__/swap-d1-binding.cpython-310.pyc` was committed in
  `98ac10c` by accident. Remove it and ignore the directory:
  `git rm --cached -r scripts/lib/__pycache__`, then add `__pycache__/` and
  `.pnpm-store/` to `.gitignore`.
- `.claude/settings.local.json` is untracked. Commit or ignore it, whichever
  you prefer.

### 7. Optional, worth knowing

- **Replying as `contact@fjellrute.no`.** Cloudflare Email Routing only
  receives. A reply to a GDPR request will come from your personal Gmail
  address and reveal it. Gmail's "send mail as" pointed at Resend's SMTP fixes
  that. Worth doing before the alpha opens; not blocking.
- **DMARC reports now arrive.** The `_dmarc` record's
  `rua=mailto:hei@fjellrute.no` used to be a dead address; now that it
  forwards, those daily XML reports will start showing up. If they are noise,
  drop the `rua=` part from the record.
- The policy is monitor-only (`p=none`). Tightening it to `quarantine` is a
  later decision, and only after the reports look clean.

---

## Unverified from here

Honest list of things stated above that a review session cannot check, so that
nobody later mistakes them for confirmed:

- whether migration `0007` has been applied to the **remote** D1 database;
- whether the D1 database is still outside the EU jurisdiction (the migration
  script checks this itself before doing anything);
- the exact *App name* string on the OAuth consent screen;
- whether the verification attempt that produced the two remaining findings ran
  before or after the landing page was deployed.

## How to check the state yourself

```sh
pnpm test                # the six harnesses: deletion, privacy, policies, landing
pnpm test:migration      # the EU migration script's guardrails, against a stub
pnpm build               # tsc -b && vite build
pnpm lint                # 8 pre-existing problems, none from Week 3
dig MX fjellrute.no      # should now list Cloudflare's three mail servers
```
