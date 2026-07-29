# Week 3 — status and what is left

**Week 3 of the launch plan (Jul 27 – Aug 2): GDPR + accounts hygiene.**
First written 2026-07-28, revised 2026-07-29, revised again the evening of
2026-07-29 after the deploy, revised late on 2026-07-29 after the
EU-jurisdiction migration was run and stopped part-way, revised again at ~22:25
CEST once the policy deploy had landed, and revised a final time that night after
the sign-in, the commit and the deletion of the old database closed the last three
items. Companion to
`WEEK3-GDPR-CHECK-2026-07-28.md`, which holds the full audit and its reasoning;
this file is the short list of what is done and what still needs doing.

> **All of the week's application work is now deployed.** The 2026-07-28 work went
> out in `98ac10c`; the 2026-07-29 landing-page revision and the `/alpha/` base fix
> went out in `d98226b` and `90d4118` (both titled "Fix alpha homepage redirect");
> the to-do list and the D1 binding swap were committed in `28b7824` and `0b7f157`.
>
> **The database lives in the EU jurisdiction, production is on it, and the
> privacy policy now says so.** `fjellrute-db-eu` was cut over and smoke-tested on
> 2026-07-29 ~22:00 CEST; the strengthened §4 and `PRIVACY_VERSION` `2026-07-29`
> were built and deployed ~22:20 CEST as version
> `1d0855e9-0b33-42c4-a21d-6191080f93d1`. Verified twice: by fetching the live
> `/privacy.html`, which carries the new §4 and `2026-07-29` in both languages,
> and by a real sign-in through the re-presented acceptance gate.
>
> **The three things this file listed as outstanding are all done** (2026-07-29,
> late evening):
>
> 1. **The acceptance gate was exercised for real.** It appeared on sign-in,
>    accepted, and did not return on reload. That single click confirmed migration
>    `0007` is on the remote database, that the version bump reached the deployed
>    bundle and Worker, and that the re-acceptance path in `worker/policies.js`
>    works against a live signed-in user — none of which had ever been true before
>    (§3).
> 2. **Committed** as `cfecf1a` ("Week 3 plan"). Production and the repository
>    describe the same service again.
> 3. **`fjellrute-db` is deleted** — seven days ahead of its 2026-08-05 deadline,
>    on the same evening as the cutover. There is now exactly one copy of the
>    data. **This means the migration no longer has a rollback**; see §4 and the
>    Rollback section of `D1-EU-JURISDICTION-MIGRATION.md`, both of which have
>    been rewritten to say so, because a document that still promises one is worse
>    than no document.
>
> **Nothing in this file is now waiting on a date.** What is left (§1, §2, §5, §6)
> is decisions and small hygiene, none of it blocking.
>
> One config change is deployed-pending rather than outstanding: the duplicate R2
> binding removed from `wrangler.jsonc` (§7) is gone from the repository and from
> local dev, but production keeps the extra unused binding until the next deploy.
> Nothing reads it, so there is no reason to deploy for it alone.
>
> Untracked, deliberately: `wrangler.jsonc.bak-2026-07-29` (gitignored) and
> `.claude/settings.local.json`, which is §5 and a preference rather than a defect.
> Note that the backup file is now the only local trace of the old binding, and it
> is not a database backup — the database it points at is gone.
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

### From late on 2026-07-29 (deployed as `1d0855e9`, committed in `cfecf1a`)

**The EU-jurisdiction cutover and the matching privacy policy both shipped.**
Details in §4; the short version is that `fjellrute-db-eu` is production and the
policy that describes it is live.

**The toolchain was fixed rather than routed around.** Node `22.18.0` via `nvm`,
set as the default, after which `corepack enable pnpm` succeeded and `pnpm` works
under its own name — the `Cannot find matching keyid` Corepack bug recorded
below belonged to an older bundled Corepack. Two evenings of `pnpm: not found`
had been worked around with `npx pnpm@10.11.1`; that is no longer necessary.
`22.18` is also the first release that imports `.ts` without a flag, which the
privacy harness needs (see the toolchain notes at the end).

**The full suite was then run for real, and passed.** All five harnesses behind
`pnpm test` — deletion, privacy, policies, landing, appbase — plus
`pnpm test:migration` separately. The two that matter for this week's last change
are `test:privacy`, which confirmed all four copies of the policy agree and both
languages carry `PRIVACY_VERSION (2026-07-29)`, and `test:policies`, which
confirmed the two constants match and that **bumping `PRIVACY_VERSION` re-gates an
already-accepted account**. Everything asserted about the policy edit had until
then been checked only through a port of the harness onto an old interpreter; it
is now checked by the harness itself.

**A duplicate R2 binding was found in the deploy output and removed.** See §7. It
is the same wrangler-prompt artefact that stopped step 7 of the migration, one
resource over, and it had been sitting in the config unnoticed for some time.

**Nine more commands naming the deleted database were found and repointed.** The
earlier sweep caught the operational docs and `scripts/invite/create-invite.mjs`
but missed two places: the `-- Apply locally: / -- Apply in prod:` header comments
in all seven files in `migrations/`, and — more embarrassingly — the two
`d1 migrations apply` commands in `wrangler.jsonc`'s own comment, three lines above
the binding that had already been repointed. Every one of them would now fail with
a database-not-found error, and the kind of person who copy-pastes a command out of
a migration file header is exactly the person who will not have read this document
first. Left alone deliberately: the dated audit files
(`WEEK3-GDPR-CHECK-2026-07-28.md`, `SECURITY-REVIEW-2026-07-23.md`), which are
records of what was true when they were written; the procedure steps in
`D1-EU-JURISDICTION-MIGRATION.md`, which describe a future run against whatever the
old database is then; `OLD_NAME` in `scripts/migrate-d1-to-eu.sh`, which is a
parameterised default; and `wrangler.jsonc.bak-2026-07-29`, which is a backup and
would stop being one if edited.

One incidental catch worth recording, because it nearly went in unnoticed:
`migrations/0002_tracks.sql` is the only file in that directory with CRLF line
endings, and rewriting it in Python normalised the whole file to LF — a two-line
change arriving as a 58-line diff. Restored to CRLF, so the committed diff is the
two comment lines it should be. Check `git diff --stat` after any mechanical sweep;
a suspiciously large number is usually line endings, and it hides the real change.

---

## Still to do

**Items 3, 4 and 7 are finished** and are kept below because how they went is worth
recording — §4 in particular, since finishing it removed the migration's rollback.

What genuinely remains is §1, §2, §5 and §6: one decision about the Google logo,
one Gmail filter, one untracked config file, and a handful of optional
improvements. None of it is on a clock and none of it blocks anything.

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

### 3. Migration 0007 on the remote database — confirmed, nothing to do

**Settled on 2026-07-29 by the sign-in.** The acceptance gate appeared at
`fjellrute.no/alpha/`, accepted, and did not return on reload. That is three
confirmations in one action, and they were the three loosest ends in the whole
week:

- **`0007` is applied to the remote database.** Had it not been, the policy
  endpoint would have thrown `no such column: acceptedTermsVersion` for a
  signed-in user while everything else kept working — the kind of fault that hides
  until someone signs in.
- **The version bump reached the deployed bundle and Worker**, not just the static
  mirror. The gate is driven by `PRIVACY_VERSION` compiled into both; the live
  `/privacy.html` fetch could only ever prove the mirror.
- **The re-acceptance path in `worker/policies.js` works against a real user.** It
  had never run in production against a stored acceptance before: the 2026-07-28
  bump happened while nobody held one. The path being exercised includes the
  server refusing to take the client's word for what version was accepted.

Kept for reference, since a future bump will want them. Applying twice is safe; a
migration already recorded is skipped:

```sh
npx wrangler d1 migrations apply fjellrute-db-eu --local
npx wrangler d1 migrations apply fjellrute-db-eu --remote
npx wrangler d1 migrations list fjellrute-db-eu --remote   # the direct check
```

And if a future gate misbehaves: if it never appears, suspect a stale bundle in
the browser before suspecting the deploy — hard-reload first. If it appears and
will not clear, that is the `PUT /api/me/policies` path, and the two version
constants disagreeing is the first thing to rule out (`pnpm test:policies` exists
to make that impossible in the repository, so the question becomes what production
is actually serving).

### 4. EU-jurisdiction migration — complete, and no longer reversible

**All ten steps are done, all on 2026-07-29.** Kept here because how it went is
worth recording, and because one consequence of finishing it needs stating
plainly: **the migration has no rollback any more.** Both copies it relied on —
the old database and the export taken from it — are gone. There is exactly one
copy of the data, and it is production.

**Run on 2026-07-29, ~21:33 CEST; cutover deployed ~22:00 CEST.**
`fjellrute-db-eu` (`1d6f92bf-83c8-4dce-80f6-d20b4a09674b`) has
`jurisdiction eu` confirmed, all ten tables copied, every row count matching
(5 users, 5 accounts, 4 sessions, 4 routes, 1 track, 18 invite codes), the four
`on delete cascade` clauses intact, and 7 migration records carried across.
**Production now runs on it**, deployed and smoke-tested through a real sign-in,
route library load, route save and delete — the write path, not just the shell.

**Why the script stopped part-way, and why that was correct.** It found two
`database_name` keys in `wrangler.jsonc` and refused to guess. The second pair
was not stale — wrangler's own *"Would you like Wrangler to add it on your
behalf?"* prompt, during the create, had appended a whole new `d1_databases`
entry (binding `fjellrute_db_eu`, `remote: true`). Guessing wrong there points
production at the wrong database, so stopping was the right failure. Note that
the same prompt sequence also opted local dev into the *remote* database, which
is the setting the comment in `wrangler.jsonc` explicitly warns against; dropping
that entry removed it.

**The binding swap was done by hand** (`wrangler.jsonc.bak-2026-07-29` is the
backup — of the config, not of the data). The `DB` binding names
`fjellrute-db-eu`, the duplicate entry is gone, the old name and id sit in a dated
comment above it, and the config parses with exactly one `database_name` and one
`database_id` — what step 7 was checking for. That comment was labelled ROLLBACK
until the old database was deleted; it now says **historical, not a rollback**,
because restoring those two values would bind the Worker to a database that does
not exist and every query would fail at once. The values stay because the
migration document refers to that id and because `git log` should not be the only
place it survives. The binding is still called `DB` on purpose: `worker/` reaches the
database through `env.DB` everywhere, and adopting wrangler's suggested
`fjellrute_db_eu` name would mean renaming all of them.

**Step 9 is done and deployed: the privacy policy now claims the restriction.**
`PRIVACY_VERSION` is `2026-07-29` in both `src/terms/privacy.ts` and
`worker/policyVersions.js`, and §4 says in all four places
(`src/terms/privacy.ts` and `public/privacy.html`, English and Norwegian) that
the database is restricted to data centres inside the EU, that this was set at
creation time, and that it is not replicated elsewhere. Deployed ~22:20 CEST as
version `1d0855e9-0b33-42c4-a21d-6191080f93d1`, and checked the only way that
really counts — by fetching the live page. `/privacy.html` serves the new §4 in
both languages with `Last updated: 2026-07-29` and `Sist oppdatert: 2026-07-29`.
That file matters twice over: it is also the URL on the Google OAuth consent
screen, so the copy a reviewer reads is current as well.

The hedge it replaced — *"Cloudflare's network is worldwide, however, so we
cannot promise that no data ever passes outside the EU"* — was not deleted
outright, and deliberately. The jurisdiction restricts **storage**; it does not
move the Worker, which still runs at whichever Cloudflare location is nearest the
visitor. So §4 now makes the storage claim firmly and states the request-routing
caveat as a specific fact rather than as a general inability to promise anything.
That is a stronger policy *and* a more accurate one, which is the only version
worth having in a document users accept. Overclaiming "your data never leaves the
EU" would have been easy, wrong, and the kind of thing a regulator reads closely.

Because the version changed, **every signed-in user was shown the acceptance gate
again** — unlike the 2026-07-28 bump, which happened while nobody held an
acceptance. Confirmed the same evening by signing in: it appeared, accepted, and
stayed gone on reload. That is the mechanism working as designed, and it is the
click that closed item 3.

**Both deletions are done, and both were early.** The dump was 86 kB holding every
account, email address and recorded GPS track in the service; deleting it as soon
as step 5 passed was straightforwardly right, because from that moment its only
value was a rollback the old database provided better. `fjellrute-db` followed the
same evening, ~20 minutes after the cutover, against a deadline of 2026-08-05.

**That second one is worth being honest about in writing.** The seven days were
never about the deadline; they were about the class of fault that verification
cannot see. Row counts, cascades, migration records and a smoke test all answer
"was the copy faithful?" — and the answer was yes, thoroughly. What they cannot
answer is "does it hold up?": a write path nobody exercised, an index that matters
at 500 rows and not at 5, a migration recorded but subtly wrong. That is what the
week was for, and the window for it ended up being about twenty minutes.

Nothing has gone wrong, and the odds were always good at this scale — five
accounts, one recorded track. The point is not that it was reckless; it is that
the insurance was the one part of the plan that could not be reconstructed
afterwards, and it was spent for a day's tidiness. `D1-EU-JURISDICTION-MIGRATION.md`
now says so at the top and in its Rollback section, so a future migration
following that document follows the deadline rather than this example.

**What recovery now exists.** D1 Time Travel on `fjellrute-db-eu`, which restores
a *live* database to an earlier minute from Cloudflare's write-ahead log. It covers
the faults that are actually plausible from here — a bad migration, an unscoped
`UPDATE`, a delete that took more rows than intended — and does not cover a dropped
database. Confirm the retention window before relying on it, because it depends on
the plan and cannot be read from this repository:

```sh
npx wrangler d1 time-travel info fjellrute-db-eu
```

Worth running once now, while nothing is wrong. And note that a restore rewinds the
whole database: recovering one route by going back an hour discards every other
account's hour too.

**The tempting wrong answer is a periodic SQL export.** A dump is a plaintext file
containing every account, email address and GPS track, living wherever it was
written — laptop, backup, cloud sync — outside every access control the
application has. That is the storage-limitation and data-minimisation problem this
week existed to reduce, reintroduced in a worse form. If durable backup becomes a
real requirement rather than a reflex, it needs designing as one: encrypted,
retained for a stated period, inside the EU, and disclosed in privacy policy §4
alongside everything else that holds user data.

**`pnpm test:migration` still passes after the hand edit** (all seven scenarios,
including the two that assert step 7 refuses) — it runs on Python 3, so unlike the
Node harnesses it could be re-run here. Two things it is worth knowing about it
now. Its `[real wrangler.jsonc]` section reads the *actual* config rather than a
fixture, so now that the config names `fjellrute-db-eu` that section exercises an
id-only swap rather than the rename it was written against; it still checks the
properties that matter (one live `database_id`, the old id preserved in a comment,
every comment surviving, nothing outside the binding block touched). Note that
`the old id is preserved in a comment` is one of the checks, which is a second
reason the deleted database's id stays in the file: removing it fails the harness.
And the comment added by hand deliberately mimics the format
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

### 7. A duplicate R2 binding — removed from the config, still in production

**Nothing to do, except not to re-create it.** Recorded here because of how it
was found and because the mechanism will keep producing these.

The bindings table printed by `wrangler deploy` on 2026-07-29 listed the terrain
bucket twice:

```
env.TERRAIN              R2 Bucket   fjellrute-terrain
env.fjellrute_terrain    R2 Bucket   fjellrute-terrain
```

Two bindings, one bucket. In `wrangler.jsonc` the second entry read
`{"bucket_name": "fjellrute-terrain", "binding": "fjellrute_terrain", "remote": true}`
— the resource name snake-cased into a binding, the keys in wrangler's own
order, and `"remote": true`. That is the exact signature of wrangler's *"Would
you like Wrangler to add it on your behalf?"* prompt, and it is the same thing
that appended a second `d1_databases` entry and stopped step 7 of the migration
(§4). It had presumably been there since the bucket was created.

Nothing read it. `worker/terrain.js` uses `env.TERRAIN`, and only `env.TERRAIN`.
But `"remote": true` meant `wrangler dev` reached the real production bucket
through that binding — the setting the D1 comment in the same file explicitly
warns against, arrived at by accident rather than by choice.

**Why it went unnoticed for so long, which is the part worth remembering.** The
D1 duplicate announced itself by breaking a script that checks for exactly one
binding. Nothing performs that check for R2, so this one deployed in silence
every time. The only visible sign was two rows for one bucket in the deploy
output — a table that scrolls past after a successful build and is easy to read
as confirmation rather than as information.

The entry is gone from `wrangler.jsonc`, with a comment above `r2_buckets`
recording what was removed, why, and to answer **no** to that prompt.
`pnpm test:migration` still passes, including its `[real wrangler.jsonc]`
section, so the D1 guardrail is untouched; the file was also re-parsed to confirm
one D1 binding, one R2 binding, no `remote` flags, and every other top-level key
intact.

**The one loose end:** the deployed Worker keeps the extra binding until the next
`npx wrangler deploy`. Harmless — no code path reaches it — so it is not worth a
deploy of its own. It will disappear with whatever ships next, and the bindings
table is the place to confirm it did.

---

## Unverified from here

Honest list of things stated above that a review session cannot check, so that
nobody later mistakes them for confirmed:

- ~~whether migration `0007` has been applied to the **remote** D1 database~~ —
  resolved on 2026-07-29 by the sign-in. The gate is served by the policy
  endpoint, which reads `acceptedPrivacyVersion`; it rendered and cleared, so the
  column exists. `npx wrangler d1 migrations list fjellrute-db-eu --remote` is
  still the direct check if it is ever in doubt again;
- ~~whether the D1 database is still outside the EU jurisdiction~~ — resolved on
  2026-07-29. It was (`jurisdiction: none`); `fjellrute-db-eu` was created with
  `jurisdiction eu` confirmed, and production was deployed against it and
  smoke-tested. The restriction is now true of the database the service actually
  uses, which is what the privacy policy asserts;
- ~~whether the edited `wrangler.jsonc` deploys~~ — it did;
- ~~whether the new privacy policy text and version have reached production~~ —
  resolved on 2026-07-29. Built, deployed as `1d0855e9`, and then confirmed by
  fetching the live `/privacy.html`, which serves the new §4 in both languages
  with both updated lines reading `2026-07-29`. The harnesses were also re-run
  for real on Node 22.18 rather than through the Node 12 port used earlier, and
  `test:policies` reported `PASS bumping PRIVACY_VERSION re-gates an
  already-accepted account`;
- note what that fetch alone could not prove, and what closed the gap. It reads
  `public/privacy.html`, the static mirror — the copy Google's consent screen
  links to. The text users see *inside* the app comes from `src/terms/privacy.ts`
  through the JS bundle, and the gate is driven by the constant in
  `worker/policyVersions.js`; the mirror being right does not by itself mean the
  bundle is. The gate appearing on sign-in is what settled it, which is why that
  one click was worth more than any check available from here;
- ~~whether the acceptance gate actually re-presents after the version bump, and
  whether accepting it clears permanently~~ — resolved on 2026-07-29. It appeared,
  accepted, and did not return on reload. First real exercise of the re-acceptance
  path in `worker/policies.js`, and it worked;
- **whether anything about the new database only misbehaves under a few days of
  real use.** This is now unanswerable in the way that matters: the old database
  was deleted the same evening, so there is nothing to compare against and nothing
  to fall back to. The copy was verified thoroughly (row counts, cascades,
  migration records, a real write) and that is genuinely strong — but faithful at
  the moment of copying and durable in use are different claims, and only the first
  one was ever tested. D1 Time Travel is the remaining recourse; see §4;
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
pnpm test                # seven checks: deletion ×2, privacy, policies ×2, landing, appbase
pnpm test:migration      # the EU migration script's guardrails, against a stub
pnpm build               # tsc -b && vite build
pnpm lint                # 8 pre-existing problems, none from Week 3
dig MX fjellrute.no      # should list Cloudflare's three mail servers
git log --oneline -3     # cfecf1a, 0b7f157, 28b7824
git status --short       # only .claude/settings.local.json (§5), plus any later revision
npx wrangler d1 info fjellrute-db-eu       # jurisdiction eu — this is production
npx wrangler d1 list                       # one database; fjellrute-db is gone
npx wrangler d1 time-travel info fjellrute-db-eu   # the only recovery path left (§4)
grep -h "PRIVACY_VERSION = " src/terms/privacy.ts worker/policyVersions.js
curl -s https://fjellrute.gillesvandevyver1.workers.dev/privacy.html \
  | grep -c 'restricted to data centres'
```

Both `PRIVACY_VERSION` lines must read `2026-07-29`; if they ever differ, every
signed-in user is either permanently gated or never gated, which is what
`pnpm test:policies` exists to prevent. The `curl` should print `1` — the live
mirror carrying the EU-jurisdiction claim. It uses the `workers.dev` hostname
because that is the one `wrangler deploy` prints and therefore the one that is
certainly the deployment just made; `https://fjellrute.no/privacy.html` should
return the same bytes, and it is worth checking both, since that domain is
attached outside this config and so cannot be confirmed from the repo.

`d1 list` returning a single database is the expected state, not a problem: the
old one was deleted on 2026-07-29. If a second ever reappears, something created
it — check which one `wrangler.jsonc` binds before assuming which is live.

### Getting those commands to run at all

Two interpreter problems cost more time on 2026-07-29 than any of the code did,
both of them looking like broken tests rather than a wrong toolchain. Written
down so the next machine loses minutes instead of an evening.

**`pnpm: not found`, and `npm test` fails the same way. Fixed for good on
2026-07-29 — read this only if it comes back or you are on a new machine.** The
`test` script calls `pnpm` recursively, so npm cannot stand in for it: the failure
appears one level deeper (`sh: 1: pnpm: not found`) and looks like a broken script
rather than a missing tool. `package.json` pins `pnpm@10.11.1` in
`packageManager`, so the two working routes are:

```sh
corepack enable pnpm     # the real fix; needs Node ≥ 22.18, see below
npx pnpm@10.11.1 test    # the fallback that installs nothing
```

`corepack enable pnpm` had previously failed with `Cannot find matching keyid` — a
signature-verification bug in the Corepack bundled with older Node builds, not a
problem with this repo. Installing Node 22.18 replaced that Corepack and the
command succeeded, so `pnpm build`, `pnpm test` and the rest now work under their
own names. If a machine is stuck on an older Node, `npm i -g corepack@latest` also
clears it. Note that `npm build` is not a command (`npm run build` is), and that a
`(base)` conda prompt can shadow an already-installed `pnpm`.

**Node must be ≥ 22.18. Nothing in the repo enforces it and no error names it.**
Three independent reasons, in ascending order of version:

- Vite's own floor is Node 22.12, so `pnpm build` complains first.
- `verify-account-deletion.mjs` imports `node:sqlite` to run the real deletion
  code against a throwaway database. Before 22.13 that module exists only behind
  `--experimental-sqlite`, so the import dies with
  `ERR_UNKNOWN_BUILTIN_MODULE: No such built-in module: node:sqlite` before a
  single check runs. `NODE_OPTIONS=--experimental-sqlite` is the escape hatch.
- `verify-privacy-sync.mjs` imports `src/terms/privacy.ts` **directly**, because
  comparing against a re-typed copy of the policy would defeat the point. Node
  strips TypeScript unflagged only from **22.18**; on 22.6–22.17 it needs
  `--experimental-strip-types`, which `scripts/lib/type-stripping.mjs`
  supplies by re-executing the process, and below 22.6 it cannot work at all.
  That re-exec is why 22.14 appeared to be enough.

`22.18.0` is the recommended floor and is known-good: the full suite,
`pnpm test:migration`, `tsc -b`, `vite build` and a real `wrangler deploy` were
all run on it. Below Node 20 the scripts die earlier still, on `??` with
`SyntaxError: Unexpected token '?'`.

**There is still no `.nvmrc`, and `engines` pins only the package manager** —
which is precisely why an evening went on this twice. Adding `.nvmrc` with
`22.18` is free and advisory. Adding `"node": ">=22.18"` to `engines` is the
stronger version and would have named the problem outright, but pnpm treats an
`engines` mismatch as an install error, so it also means anyone on an older Node
cannot install at all until they upgrade. That is arguably the correct outcome
and is still a decision rather than a tidy-up.

## The state of the tree

**Clean as of `cfecf1a` ("Week 3 plan"), apart from `.claude/settings.local.json`
(§5) and whatever the current revision has touched.** Production and the
repository describe the same service again, which they briefly did not: for about
an hour on the evening of 2026-07-29 the policy change was deployed but
uncommitted, so the running Worker served code that existed in no commit. That is
the worse direction of the two mismatches, and committing ended it.

The one intentional divergence left is the duplicate R2 binding (§7): removed from
the repository, still present in the deployed Worker until something else ships.
Nothing reads it.

## Week 3, closed

The week's stated goal was GDPR and accounts hygiene, and against that:
policy-acceptance tracking exists and has now been exercised against a real user;
account deletion is tested, including its SQL; the database is restricted to EU
data centres and the privacy policy says so accurately rather than hopefully; the
retention cron purges session rows carrying IP addresses; the OAuth home page
explains what happens to Google user data; a plaintext dump of every account is
gone and so is the redundant second copy of the database.

What is left is a short list of decisions rather than work: whether to remove the
Google logo and end the verification loop (§1), a Gmail filter (§2), one untracked
config file (§5), and the optional items in §6. None of it blocks anything.

The one thing worth carrying into next week is not a task but a habit: the seven-day
rollback window in §4 was the only part of this week's plan that could not be
reconstructed afterwards, and it was the part that got skipped. Nothing came of it.
The lesson is cheap to keep and expensive to relearn.
