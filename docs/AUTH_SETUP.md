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
- `migrations/0001_auth_and_routes.sql` — auth tables (generated by Better
  Auth's own migration compiler for the installed version — don't edit those
  columns by hand) plus an empty `route` table ready for the upcoming
  save/share-routes feature (GeoJSON geometry, owner, share flag + slug).
- `src/auth/` — browser client and the client-side password policy.
- `src/components/LoginPage.tsx` — login, sign-up, verify-email, forgot- and
  reset-password views; `src/components/AccountChip.tsx` — signed-in
  indicator with log-out.
