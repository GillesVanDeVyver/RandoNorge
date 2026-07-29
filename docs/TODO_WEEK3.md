# Week 3 — status and what is left

**Week 3 of the launch plan (Jul 27 – Aug 2): GDPR + accounts hygiene.**
First written 2026-07-28, revised 2026-07-29. Companion to
`WEEK3-GDPR-CHECK-2026-07-28.md`, which holds the full audit and its reasoning;
this file is the short list of what is done and what still needs doing.

> **Read this first — the tree is no longer what it was on 2026-07-28.**
> Everything described in the 2026-07-28 version of this file was committed in
> `98ac10c` and live. The 2026-07-29 revision then made further changes to the
> landing page, its test, two docs and `.gitignore`, and **those changes are
> neither committed nor deployed.** `dist/` has been rebuilt from them, so the
> build output on disk is ahead of production too. The live site still serves
> the 2026-07-28 landing page. Nothing here reaches a Google reviewer until you
> review the diff, commit, and `npx wrangler deploy`.

---

## Done

### From 2026-07-28 (committed in `98ac10c`, deployed)

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

**The OAuth home page.** `public/coming-soon.html` became a real bilingual
landing page: the app name as the only `<h1>`, what Fjellrute is, what you can
do with it, what an account is for, the safety disclaimer, and a link to the
privacy policy. Nothing sits behind a login. Both languages are static HTML and
the script only *hides* one, so a crawler that does not run JavaScript still
sees the explanation.

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

**The EU-jurisdiction migration is written but not run.**
`scripts/migrate-d1-to-eu.sh` performs the create-and-copy (a D1 jurisdiction
can only be set at creation time) and refuses to continue on an unconfirmed
jurisdiction, a row count that does not match, a lost foreign-key cascade, or a
leftover dump. It never deletes the old database. Because its commands cannot
be run from a review session, its guardrails are tested against a stub
`wrangler` over real SQLite in seven scenarios — five of them failure paths —
via `pnpm test:migration`.

### From 2026-07-29 (uncommitted, undeployed)

**The home page now says what it does with Google user data** — the gap that
was §1.3 of the old to-do list. The "Konto" / "Accounts" sections gained a
second paragraph, in both languages, saying that "Continue with Google" exists
so an account can be created without a separate password; that Fjellrute
receives only the name and email address; that those are used solely to identify
the account; that no access to Gmail, Drive, contacts or calendar is requested;
and that Google data is never used for advertising, sold on, or used to train
models. Google's guidance asks the home page to describe what the app does *and*
what it does with Google user data, and the page previously answered only the
first half.

**The page no longer reads as a page for a product that does not exist yet** —
the old §1.4. This was the vaguest item on the list and turned out to be the
largest. Three things were saying it:

- The hero badge, the very first thing on the page, announced the app as
  forthcoming. It now reads "Tidlig tilgang" / "Early access".
- The "Status" section opened by describing a closed test. It now says the
  service is running, that everything described above works in the app today,
  that access is invitation-based in this first phase, where the app actually
  lives (`fjellrute.no/alpha/`), and how to ask for an invitation. Every one of
  those claims was already true; the old wording simply led with the limitation
  instead of the product.
- Three HTML comments still contained the old phrasings verbatim — including
  one written to explain removing them. Comments are invisible to a visitor but
  they are in the bytes served. Whether any automated part of Google's review
  reads them is unknown and not worth finding out, so they are paraphrased.

None of this overstates anything: the invitation-only limit is still stated
plainly in both languages, and there is now a test that fails if a future edit
removes that disclosure while keeping the softened wording.

**`scripts/verify-landing-page.mjs` grew from 4 sections to 6**, and from 4
negative controls to 7. Both changes above are the kind that a later tidy-up
removes without realising it is undoing a verification requirement — the
Google-data paragraph in particular reads like marketing copy — so each is now
pinned by a check that has been shown to fail. The new checks are: the five
facts the Google-data disclosure has to state, in each language; the seven
placeholder phrasings that must not appear in the visible copy; the same seven
against the raw source, comments included; and the counterpart check that the
invitation limit is still disclosed. The new controls simulate the Google-data
paragraph being cut, the badge being reverted, and the invitation limit being
dropped. All were also verified the hard way, by planting each regression in the
real file, watching the suite exit non-zero, and restoring it.

That last group promptly earned its keep. Rewording one Norwegian sentence for
style broke the control that cuts the Google-data paragraph, because the control
found that paragraph by its opening clause. It failed loudly rather than passing
silently — but only because it also asserts that its own mutation happened, and
without that assertion a negative control that has stopped mutating anything
reports a clean run exactly like one that works. Both mutations now locate their
paragraph by the fact it exists to state, which is the thing that cannot be
reworded without the positive check failing anyway.

**Both dates in §5 are filled in**, with their uncertainty written down rather
than smoothed over. See §4 below for what was actually recorded and why one of
them is deliberately still a blank line.

**The repo cleanups are done.**
`scripts/lib/__pycache__/swap-d1-binding.cpython-310.pyc` is removed from the
index (`git rm --cached`, staged, file left on disk), and `.gitignore` now
carries `__pycache__/`, `*.py[cod]` and `.pnpm-store/`, with a note on why a
committed `.pyc` is worth avoiding: it is a build artefact of a file already in
the repo, it goes stale silently, and it can shadow an edited `.py` on a machine
with a matching interpreter version.

**Verified after the changes:** all seven harnesses pass (the six behind
`pnpm test`, plus `pnpm test:migration`); `tsc -b` is clean; `vite build`
succeeds; `eslint .` reports the same 8 pre-existing problems as before, none of
them from this work. The page was also checked for well-formedness with a real
HTML parser — no nesting errors, nothing unclosed — and the two language
sections confirmed structurally identical: same four `<h3>` headings, five
paragraphs and five list items each.

---

## Still to do

Everything that remains needs either a browser signed in to an account only you
have, or a `wrangler` with production credentials. That is why it remains.

### 1. Finish Google OAuth verification — two findings, both need the console

Quoted from the console:

> * Your home page does not explain the purpose of your app.
> * The app name "Fjellrute" configured for your OAuth consent screen does not
>   match the app name on your home page.

The two content gaps most likely to be behind the first finding are now closed
(see Done, above), so the useful next steps are the two that need your
credentials:

1. **Check whether the review ran before or after the page went live.** The
   console labels these as issues from the **previous** verification attempt, so
   they may simply predate the 2026-07-28 deploy. If so they are stale. Either
   way, deploy the 2026-07-29 changes first, then reply in the verification
   email thread saying the home page is live, pointing at the sections by name
   ("What Fjellrute is", "What you can do", "Accounts", "Status"), and resubmit.
2. **Check the exact app name string.** Google Cloud console → **APIs &
   Services → OAuth consent screen → Branding** → *App name*. It has to match
   the home page character for character. `Fjellrute.no`, `fjellrute`,
   `Fjellrute Alpha`, or a stray trailing space would all trip this, and the
   project name is not the app name. The page says `Fjellrute`, and
   `docs/AUTH_SETUP.md` records the expected value in a table that
   `verify-landing-page.mjs` reads — so if you correct the name on the consent
   screen, update that table and the test will tell you the page must change
   too.

While you are in the console, the consent-screen table in
`docs/AUTH_SETUP.md` has six other `_____` cells waiting for what is actually
configured. The *Terms of service link* row is the one worth reading before you
look: there is no `public/terms.html`, so any `fjellrute.no/terms…` URL entered
there returns a 404 to a reviewer.

**This is still not blocking the closed alpha.** With only the default
email/profile scopes, an unverified app works; users see an "unverified app"
warning screen and there is a 100-user cap. Fine for invited testers.

One thing deliberately not changed: the page still carries
`<meta name="robots" content="noindex">`. It does not stop Googlebot fetching
the page, so it should not affect the review, and removing it would put the site
into search results earlier than you may want. If a re-review still reports the
home page as unreachable, that line is the first thing to try removing.

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

Note that the Status section of the landing page now invites people to write to
`contact@fjellrute.no` to ask for access, which makes the spam filter rather
more than housekeeping: those are the messages you would be missing.

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

**When you run it, write two dates into step 10 of that document.** The old
`**Delete by:** _____` line has been replaced by the rule — *seven days after
the cutover* — plus two blank lines to fill in: the date of the cutover, and the
deadline it implies. They are blank on purpose and cannot be filled in from
here: the migration has not run, so there is no second copy of anyone's data to
delete and no date to count from. If you find them still blank *after* the
cutover, the deletion has been forgotten, which is the whole point of writing
them down. The old database is a complete second copy of every account, email
address and recorded GPS track in the service.

### 5. One choice left in the repo cleanups

`.claude/settings.local.json` is still untracked. Commit it or add it to
`.gitignore` — it was left alone deliberately, because which of those you want
is a preference about your own tooling, not a correctness question. Until you
pick one, `git status` stays permanently dirty, which is the small cost of
leaving it.

### 6. Optional, worth knowing

- **Replying as `contact@fjellrute.no`.** Cloudflare Email Routing only
  receives. A reply to a GDPR request will come from your personal Gmail
  address and reveal it. Gmail's "send mail as" pointed at Resend's SMTP fixes
  that. Now more worthwhile than it was, since the landing page publishes that
  address as the way to ask for access — every reply you send will expose the
  Gmail address. Still not blocking.
- **DMARC reports now arrive.** The `_dmarc` record's
  `rua=mailto:hei@fjellrute.no` used to be a dead address; now that it
  forwards, those daily XML reports will start showing up. If they are noise,
  drop the `rua=` part from the record.
- The policy is monitor-only (`p=none`). Tightening it to `quarantine` is a
  later decision, and only after the reports look clean.
- **A screenshot of the app on the landing page** would make it unambiguously a
  product page rather than a description of one. This was suggested as part of
  the old §1.4 and not done: the wording was the cheap half, an image is a
  design decision, and it would need to survive the "no copy in JavaScript"
  rule. Worth considering if a re-review still doubts the app exists.

---

## Unverified from here

Honest list of things stated above that a review session cannot check, so that
nobody later mistakes them for confirmed:

- whether migration `0007` has been applied to the **remote** D1 database;
- whether the D1 database is still outside the EU jurisdiction (the migration
  script checks this itself before doing anything);
- the exact *App name* string on the OAuth consent screen, and the six other
  consent-screen values still blank in `docs/AUTH_SETUP.md`;
- whether the verification attempt that produced the two remaining findings ran
  before or after the landing page was deployed;
- **the Search Console verification date.** `docs/AUTH_SETUP.md` now records
  2026-07-28, which is the date the audit found the TXT record live and the
  domain-ownership findings gone. Nobody watched **Verify** being pressed. If it
  happened on another day, correct that line; it is recorded only so the age of
  the TXT record is knowable;
- how the revised landing-page copy actually *renders*. It is verified by a test
  and by an HTML parser, and the language blocks are structurally identical, but
  no one has looked at it in a browser. The two additions worth a glance are the
  new paragraph in "Accounts", which makes that section noticeably longer, and
  the two `<code>` spans in "Status", which are newly styled;
- whether the 2026-07-29 changes are an improvement in a reviewer's eyes. The
  first two findings were closed by reasoning about Google's guidance, not by
  feedback from Google.

## How to check the state yourself

```sh
pnpm test                # the six harnesses: deletion, privacy, policies, landing
pnpm test:migration      # the EU migration script's guardrails, against a stub
pnpm build               # tsc -b && vite build
pnpm lint                # 8 pre-existing problems, none from Week 3
dig MX fjellrute.no      # should list Cloudflare's three mail servers
git diff                 # the 2026-07-29 changes, still uncommitted
```

The harnesses need **Node ≥ 22** — they use `??`, and on an older Node they die
with `SyntaxError: Unexpected token '?'` before running a single check, which
looks like a broken test rather than a wrong interpreter.

Uncommitted at the time of writing: `.gitignore`, `docs/AUTH_SETUP.md`,
`docs/D1-EU-JURISDICTION-MIGRATION.md`, `public/coming-soon.html`,
`scripts/verify-landing-page.mjs`, this file, and the staged deletion of
`scripts/lib/__pycache__/swap-d1-binding.cpython-310.pyc`. `dist/` has been
rebuilt and is ahead of production.
