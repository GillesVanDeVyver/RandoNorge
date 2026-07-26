# Sign-up / "/alpha" Freeze — Debugging Record

Status as of 2026-07-26: **localhost freeze fixed and confirmed. Production
(fjellrute.no) freeze diagnosed and a first fix applied (email-send timeout);
awaiting redeploy + `wrangler tail` confirmation and, most likely, Resend
domain verification.**

This document records the full investigation so it can be picked up later
without re-deriving everything.

---

## 1. The symptom

Reported behaviour:

- On `fjellrute.no/alpha` and `localhost:5173/alpha`, entering a **valid**
  invite code and submitting sign-up makes the app **freeze** (the form sits
  spinning / "one moment…").
- On localhost specifically: after closing the tab and reopening `/alpha`, the
  page **keeps loading until the dev server is restarted**.

There turned out to be **two distinct root causes** with overlapping symptoms —
one for localhost (dev-only) and one for production. Fixing the first masked it
locally but did nothing for production, because they are different bugs.

---

## 2. Cause A — localhost freeze (FIXED, confirmed by user)

### Root cause
In `wrangler.jsonc`, the D1 (`DB`) binding had `"remote": true`. With
`wrangler dev` (run without `--local`), that flag routes **every** query on
that binding to the **real production D1 over Cloudflare's remote-dev proxy**,
instead of the local SQLite copy. That proxy adds ~1s per query and funnels
everything through a single serializing object, so under the concurrency of a
real page load (the browser fires `get-session` at the same time as the
sign-up POST) the dev worker wedges. It self-heals after ~2 minutes but
effectively requires a restart.

### Fix (applied)
Removed `"remote": true` from the `DB` binding in `wrangler.jsonc` so
`wrangler dev` uses the **local** D1 copy (microsecond-fast, no proxy). The
comment above `d1_databases` was updated to explain this.

Note: the R2 `fjellrute_terrain` bucket still has `"remote": true`. That is
**intentional and unrelated** (terrain tiles), left alone.

### Important caveat
`"remote"` **only affects `wrangler dev`**. A deployed Worker
(`wrangler deploy`) always uses the real bound resource regardless of this
flag. **Therefore this edit changes nothing about production behaviour** — it
was never the production cause and cannot be the production fix.

---

## 3. Cause B — production freeze (DIAGNOSED, first fix applied)

### How it was isolated
`wrangler tail` was run against production while attempting a real sign-up.
Observed log lines (abridged):

```
GET  /api/auth/get-session      - Ok
GET  /assets/...woff2           - Ok   (x4)
GET  (workers.dev root)         - Ok
POST /api/account-exists        - Ok
   <-- no POST /api/auth/sign-up/email line ever appears -->
```

`wrangler tail` logs a request when it **completes**. Every request completed
except the sign-up POST, which never appeared → the sign-up request was **still
in-flight / hanging on the Worker**. (`/api/account-exists` is the client's
pre-check fired immediately before the real sign-up call, so we know the client
got that far.)

### Root cause
Walking the server-side sign-up path (`worker/index.js` →
`gatedEmailSignUp` → `getAuth().handler`), every step is bounded **except one**:

`worker/auth.js` has `emailAndPassword` + `emailVerification.sendOnSignUp:
true` + `requireEmailVerification: true`, so Better Auth **awaits**
`sendVerificationEmail` as part of the sign-up response. That calls `sendEmail`
in `worker/email.js`, which did:

```js
const res = await fetch('https://api.resend.com/emails', { ... });  // no timeout
```

On **localhost** this path is **stubbed** — `sendEmail` returns immediately
when `RESEND_API_KEY` is unset (it is unset in `.dev.vars`). That is exactly
why removing `remote:true` made localhost stop freezing: local D1 is fast AND
the email is a no-op.

On **production** the fetch is a real, awaited network call **with no timeout**.
If Resend stalls (unreachable, slow, TLS/DNS issue) or the sending domain isn't
verified, the sign-up response blocks — potentially indefinitely — and the form
freezes.

Bounded (ruled-out) steps in the same path, for the record:
- rate-limit read/write on the `rateLimit` table (Better Auth's current
  `consume()` in `node_modules/better-auth/.../rate-limiter/index.mjs` is
  bounded, **not** an infinite livelock — an earlier hypothesis, since
  discarded).
- invite validation (`validateInviteCode`, single D1 query).
- username hook (`validateUsername` + `isUsernameTaken`, single query;
  `deriveUniqueUsername` loops ≤7).
- the `user` INSERT.
- PBKDF2-SHA256 password hash (600k iterations, native WebCrypto — fast).

### Fix (applied, in `worker/email.js`)
Wrapped the Resend fetch in a 10s timeout via `AbortSignal.timeout(10000)` and
a `try/catch` that logs the real failure, then throws `Failed to send email`
as before. A stalled email now **fails fast and loudly** instead of freezing
sign-up. This is defensive: it bounds the hang regardless of the exact network
cause, and surfaces the underlying error in `wrangler tail`.

---

## 4. What to do next (pick up here)

1. **Deploy the fix:** `npx wrangler deploy` (production runs the last deployed
   code — the local edit is not live until you deploy).
2. **Re-run `npx wrangler tail`** and attempt a sign-up. The
   `POST /api/auth/sign-up/email` line should now **complete**, and the logs
   will reveal the true underlying cause:
   - `Resend request failed: TimeoutError…` or a DNS/TLS/network error → the
     Worker cannot reach Resend / the call stalls.
   - `Resend error 403: …` → the **fjellrute.no sending domain is not verified
     in Resend**. This is the most likely real cause (flagged as a required
     pre-deploy step in the `wrangler.jsonc` comment and in
     `docs/AUTH_SETUP.md`). Verify SPF/DKIM/return-path DNS in the Cloudflare
     `.no` zone until Resend shows the domain "Verified".
3. Confirm `RESEND_API_KEY` is set as a Worker secret in production
   (`npx wrangler secret list`) and `EMAIL_FROM` uses the verified domain.

---

## 5. Known secondary issue (not yet addressed)

The `user` row is created **before** the verification email is sent. If the
email keeps failing, the account exists but no mail goes out, and a retry with
the same address hits "account already exists" (via `/api/account-exists`) —
stranding the user. The timeout stops the *freeze* but does not fix this
stranding.

Options to consider once the freeze is confirmed resolved:
- Verify the Resend domain so the email simply succeeds (removes the problem at
  the source).
- Make the send non-blocking / roll back the account creation on send failure
  so a failed email doesn't leave a half-created account. (Better Auth's
  `sendVerificationEmail` callback doesn't receive the Worker `ctx`, so
  backgrounding via `ctx.waitUntil` isn't trivial from inside that callback —
  needs design.)

---

## 6. Files touched / relevant

- `wrangler.jsonc` — removed `"remote": true` from the `DB` binding (Cause A
  fix). **Uncommitted** as of this writing.
- `worker/email.js` — added `AbortSignal.timeout(10000)` + catch around the
  Resend fetch (Cause B fix). **Uncommitted** as of this writing.
- `worker/index.js` — `gatedEmailSignUp`, `rebuildJsonRequest` (a *previous*
  content-length hang fix, commit `389aea1`), `/api/account-exists`.
- `worker/auth.js` — Better Auth config (email verification, rate limit).
- `docs/AUTH_SETUP.md` — Resend / email setup reference.

Related prior commits (already on `origin/main`): `389aea1 Avoid stall on sign
up`, `959fb5b More error info on failed sign up`, `d14c0b8 Avoid blank
screens`.

---

## 7. Environment notes for the next session

- The debugging sandbox could **not** reach the user's running dev server
  (`localhost:5173`/`8787` returned connection-refused) and its Node is v12
  (too old for wrangler). Production was diagnosed purely from code reading +
  the user running `wrangler tail`. To reproduce/verify, run wrangler on the
  user's own machine.
