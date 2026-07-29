# Authentication setup

Login is built with [Better Auth](https://www.better-auth.com) running inside
the existing Cloudflare Worker, with accounts stored in a D1 database and
verification emails sent through [Resend](https://resend.com). Everything fits
in Cloudflare's and Resend's free tiers.

What users get: email + password sign-up with mandatory email confirmation,
log in / log out, password reset by email, "Continue with Google" (one-click
OAuth, no email confirmation step), and "Continue as guest" exactly as
before. Password policy follows NIST 800-63B: minimum 8 characters, no forced
symbol rules, very common passwords rejected, with a strength hint in the form.

## One-time setup (production)

1. **Create the D1 database** (once):

   ```sh
   npx wrangler d1 create fjellrute-db
   ```

   Copy the `database_id` it prints into `wrangler.jsonc`, replacing
   `REPLACE_WITH_ID_FROM_wrangler_d1_create`.

2. **Apply the schema** (also after any future migration):

   ```sh
   npx wrangler d1 migrations apply fjellrute-db --remote
   ```

3. **Set the session-signing secret** (any long random string):

   ```sh
   openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET
   ```

4. **Connect Resend** (can be done later — until then, verification emails
   are not delivered but the links appear in `npx wrangler tail`):

   - Create a free account at resend.com (3,000 emails/month).
   - Create an API key and store it:

     ```sh
     npx wrangler secret put RESEND_API_KEY
     ```

   - For real users, verify a sending domain in the Resend dashboard and set
     the sender as a Worker variable, e.g. in `wrangler.jsonc`:

     ```jsonc
     "vars": { "EMAIL_FROM": "Fjellrute <no-reply@yourdomain.no>" }
     ```

     Without `EMAIL_FROM`, the default `onboarding@resend.dev` is used, which
     only delivers to the Resend account owner's own address (fine for
     testing).

   > **Done — 2026-07-21:** `fjellrute.no` is **Verified in Resend** and auth
   > email is live. SPF + DKIM (`resend._domainkey`) + a `send.fjellrute.no`
   > return-path (Amazon SES MX/SPF) + a DMARC record (`_dmarc`,
   > `v=DMARC1; p=none; rua=mailto:hei@fjellrute.no`) are all in the Cloudflare
   > `.no` zone; mail-tester scores 10/10 and verification mail reaches the
   > inbox. Sender is `EMAIL_FROM = "Fjellrute <no-reply@fjellrute.no>"`
   > (`wrangler.jsonc`). `RESEND_API_KEY` is set as a Worker secret.
   >
   > Caveat: the DMARC `rua=` points at `hei@fjellrute.no`, which is **not set
   > up yet** — DMARC aggregate reports sent there are silently dropped. This
   > is harmless (policy is monitor-only `p=none`); set up that mailbox via
   > Cloudflare Email Routing later if you want to read the reports, or drop
   > the `rua=` part from the DMARC record.

5. **Set up "Continue with Google"** (optional — the button shows an error
   until this is done, everything else keeps working):

   1. In the [Google Cloud console](https://console.cloud.google.com/),
      create (or pick) a project, then go to **APIs & Services → OAuth
      consent screen** and configure it as an *External* app (app name,
      support email; no scopes beyond the default email/profile needed).
   2. Under **APIs & Services → Credentials**, create an **OAuth client ID**
      of type *Web application* and add the authorized redirect URI:

      ```
      https://YOUR_PRODUCTION_DOMAIN/api/auth/callback/google
      ```

      For local development also add:

      ```
      http://localhost:5173/api/auth/callback/google
      ```

   3. Store the credentials — the client ID as a Worker variable in
      `wrangler.jsonc`:

      ```jsonc
      "vars": { "GOOGLE_CLIENT_ID": "1234...apps.googleusercontent.com" }
      ```

      and the client secret as a secret:

      ```sh
      npx wrangler secret put GOOGLE_CLIENT_SECRET
      ```

   Google sign-ins arrive with a verified email address, so these users skip
   the confirmation-email step. If an email/password account with the same
   address already exists, the Google login is linked to it (account linking
   is enabled in `worker/auth.js`), so nobody ends up with duplicate
   accounts. While the consent screen is in Google's "Testing" mode, only
   test users you list there can sign in — publish it for real users.

   > **Done — 2026-07-21:** OAuth consent screen **published to production**
   > (out of Testing mode), so any Google user can sign in. Authorized
   > redirect URI `https://fjellrute.no/api/auth/callback/google` added to
   > the OAuth client (`14850983815-...apps.googleusercontent.com`).

   ### Consent screen fields as entered

   These live only in the Google Cloud console, so nothing in the repository can
   verify them and they were unrecorded until Week 3. The privacy-policy link
   matters more than it looks: it is the entire reason `public/privacy.html`
   exists as a static mirror, and if it points somewhere stale it is the one
   piece of the policy a user sees *before* deciding to trust the app.

   Check them at **Google Cloud console → APIs & Services → OAuth consent
   screen → Branding** (older console layouts show these on the consent-screen
   *Edit app* form), and fill in what is actually there:

   | Field | Should be | Verified as |
   | --- | --- | --- |
   | App name | Fjellrute | `Fjellrute` — read from the Branding screen 2026-07-29 |
   | User support email | | `fjellrute@gmail.com` — 2026-07-29 |
   | Application home page | `https://fjellrute.no/` (serves `coming-soon.html` during the closed alpha; the app itself is at `/alpha/`) | `https://fjellrute.no` — no trailing slash, which resolves to the same page — 2026-07-29 |
   | Privacy policy link | `https://fjellrute.no/privacy.html` | `https://fjellrute.no/privacy.html` — as intended, 2026-07-29 |
   | Terms of service link | Empty, or a URL that actually resolves. There is **no** `public/terms.html` — the terms exist only in-app via `src/terms/content.ts`, so any `fjellrute.no/terms…` URL entered here 404s | Empty — the trap described here was never walked into, 2026-07-29 |
   | Authorized domain | `fjellrute.no` | **Two** domains: `fjellrute.no` *and* `gillesvandevyver1.workers.dev` — 2026-07-29. See below |
   | Publishing status | In production | In production — read from the **Audience** page, 2026-07-29 |

   Also on that screen, not previously listed: **Developer contact information** is
   `fjellrute@gmail.com`, and an **app logo is uploaded** (a teal square with a
   white mountain glyph).

   That logo is worth knowing about, because it is the reason any of this
   verification exists. With only the default email/profile scopes an app does
   not need verifying — but the console's own note on that field says a logo
   requires the app to be submitted for verification unless it is internal-only
   or in Testing. The failure mode is correspondingly mild, and the console
   states it plainly: *"Your branding is not being shown to users."* Unverified
   branding means the consent screen falls back to showing the URL instead of the
   logo. Removing the logo would end the verification requirement altogether.

   The second authorized domain, `gillesvandevyver1.workers.dev`, is the Worker's
   default hostname, and it is load-bearing rather than leftover. The OAuth client
   carries three redirect URIs, checked 2026-07-29:

   ```
   https://fjellrute.gillesvandevyver1.workers.dev/api/auth/callback/google
   http://localhost:5173/api/auth/callback/google
   https://fjellrute.no/api/auth/callback/google
   ```

   `wrangler.jsonc` sets neither `workers_dev: false` nor a `routes` block, so the
   default subdomain stays enabled, and `https://fjellrute.gillesvandevyver1.workers.dev/`
   does serve the same landing page today. That is the fallback URL used by
   `docs/SECURITY-REVIEW-2026-07-23.md`, `docs/SIGNUP_FREEZE_DEBUGGING.md` and
   `deploy_instructions.md` when the custom domain is in doubt — so the first
   redirect URI is what makes Google sign-in testable there.

   The tension: the Branding screen warns that authorized domains must be
   verifiable in Google Search Console, and `workers.dev` cannot be verified as a
   *domain* property, because it is Cloudflare's domain and no TXT record can be
   added to it. A URL-prefix property for the subdomain could in principle be
   verified with a meta tag or file served by the Worker, but whether Cloud
   console accepts a URL-prefix property as an authorized domain is untested here.
   Removing both the URI and the domain costs only Google sign-in on the fallback
   hostname; email/password sign-in there is unaffected. Note that neither of the
   two findings open on 2026-07-29 mentions domains, so this is precautionary
   tidying, not a known blocker — the earlier domain-ownership finding disappeared
   once `fjellrute.no` was verified.

   `localhost` needs no authorized domain; Google exempts it.

   Confirm the privacy link resolves for a signed-out visitor in a private
   window, not just for you: `https://fjellrute.no/privacy.html` is served by
   the assets binding and the closed-alpha intercept in `worker/index.js`
   captures only the exact path `/`, so it should load — but that is the
   assumption worth testing rather than trusting, since the consent screen
   depends on it.

   ### OAuth verification: what failed, and what fixed it

   Google's verification review rejected the app on 2026-07-28 with four
   findings, all about the **application home page** — which, because the home
   page URL is the bare domain, means `public/coming-soon.html` (served for `/`
   by `worker/index.js`).

   | Google's finding | Status |
   | --- | --- |
   | The app name "Fjellrute" on the consent screen does not match the app name on your home page | Fixed in the page: `<h1>Fjellrute</h1>` is now real visible text, not only the wordmark |
   | Your home page does not explain the purpose of your app | Fixed: the page now has a "What Fjellrute is" section describing what the service does, in both languages |
   | Your home page is behind a login page | Fixed / was a misreading: `/` never required a session, but the old page said only "Kommer snart" with no content, which reads as a holding page in front of a login. There is now something to read |
   | The website of your home page URL `https://fjellrute.no` is not registered to you. Verify ownership of your home page | **Not fixable from the repository — see below** |

   Three of those are content requirements that nothing in a build can notice
   breaking, so `pnpm test:landing` (`scripts/verify-landing-page.mjs`) now
   asserts them: one `<h1>` reading exactly the app name from the table above,
   the purpose section present in *script-free* HTML, both languages static
   with the script only hiding one, no authentication call ahead of the root
   intercept in `worker/index.js`, and every same-origin link resolving to a
   real file in `public/`. It reads the expected app name out of the table
   above, so renaming the app on the consent screen means updating that row and
   the test will then require the page to follow.

   Two content notes worth keeping in mind when editing that page:

   - Both languages ship in the static HTML and JavaScript only hides one.
     Moving copy back into the script would satisfy a browser and fail a
     reviewer or crawler, which is the failure mode the test guards.
   - The `<meta name="robots" content="noindex">` the page carried from its
     closed-alpha life was **removed on 2026-07-29** and replaced by a
     `<link rel="canonical" href="https://fjellrute.no/">`. The reasoning is in
     the comment left in its place: the branding review kept returning the same
     two findings, both of them absences rather than disagreements, and bounced a
     resubmission straight back to "resolve the issues" without queueing a
     review — the signature of a checker that read no text. `noindex` was the
     only line on the page addressed to Google's automated side, so it went
     first. The canonical is there because the identical page is also served at
     `https://fjellrute.gillesvandevyver1.workers.dev/`, and an indexable page
     with a live duplicate should say which copy is the real one. Accepted
     consequence: `fjellrute.no` can now appear in search results.

   #### Verifying domain ownership (only Gilles can do this)

   Google will not accept a home page on a domain it cannot tie to the account
   that owns the Cloud project. The fix is to prove ownership of `fjellrute.no`
   in Google Search Console, using **the same Google account that owns the
   OAuth client**:

   1. Sign in to <https://search.google.com/search-console/> with that account.
   2. **Add property → Domain** (the left-hand option, not "URL prefix"), and
      enter `fjellrute.no`.
   3. It will show one `TXT` record to add. In the Cloudflare dashboard, open
      the `fjellrute.no` zone → **DNS → Records → Add record**: type `TXT`,
      name `@`, content the `google-site-verification=…` string it gave.
   4. Save, then press **Verify** in Search Console. Cloudflare publishes DNS
      changes in seconds, so this usually passes on the first try.
   5. Leave the TXT record in place permanently — removing it un-verifies the
      domain.
   6. Back in the Google Cloud console, resubmit the app for verification.

   The `.no` zone already holds SPF, DKIM and DMARC records added for Resend
   (step 4 above), so this is the same kind of edit in the same place.

   **Verified in Search Console on:** 2026-07-28 — the date the Week 3 audit
   recorded the `google-site-verification=zgnw5kNLNCDG_…` TXT record as live on
   `fjellrute.no`, with the two OAuth findings about domain ownership gone
   (`docs/WEEK3-GDPR-CHECK-2026-07-28.md`). Nobody watched the **Verify** button
   being pressed, so if it happened on a different day, correct this line. It is
   recorded only so that the age of the TXT record is knowable; the record
   itself must stay in place permanently.

6. **Deploy** as usual: `npm run build && npx wrangler deploy`.

## Local development

```sh
npx wrangler d1 migrations apply fjellrute-db --local   # once
npm run build && npx wrangler dev                        # worker on :8787
npm run dev                                              # vite on :5173
```

The Vite dev server proxies `/api/*` to the Worker on port 8787, so the login
flows work at the Vite URL. Without `RESEND_API_KEY` set locally, the
verification/reset links are printed in the wrangler console — open them in
the browser to complete the flow.

To test Google sign-in locally, put the credentials in a `.dev.vars` file
(git-ignored) next to `wrangler.jsonc`:

```
GOOGLE_CLIENT_ID=1234...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
```

Without them the Google button simply reports that the provider isn't
configured; everything else works.

## Implementation notes

- `worker/auth.js` — Better Auth configuration (D1 via `kysely-d1`,
  email verification required, rate limiting on).
- `worker/password.js` — PBKDF2-SHA-256 hashing through native WebCrypto.
  Better Auth's default scrypt is pure JS (~80 ms CPU) and exceeds the
  Workers free plan's 10 ms CPU budget; native PBKDF2 stays within it. The
  iteration count is stored inside each hash, so it can be raised later
  (e.g. on a paid plan) without breaking existing accounts.
- `worker/email.js` — Resend API wrapper + shared email template; falls back
  to logging when `RESEND_API_KEY` is unset.
- `worker/account.js` — `DELETE /api/account`, self-service account deletion
  (GDPR art. 17). See the contract below.
- `migrations/0001_auth_and_routes.sql` — auth tables (generated by Better
  Auth's own migration compiler for the installed version — don't edit those
  columns by hand) plus an empty `route` table ready for the upcoming
  save/share-routes feature (GeoJSON geometry, owner, share flag + slug).
- `src/auth/` — browser client and the client-side password policy.
- `src/components/LoginPage.tsx` — login, sign-up, verify-email, forgot- and
  reset-password views; `src/components/AccountChip.tsx` — signed-in
  indicator with log-out.

## Account deletion — `DELETE /api/account`

Permanently deletes the signed-in user. Implemented in `worker/account.js`;
the same statements run by hand are documented in `docs/REMOVE_USER.md`.

Request body:

```json
{ "confirm": "user@example.com", "password": "their current password" }
```

`confirm` must be the caller's own email address (compared case-insensitively)
— the anti-accident guard. `password` is required and verified only when the
account actually has one, i.e. it signed up with email/password. Accounts that
exist solely through "Continue with Google" have no password to check, so for
them `confirm` is the only guard; a one-time email confirmation link would
close that gap and is not built yet.

Responses:

| Status | Meaning |
| --- | --- |
| `200 {"deleted":true}` | Gone. Carries `Set-Cookie` headers that clear the session. |
| `401` | No valid session. |
| `403` | Password incorrect. |
| `422` | `confirm` missing or not the caller's address; or password required and absent (`X-Reauth: password`). |
| `429` | More than five attempts from one IP in an hour. `Retry-After` in seconds. |
| `405` | Method other than DELETE. |

What goes: the `user` row, cascading to `session` (with its stored IP and user
agent), `account` (password hash and any linked Google identity), `route` and
`track`; plus `verification` and `invite_redemption`, which are keyed by email
address and therefore do not cascade. Nothing of the user lives outside D1.

Whoever builds the UI: collect the address and password in a confirm dialog,
send the DELETE, and on `200` treat the user as signed out — the response
already clears the cookie. After that lands, soften the "email us for account
deletion" sentence in privacy policy §6 (`src/terms/privacy.ts` **and**
`public/privacy.html`).

Run `pnpm test:deletion` after touching any of this.
