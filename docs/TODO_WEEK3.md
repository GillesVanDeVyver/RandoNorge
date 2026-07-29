# Week 3 — status and what is left

**Week 3 of the launch plan (Jul 27 – Aug 2): GDPR + accounts hygiene.**
First written 2026-07-28, revised 2026-07-29, revised again the evening of
2026-07-29 after the deploy, and revised once more late on 2026-07-29 after the
EU-jurisdiction migration was run and stopped part-way. Companion to
`WEEK3-GDPR-CHECK-2026-07-28.md`, which holds the full audit and its reasoning;
this file is the short list of what is done and what still needs doing.

> **The application work described below is committed and deployed.** The
> 2026-07-28 work went out in `98ac10c`; the 2026-07-29 landing-page revision and
> the `/alpha/` base fix went out in `d98226b` and `90d4118` (both titled "Fix
> alpha homepage redirect"), were built, and were deployed with
> `npx wrangler deploy`; the to-do list itself was committed in `28b7824`.
>
> **The database migration is the exception, and it is mid-flight.** `git status`
> now shows `wrangler.jsonc` modified — that is the step 7 binding swap onto
> `fjellrute-db-eu`, and it is **not deployed**. Production is still served by the
> old database until `npx wrangler deploy` runs. Also present and deliberately
> untracked: `fjellrute-dump.sql` (a full copy of everyone's personal data, see
> §4) and `wrangler.jsonc.bak-2026-07-29`. `.claude/settings.local.json` is still
> untracked too, which is §5 and is a preference, not a defect.
>
> Earlier versions of this file opened by warning that nothing here had reached
> a Google reviewer yet. That is no longer true, and the outcome is recorded in
> §1: the reviewer has now seen it, and rejected it anyway.

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

**The EU-jurisdiction migration was written on 2026-07-28 and run on 2026-07-29
— see §4, it is two thirds done.** `scripts/migrate-d1-to-eu.sh` performs the
create-and-copy (a D1 jurisdiction can only be set at creation time) and refuses
to continue on an unconfirmed jurisdiction, a row count that does not match, a
lost foreign-key cascade, a `wrangler.jsonc` it cannot edit unambiguously, or a
leftover dump. It never deletes the old database. Because its commands cannot be
run from a review session, its guardrails are tested against a stub `wrangler`
over real SQLite in seven scenarios — five of them failure paths — via
`pnpm test:migration`. On the real run one of those five refusals fired, at step
7, and was right to: the config had become ambiguous. Steps 1–6 completed and
verified.

### From 2026-07-29 (committed in `d98226b` + `90d4118`, deployed)

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

**Sign-up was broken for a day, and the landing-page work is what broke it.**
Taking `/` away from the app was only half a change. The Worker began serving
the holding page for `/`, but the frontend still called `/` home: every Better
Auth round trip in `LoginPage.tsx` passed `callbackURL: '/'` — Google sign-in
and its error path, email sign-up, resend-verification and both password-reset
requests — and `Root.tsx` reset the URL to `/` after sign-out, after leaving a
public route, and when a guest declined the terms. The symptom was the worst
available one: a new tester accepted the terms of use and Fjellrute answered
"Kommer snart". Nothing errored and nothing logged, because every one of those
strings was a perfectly valid path.

The app now has a declared base — `APP_BASE = '/alpha'` in `src/appBase.ts`,
the address `public/about.html` gives testers. Outgoing URLs are built with
`appPath()`, incoming ones read through `stripAppBase()`, so `/alpha/` is the
overview and `/alpha/planner` the planner. Paths without the prefix still
resolve, so links sent before the move keep working; the one address that cannot
be rescued is the bare root, which the holding page answers before the app
loads. Public share URLs (`/u/<handle>/…`) stay outside the base deliberately —
they go to people without an invitation. The sticky season override
(`/summer`, `/fall/planner`) used to clean the URL down to `/`, i.e. onto the
holding page, and now cleans down to `/alpha/`.

`scripts/verify-app-base.mjs` (`pnpm test:appbase`, now part of `pnpm test`)
keeps the two halves in step: it runs the real mapping functions, fails if the
Worker intercepts `/` while the app claims no base of its own, and scans `src/`
for any `callbackURL`, `redirectTo` or `pushState` written as a literal path —
which is the specific mistake that caused this. Six negative controls prove each
section can fail. **To open the app to the public** later: set `APP_BASE` to
`''`, delete the root branch in `worker/index.js`, drop the `/` entry from
`run_worker_first` in `wrangler.jsonc`. That script then expects the app at `/`
and objects if only one or two of the three are done.

**Verified after the changes:** all eight harnesses pass (the seven behind
`pnpm test`, plus `pnpm test:migration`); `tsc -b` is clean; `vite build`
succeeds and the bundle contains the `/alpha` base rather than a literal `'/'`;
`eslint .` reports the same 8 pre-existing problems as before, none of
them from this work. The page was also checked for well-formedness with a real
HTML parser — no nesting errors, nothing unclosed — and the two language
sections confirmed structurally identical: same four `<h3>` headings, five
paragraphs and five list items each.

---

## Still to do

Everything that remains needs either a browser signed in to an account only you
have, or a `wrangler` with production credentials. That is why it remains.

### 1. Google OAuth branding verification — one decision left, not a task

**Status, 2026-07-29 evening.** Everything this repository could do has been
done and deployed: the content lives at `/about.html`, the *Application home
page* field in the console now names that URL, `noindex` is gone, the app name
matches character for character, and the domain is verified in Search Console.
It was resubmitted. **The findings came back anyway** — the third round with the
same result.

So the honest answer to "what is left" is: nothing to fix, one thing to choose.

Every finding across all three rounds has been an *absence* — "does not explain
the purpose", "does not match the app name" — while the page demonstrably
contains both, as static HTML, in both languages, at the URL the console names,
with the app name as an `<h1>` at 44–76px. An automated checker that read the
text and disagreed would say something else. Continuing to edit the page is
therefore working on the wrong end of the problem, and the checks in
`verify-landing-page.mjs` now exist partly to stop a future round of guessing
from quietly undoing something that was right.

**What failing this actually costs, in the console's own words:** *"Your
branding is not being shown to users."* That is the whole consequence. The
Verification Center also says *"Verification is not required since your app is
not requesting any sensitive or restricted scopes"*, the Audience page says **In
production**, and so the 100-user cap and the "unverified app" warning screen —
both of which belong to **Testing** mode — do not apply. Sign-in works. Nobody
is blocked. The uploaded logo simply does not appear on the consent screen,
which falls back to showing the URL.

**The choice.** That logo is the only reason verification is being asked for at
all. Either:

- **Remove it** — Google Cloud console → **Branding → App logo → Remove** — and
  the verification requirement ends permanently, along with this entry. The
  consent screen shows `fjellrute.no` instead of a teal mountain glyph.
- **Keep it and stop resubmitting.** Costs nothing except that the consent
  screen stays unbranded and the console keeps showing an unresolved item.

Removing it is the recommendation, on the grounds that three rounds of evidence
say the branding will not be approved and a logo nobody is shown is worth less
than the time. Not urgent either way; it blocks nothing.

The consent-screen table in `docs/AUTH_SETUP.md` no longer has blank cells —
all seven values were read from the console on 2026-07-29 and recorded, so the
next person does not have to go looking. Two are worth knowing: there are **two**
authorized domains, the second being the Worker's `workers.dev` hostname, which
is load-bearing rather than leftover (it carries a redirect URI); and the *Terms
of service link* is empty, which is correct — there is no `public/terms.html`, so
any `fjellrute.no/terms…` URL entered there would 404 to a reviewer.

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

### 4. Finish the EU-jurisdiction migration — stopped at step 7 of 10

**Run on 2026-07-29, ~21:33 CEST. Steps 1–6 succeeded; step 7 refused.**
`fjellrute-db-eu` exists at `1d6f92bf-83c8-4dce-80f6-d20b4a09674b` with
`jurisdiction eu` confirmed, all ten tables copied, every row count matching
(5 users, 5 accounts, 4 sessions, 4 routes, 1 track, 18 invite codes), the four
`on delete cascade` clauses intact, and 7 migration records carried across. So
the data is where it needs to be.

**Production is still on `fjellrute-db`,** because the cutover has not been
deployed. That is the state to hold in mind: two live databases, the EU one
serving nothing.

**Why it stopped, and why that was correct.** The script found two
`database_name` keys in `wrangler.jsonc` and refused to guess. The second pair
was not stale — wrangler's own *"Would you like Wrangler to add it on your
behalf?"* prompt, during the create, had appended a whole new `d1_databases`
entry (binding `fjellrute_db_eu`, `remote: true`). Guessing wrong there points
production at the wrong database, so stopping was the right failure. Note that
the same prompt sequence also opted local dev into the *remote* database, which
is the setting the comment in `wrangler.jsonc` explicitly warns against; dropping
that entry removed it.

**The binding swap is now done, by hand** (`wrangler.jsonc.bak-2026-07-29` is
the backup). The `DB` binding names `fjellrute-db-eu`, the duplicate entry is
gone, the old name and id sit in a dated rollback comment above it, and the
config parses with exactly one `database_name` and one `database_id` — what step
7 was checking for. The binding is still called `DB` on purpose: `worker/`
reaches the database through `env.DB` everywhere, and adopting wrangler's
suggested `fjellrute_db_eu` name would mean renaming all of them.

**What is left, in order.** Steps 8–10 of
`docs/D1-EU-JURISDICTION-MIGRATION.md`:

```sh
npx wrangler d1 migrations apply fjellrute-db-eu --local   # dev db follows the binding
npx wrangler deploy                                        # the actual cutover
```

Then smoke-test against the deployed site in this order: sign in, open the route
library, save a route, delete it. **A read-only check is not enough** — a Worker
bound to a database that does not answer still serves the app shell perfectly, so
the write path is the failure worth catching. If anything fails, restore the two
values from the rollback comment and redeploy; the old database is untouched.

Only after that does step 9 apply — the privacy policy §4 hedge about
Cloudflare's worldwide network may become a straight claim that the database is
restricted to EU data centres, in **all four** places (`src/terms/privacy.ts` and
`public/privacy.html`, English and Norwegian), with `PRIVACY_VERSION` bumped in
both `src/terms/privacy.ts` and `worker/policyVersions.js`, then
`pnpm test:privacy && pnpm test:policies`. Bumping the version re-presents the
acceptance gate to every signed-in user, which is the point. **Do not write that
claim before the deploy succeeds**, or the policy asserts a restriction that
production is not yet under.

**The dates in step 10 are now filled in, and there are two clocks, not one.**

- **`fjellrute-dump.sql` — delete by 2026-08-05.** It is 86 kB of every account,
  email address and recorded GPS track in the service, sitting in the working
  directory since 2026-07-29. That clock started with the copy and does not wait
  for the cutover. Step 5 has passed, so the file's only remaining value is a
  rollback that the untouched old database already provides better; deleting it
  sooner than the deadline is correct.
- **`fjellrute-db` — no date yet, and it must not have one until step 8.**
  Before the cutover it is not the redundant copy, it is *the live production
  database*. Its deadline is cutover + 7 days and its line stays blank until
  there is a cutover to count from.

If that cutover line is still blank in a few days, the migration has stalled
half-done rather than been forgotten — which is its own small problem, since the
duplicate personal data exists either way.

**`pnpm test:migration` still passes after the hand edit** (all seven scenarios,
including the two that assert step 7 refuses) — it runs on Python 3, so unlike the
Node harnesses it could be re-run here. Two things it is worth knowing about it
now. Its `[real wrangler.jsonc]` section reads the *actual* config rather than a
fixture, so now that the config names `fjellrute-db-eu` that section exercises an
id-only swap rather than the rename it was written against; it still checks the
properties that matter (one live `database_id`, the old id preserved in a comment,
every comment surviving, nothing outside the binding block touched). And the
rollback comment added by hand deliberately mimics the format
`scripts/lib/swap-d1-binding.py` writes — `//   "database_name": …` — because that
tool's regexes anchor on a line beginning with optional whitespace and then a
quote, so a commented-out pair is not counted as a second binding. Verified by
running those regexes against the file: one name, one id. Re-running step 7 now
exits with *"the binding already points at fjellrute-db-eu"* instead of the
ambiguity error, which is the refusal you want if you resume with `--from 7`.

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

- whether migration `0007` has been applied to the **remote** D1 database. Note
  that the migration copied 7 records into `fjellrute-db-eu` and the script
  reported anything beyond them as still pending, so this is now answerable with
  `npx wrangler d1 migrations list fjellrute-db-eu --remote` — worth doing before
  the step 8 deploy rather than after;
- ~~whether the D1 database is still outside the EU jurisdiction~~ — answered on
  2026-07-29: it was (`jurisdiction: none`), and `fjellrute-db-eu` was created
  with `jurisdiction eu` confirmed. What is **not** verified is the part that
  matters to a user: the deployed Worker still talks to the non-jurisdictional
  database, because the cutover has not been deployed. Until then the EU
  restriction is true of a database nothing is using;
- **whether the edited `wrangler.jsonc` deploys.** It parses, and it satisfies
  the one-name-one-id condition step 7 checks, but that was verified with a JSONC
  parser rather than by wrangler: no Node ≥ 22 was available to run
  `wrangler deploy --dry-run`, so `pnpm test:migration`, `pnpm test` and the
  schema validation have **not** been re-run since the edit. Run them before the
  cutover;
- ~~the exact *App name* string on the OAuth consent screen, and the six other
  consent-screen values still blank~~ — all seven were read from the console and
  recorded in `docs/AUTH_SETUP.md` on 2026-07-29, including the *Application home
  page* field after it was changed to `/about.html`. What still cannot be checked
  from here is whether any of them is later edited: nothing in a build can read
  that console, which is why `verify-landing-page.mjs` warns on the recorded
  value rather than asserting the live one;
- ~~whether the verification attempt that produced the two remaining findings ran
  before or after the landing page was deployed~~ — moot: the app was resubmitted
  after the deploy, with the console field pointing at the live page, and was
  rejected again. Whatever the earlier attempts saw, this one saw the current
  page;
- **why** the branding review keeps reporting absences. The reasoning in §1 —
  that a checker finding "no purpose" on a page containing a purpose section did
  not read the page — is inference from three identical outcomes, not something
  Google has confirmed. It is the best available reading, and it is still a
  reading;
- **the Search Console verification date.** `docs/AUTH_SETUP.md` now records
  2026-07-28, which is the date the audit found the TXT record live and the
  domain-ownership findings gone. Nobody watched **Verify** being pressed. If it
  happened on another day, correct that line; it is recorded only so the age of
  the TXT record is knowable;
- **whether a real sign-in on the live site now lands on `/alpha/`.** The fix is
  verified by `tsc -b`, by the built bundle containing the base rather than a
  literal `'/'`, by `verify-app-base.mjs` round-tripping every view, and by a
  scratch harness that ran the real Worker handler against `/`, `/alpha`,
  `/alpha/planner` and a share URL — but nobody has completed an actual sign-in
  through the deployed site. Six flows deserve one click each, because all six
  shared the one bug: Google sign-in, email sign-up through the terms gate,
  resend-verification, forgot-password, password reset, and sign-out;
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
pnpm test                # seven harnesses: deletion, privacy, policies, landing, appbase
pnpm test:migration      # the EU migration script's guardrails, against a stub
pnpm build               # tsc -b && vite build
pnpm lint                # 8 pre-existing problems, none from Week 3
dig MX fjellrute.no      # should list Cloudflare's three mail servers
git log --oneline -3     # 28b7824, 90d4118, d98226b
git status --short       # M wrangler.jsonc — the step 7 swap, undeployed (§4)
npx wrangler d1 info fjellrute-db-eu       # jurisdiction eu
ls -la fjellrute-dump.sql                  # delete by 2026-08-05 (§4)
```

### Getting those commands to run at all

Two interpreter problems cost more time on 2026-07-29 than any of the code did,
both of them looking like broken tests rather than a wrong toolchain. Written
down so the next machine loses minutes instead of an evening.

**`pnpm: not found`, and `npm test` fails the same way.** The `test` script calls
`pnpm` recursively, so npm cannot stand in for it — the failure appears one level
deeper (`sh: 1: pnpm: not found`) and looks like a broken script. `package.json`
pins `pnpm@10.11.1` in `packageManager`, and the cheapest route that needs no
install is:

```sh
npx pnpm@10.11.1 test
```

`corepack enable pnpm` is the tidier fix but the Corepack bundled with some Node
builds fails with `Cannot find matching keyid` — a signature-verification bug in
Corepack itself, not a problem with this repo; `npm i -g corepack@latest` clears
it. Note also that `npm build` is not a command (`npm run build` is), and that a
`(base)` conda prompt can shadow an already-installed `pnpm`.

**Node must be ≥ 22.13, not merely ≥ 22.** Two independent reasons, and neither
error names the version:

- `verify-account-deletion.mjs` imports `node:sqlite` to run the real deletion
  code against a throwaway database. On Node 22.7 that module exists only behind
  `--experimental-sqlite`, so the import dies with
  `ERR_UNKNOWN_BUILTIN_MODULE: No such built-in module: node:sqlite` before a
  single check runs. `NODE_OPTIONS=--experimental-sqlite` is the escape hatch.
- Vite's own floor is Node 22.12, so `pnpm build` is next in line to complain.

`22.14.0` is known-good: the full suite, `tsc -b` and `vite build` were all run
on it. On an older Node still (below 20) the scripts die on `??` with
`SyntaxError: Unexpected token '?'`. There is no `.nvmrc` and `engines` pins only
the package manager, which is why none of this announces itself — worth adding if
this recurs.

As of this revision the working tree is **not** clean, and deliberately so:
`wrangler.jsonc` carries the undeployed step 7 binding swap (§4), alongside the
untracked `fjellrute-dump.sql`, `wrangler.jsonc.bak-2026-07-29` and
`.claude/settings.local.json` (§5). `dist/` was rebuilt and deployed earlier on
2026-07-29, so the build output, the tree and production agree about the
*application* — they no longer agree about which database it binds, and will not
until step 8 runs.
