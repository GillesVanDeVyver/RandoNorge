# Sign-up / "/alpha" Freeze — Debugging Record

Status as of 2026-08-06: **there were two separate production bugs, one behind
the other.**

- **Cause C (section 4)** — Better Auth's rate-limit storage recursing without
  a ceiling on D1 — made every `/api/auth/*` request hang. Fixed and
  **deployed**; `/api/auth/ok` now answers in ~0.5 s.
- **Cause D (section 6)** — `worker/password.js` asking for 600,000 PBKDF2
  iterations, which Cloudflare refuses above 100,000 — made every sign-up and
  every sign-in fail with an **empty-bodied 500**, which the form showed as
  "Could not create the account. Please try again." Fixed in code; awaiting
  deploy.

Cause D was invisible while Cause C was unfixed: a request that hangs never
gets far enough to fail. Fixing C is what let D surface. **Read section 6
first** if sign-up is failing now; section 4 if it is hanging.

Causes A and B are real bugs that were really fixed, but B was not what froze
production. This document records the full investigation so it can be picked up
later without re-deriving everything, in the order the causes were found.

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

## 3. Cause B — the unbounded Resend fetch (REAL BUG, FIXED — but not the production freeze)

> **Superseded by section 4.** The timeout below is a good fix and is still in
> place, but it could never have cured the freeze: the request never reached
> `sendEmail`. The bullet marked ⚠️ in "Bounded (ruled-out) steps" is where this
> investigation went wrong.


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
- ⚠️ **This bullet was wrong — it is the actual cause. See section 4.**
  rate-limit read/write on the `rateLimit` table (Better Auth's current
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

## 4. Cause C — the production freeze (FOUND 2026-08-06, FIXED in code)

Reported again on 2026-08-06 with the July fixes long since deployed: the
"Create account" button stuck on "One moment…", no verification email. Same
two symptoms as Cause B, a different bug entirely.

### How it was isolated: probe the endpoints, not the sign-up

Cause B was diagnosed by reasoning down the sign-up path. Cause C was found by
refusing to assume the sign-up path was even reached. Every probe below is a
plain HTTPS request to production:

| Probe | Result |
| --- | --- |
| `GET /` (holding page) | immediate |
| `GET /metno-api/...` (Worker proxy) | immediate |
| `GET /api/public/profile/<nobody>` | immediate 404 — the Worker's own D1 query runs fine |
| `POST /api/account-exists` | immediate — the app's own D1-backed limiter runs fine |
| `GET /api/auth/get-session` | immediate |
| `POST /api/auth/sign-up/email` | **never answers** (cut off at the client timeout) |
| `GET /api/auth/ok` (Better Auth's own health route) | **never answers** |
| `GET /api/auth/<path-that-does-not-exist>` | **never answers** |

That last row is the whole diagnosis. A URL with **no endpoint behind it**
still hangs, so nothing route-specific can be responsible: not sign-up, not the
username hook, not `sendVerificationEmail`, not Resend. The hang is in
something that runs before Better Auth decides which route it is looking at.

It also settles the Worker's health in general: D1 is reachable, the Worker
itself is fine, and the app's own endpoints — including its own rate limiter —
all answer. Only `/api/auth/*` is affected.

### Root cause

Better Auth builds its router with `better-call`, which runs the `onRequest`
hook **before route matching**
(`node_modules/better-call/dist/router.mjs`, ~line 103):

```js
handler: async (request) => {
  const onReq = await config?.onRequest?.(request);   // <-- rate limiter
  if (onReq instanceof Response) return onReq;
  ...                                                  // <-- matching happens here
}
```

The hook is `onRequestRateLimit`. `worker/auth.js` had
`rateLimit: { enabled: true, storage: 'database', ... }`, so that hook called
Better Auth's own database storage wrapper, whose `consume()`
(`node_modules/better-auth/dist/api/rate-limiter/index.mjs`) is a
compare-and-set retry loop: whenever its guarded UPDATE reports that no row
changed, it calls **itself** —

```js
return consume(key, rule);
```

— at four separate sites, with **no attempt counter and no ceiling**. It is a
retry loop written on the assumption that the retry will eventually win.

On D1 through `kysely-d1` that assumption does not hold:

- The driver reports `numAffectedRows: undefined` — not `0` — when an UPDATE
  matches nothing (`node_modules/kysely-d1/dist/index.js`, ~line 84), so the
  "nothing changed, try again" branch is reachable on a run that will keep
  reporting the same thing.
- It cannot fall back to the adapter's transactional path at all:
  `beginTransaction()` throws `"Transactions are not supported yet."`
  (same file, ~line 98).
- One of the recursing branches calls `incrementOne` with an empty
  `increment: {}`.

So the loop never terminates, the `onRequest` hook never returns, and the
request is swallowed whole — before route matching, before any sign-up code,
before the username hook, before `sendVerificationEmail`.

**This explains both symptoms at once**, which the Cause B story never quite
did: the form freezes because the response never comes, and no email is sent
because nothing ever asked for one. It also explains the `wrangler tail`
output from July — `/api/account-exists` completes (it uses the app's own
bounded limiter) while `POST /api/auth/sign-up/email` never appears, because
`wrangler tail` only logs a request when it finishes.

### Why `/api/auth/get-session` looked healthy

It is the one auth route the SPA polls constantly. Its bucket is therefore
never stale, and it takes the single branch of `consume()` that returns instead
of recursing. A route nobody has touched in the current window — sign-up, `ok`,
a nonexistent path — takes a recursing branch. The one endpoint that appeared
to prove "auth is fine" was the only one that could not have shown the bug.

### Fix — server (`worker/rateLimit.js`, `worker/auth.js`)

`storage: 'database'` is replaced with
`customStorage: betterAuthRateLimitStorage(env)`. That storage is the app's own
limiter, which has **no loop at all**: one D1 upsert decides count, window and
verdict atomically, the same statement `/api/account-exists` and the invite
gate have used since migration 0005. Keys are namespaced `auth:<ip>:<path>` so
auth buckets cannot collide with the app's own in the shared
`app_rate_limit` table.

What is preserved:

- Durable, cross-isolate counts. (The default in-memory store would "fix" the
  freeze too, and quietly stop throttling anything: Cloudflare spreads requests
  over many short-lived isolates, so each one sees a sliver of an attack.)
- The per-route caps in `rateLimit.customRules`. Better Auth resolves the rule
  — window and max — *before* calling the storage, so `customRules` keep
  working untouched.
- Fail-open on a D1 error, so a transient database problem cannot lock every
  user out of a working site.

What changes: this is a **fixed** window (the count resets when `resetAt`
passes) where Better Auth's own backend rolls the window forward from the last
request. For throttling credential stuffing the difference is immaterial.

`get`/`set` are still implemented for real against Better Auth's own
`rateLimit` table rather than stubbed out. Better Auth uses `consume()` when it
is present, so they are currently dead code — but a future version that stopped
preferring `consume` would meet a no-op `get`, silently stop rate limiting
`/api/auth/*` altogether, and say nothing. That is the one outcome worse than
the freeze.

### Fix — client (`src/components/LoginPage.tsx`)

The server bug was only half of what the user saw. `performSignup` had no
timeout and no `catch`, and is invoked as `void performSignup()` — so a
rejected request was swallowed, `setBusy(false)` never ran, and the button
stayed on "One moment…" for ever. That would have survived the server fix and
turned any future stall into the same mystery.

Now: `setBusy(true)` / `setBusy(false)` sit in `try`/`finally` around the whole
attempt, the `/api/account-exists` pre-check carries
`AbortSignal.timeout(ACCOUNT_EXISTS_TIMEOUT_MS)`, and the sign-up call passes
`{ timeout: SIGNUP_TIMEOUT_MS }` to better-fetch (which honours it via
`getTimeout`; note better-fetch does **not** catch transport failures itself —
`node_modules/@better-fetch/fetch/dist/index.js` ~line 628 awaits `fetch` bare).
A stall now surfaces as "Sign-up did not respond. Check your connection and try
again." after 25s instead of an endless spinner.

Sign-up was what got reported, but every other button on the page — sign in,
resend, forgot password, reset password, Continue with Google — posts to the
same `/api/auth/*` handler and had the identical shape: no timeout, no catch,
`setBusy(false)` written out before each `return`. They were all frozen too;
nobody happened to be pressing them. They now share one helper, `authRequest`,
which passes `{ timeout: AUTH_TIMEOUT_MS }` and converts a throw into the same
`{ message }` an ordinary failure has, so each caller's existing error branch
covers a stall for free. Each of those handlers clears `busy` in a `finally`.
The single exception is `handleGoogle`, which deliberately keeps the flag on
success because the browser is leaving for Google — clearing it would flash the
button back to life on the way out.

### Regression test

`scripts/verify-rate-limit.mjs` (`pnpm test:ratelimit`, wired into `pnpm test`)
runs the real storage against an in-memory SQLite stand-in for D1 built from
migration 0005: it must terminate, enforce the cap, expire its window, keep
buckets separate, round-trip `get`/`set` without duplicating rows, and fail
open on a dead database. It then checks the wiring — that `worker/auth.js`
still passes `customStorage` and has **not** drifted back to
`storage: 'database'`, that the per-route caps and the `cf-connecting-ip`
header survive — and the client guards, including that no `authClient` call
sneaks past `authRequest`. A control section mutates each of those back to the
broken form to prove the checks actually catch them.

### What this rules out

Resend and the sending domain (verified 2026-07-21), the EU D1 migration, the
invite gate, `rebuildJsonRequest`'s content-length handling, and D1 health
generally. None of them were ever in the path of the hang.

---

## 5. Deploying and confirming the fixes

Cause C's fix is **already deployed and confirmed**: `/api/auth/ok` answers in
~0.5 s and `/api/auth/does-not-exist` returns a prompt 404, where both hung
before. Cause D's fix is not deployed yet. Steps for it:

1. `pnpm test` — `test:ratelimit` and the new `test:password` must pass.
2. `pnpm lint && pnpm build`.
3. `npx wrangler deploy`. (No migration: nothing about the schema changed.)
4. The fastest signal, and one that needs no account —

   ```
   curl -s -o /dev/null -w '%{http_code} %{size_download}\n' \
     -X POST https://fjellrute.no/api/auth/sign-in/email \
     -H 'Content-Type: application/json' \
     -d '{"email":"nobody-xyz@example.com","password":"SomePassword123"}'
   ```

   Before the fix: `500 0` — a 500 with an empty body. After: `401` with a JSON
   `INVALID_EMAIL_OR_PASSWORD`. A nonexistent address still hashes a password,
   so this exercises the exact broken code path without creating anything.
5. Then a real sign-up with a fresh address. Keep `npx wrangler tail` open.
6. If anything still fails, the log is now useful: `runAuthHandler` prints the
   real error and the client receives `AUTH_INTERNAL_ERROR` instead of a
   parseless empty body. Watch for `Resend request failed` / `Resend error 403`
   in particular — the email step (section 3) has never been exercised end to
   end in production, because sign-up has not completed since 22 July.

Note that any account created during the freeze exists but was never sent an
email; see section 7.

---

## 6. Cause D — PBKDF2 above the platform cap (FOUND 2026-08-06, FIXED in code)

### The symptom, after Cause C was deployed

The freeze was gone. Sign-up now returned quickly with **"Could not create the
account. Please try again."** — the form's catch-all, which fires when the
server's error carries no message it recognises. On the wire the response was
`HTTP 500` with a **zero-byte body**.

### How it was isolated: sort the endpoints into working and failing

An empty 500 says nothing, so the only way forward was to find what the failing
requests had in common. Probing production directly:

| Probe (production) | Result |
| --- | --- |
| `GET /api/auth/ok` | 200 `{"ok":true}` |
| `GET /api/auth/get-session` | 200 `null` |
| `POST /api/auth/request-password-reset` | 200, generic "check your email" |
| `POST /api/auth/sign-out` | 200 `{"success":true}` |
| `POST /api/auth/sign-in/email`, bad JSON | 400 `BAD_REQUEST` |
| `POST /api/auth/sign-in/email`, empty body | 400 `VALIDATION_ERROR` |
| `POST /api/auth/sign-in/email`, **valid shape** | **500, 0 bytes** |
| `POST /api/auth/sign-up/email`, bad invite code | 403 `INVALID_INVITE_CODE` |
| `POST /api/auth/sign-up/email`, **valid** | **500, 0 bytes** |

Three things fall out of that table:

1. **It is not sign-up.** Plain `sign-in/email` fails the same way, so the
   username hook in `worker/auth.js` — the obvious suspect, since the form was
   submitting a username — is innocent.
2. **It is not the database, the adapter, or a missing migration.**
   `request-password-reset` looks a user up by email and answers 200.
   Validation runs (400s prove the body is parsed and the route is matched), so
   the request reaches the handler and dies inside it.
3. **What the two failing routes share is a password.** Every endpoint that
   works never hashes one. Sign-in hashes even for an address that does not
   exist — `sign-in.mjs:207` calls `ctx.context.password.hash(password)` on the
   not-found branch deliberately, so a missing account and a wrong password
   take the same time.

Timing confirmed it before any code was read. The failing 500 came back in
**0.21 s**, while the *successful* `request-password-reset` took **0.32 s**.
The failure is faster than the success, so no work is being done: this is an
immediate rejection, not a computation timing out or exhausting CPU.

### Root cause

`worker/password.js` had used 600,000 PBKDF2-SHA-256 iterations since
2026-07-23 (commit `7fa7cf1`, "Fix most important security issues", which
raised it from 100,000). That follows OWASP guidance. **Cloudflare does not
allow it.** Workers cap PBKDF2 at 100,000 iterations so a single request cannot
burn unbounded CPU, and `crypto.subtle.deriveBits` rejects anything above the
cap outright:

```
NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not supported
```

So `hashPassword` threw on every call, and both flows that call it — every
sign-up, every sign-in — failed 100% of the time from 2026-07-23 onward. The
last accounts to be created successfully date from 19–22 July, just before the
change.

### Why nothing local could catch it

**The cap is enforced only by the production runtime.** `wrangler dev` runs a
local workerd that computes 600,000 iterations without complaint. Throughout
the outage, sign-up worked perfectly on localhost — the identical payload that
returned an empty 500 on `fjellrute.no` returned `200` with a created user on
`127.0.0.1:8787`. Local success carried no information at all.

This is worth remembering as a class of bug: **a limit that exists only in
production is untestable by running the code.** The only defence is to check
the *value* against the documented limit, which is what section 1 of
`scripts/verify-password-hash.mjs` now does, plus a load-time throw in
`worker/password.js` so an illegal value fails the deploy rather than the user.

### Why the error was invisible for two weeks

`NotSupportedError` is a plain error, not a Better Auth `APIError`. better-call
(`node_modules/better-call/dist/router.mjs:93–98`) answers anything it does not
recognise with:

```js
console.error(`# SERVER_ERROR: `, error);
return new Response(null, { status: 500, statusText: "Internal Server Error" });
```

A 500 with **no body**. The auth client has nothing to parse, so `error.message`
is undefined, so `LoginPage.tsx` falls through to its generic branch. The server
knew the exact cause — a one-line, perfectly explicit error message — and put
it somewhere only `wrangler tail` could see it. Everything the user and the
debugger had to work with was "Please try again".

That is the second time in this document an empty 500 cost days (see section 3),
so it is now fixed as its own defect, independently of the cap.

### Fix — the hash (`worker/password.js`)

`ITERATIONS` is pinned to 100,000, the platform maximum, with `MAX_ITERATIONS`
recording the cap and a module-load `throw` if the two ever cross. Because the
iteration count travels inside the stored hash
(`pbkdf2-sha256$<iterations>$<salt>$<key>`), every existing account — all of
them 100,000 — keeps verifying untouched.

`verifyPassword` now returns `false`, rather than throwing, for a stored hash
above the cap. Such a hash cannot be recomputed, so there is no way to tell
whether the password matches; answering "no" turns it into an ordinary failed
login that a password reset can clear, instead of a permanent 500.

**100,000 is a ceiling, not a preference.** Going higher means chaining
derivations (feeding one 100,000-iteration output in as the next call's input),
which multiplies CPU proportionally. A single 100,000-iteration hash measures
~20 ms of CPU on ordinary hardware, so an OWASP-compliant 600,000 would cost
~120 ms — past the free plan's 10 ms budget and past the paid plan's 50 ms
default. Raising it needs a paid plan with a raised CPU limit, chaining, *and*
measurement on the real runtime. It is not a one-line change, and the one-line
version is what caused this outage.

### Fix — never ship a bodiless 500 again (`worker/auth.js`, `worker/index.js`)

`onAPIError: { throw: true }` makes better-call rethrow the errors it does not
recognise instead of swallowing them into an empty response. This does **not**
affect Better Auth's deliberate errors: APIErrors are re-caught inside the
router and converted to their normal 401/403/422/429 responses, and OAuth's
`FOUND` redirect is returned before the hook is consulted. Verified locally —
a taken username still returns `422 {"message":"that username is taken"}`.

What escapes is genuine faults, and `runAuthHandler()` in `worker/index.js` now
wraps all three call sites into Better Auth's handler, logging the real error
and returning:

```json
{ "message": "Something went wrong on our side. Please try again shortly.",
  "code": "AUTH_INTERNAL_ERROR" }
```

Confirmed by temporarily making `hashPassword` throw the production error
locally: before, an empty 500; after, that JSON with a logged cause.

### Regression test

`scripts/verify-password-hash.mjs` (`pnpm test:password`, also run by
`pnpm test`) checks the iteration count against the cap statically, round-trips
hashing and verification, requires an old lower-iteration hash to still verify
and an above-cap hash to return false rather than throw, and asserts the
no-empty-500 wiring — including that no route calls `getAuth().handler()`
outside the guard. Its control section plants each fault, the 600,000 change
included, and requires the checks to catch them.

`stripComments` now lives in `scripts/lib/strip-comments.mjs` instead of being
copied into each verify script; the copies had already diverged, and its
argument-order trap (line comments first, or a comment containing `/*` eats
live code) is the kind of thing that should be explained in exactly one place.

### What this does *not* explain

Nothing observed is still unaccounted for, but note two things that looked
suspicious and were ruled out: `/api/auth/forget-password` returns 404 because
the route is named `/api/auth/request-password-reset` in this version, not
because anything is broken; and migration 0007's columns are present — dropping
them locally produces a clean 422, not an empty 500.

---

## 7. Known secondary issue (not yet addressed)

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

## 8. Files touched / relevant

Cause D (2026-08-06):

- `worker/password.js` — `ITERATIONS` 600,000 → 100,000, a `MAX_ITERATIONS`
  constant recording the platform cap, a load-time throw if they ever cross,
  and `verifyPassword` returning false instead of throwing on an above-cap
  hash. The comment at the top is the short version of section 6.
- `worker/auth.js` — `onAPIError: { throw: true }`.
- `worker/index.js` — new `runAuthHandler()`; all three calls into Better
  Auth's handler now go through it.
- `scripts/verify-password-hash.mjs` + `package.json` — the regression test
  (`pnpm test:password`, also run by `pnpm test`).
- `scripts/lib/strip-comments.mjs` — `stripComments` extracted from
  `verify-app-base.mjs` and `verify-rate-limit.mjs`, which now import it.

Cause C (2026-08-06):

- `worker/rateLimit.js` — new `betterAuthRateLimitStorage()`; the long comment
  on it is the short version of section 4 and should be read before anyone
  changes the storage back.
- `worker/auth.js` — `storage: 'database'` → `customStorage:
  betterAuthRateLimitStorage(env)`.
- `src/components/LoginPage.tsx` — the `authRequest` helper (timeout + catch)
  behind every auth call, `try`/`finally` around the busy flag in every
  handler, an abort signal on both `/api/account-exists` pre-checks, and real
  error messages when they fire.
- `scripts/verify-rate-limit.mjs` + `package.json` — the regression test
  (`pnpm test:ratelimit`, also run by `pnpm test`).
- `migrations/0005_rate_limit.sql` — comment only, correcting the note that
  said `/api/auth/*` uses `storage:"database"`.

Causes A and B (2026-07-26, since committed):

- `wrangler.jsonc` — removed `"remote": true` from the `DB` binding (Cause A
  fix).
- `worker/email.js` — added `AbortSignal.timeout(10000)` + catch around the
  Resend fetch (Cause B fix).
- `worker/index.js` — `gatedEmailSignUp`, `rebuildJsonRequest` (a *previous*
  content-length hang fix, commit `389aea1`), `/api/account-exists`.
- `docs/AUTH_SETUP.md` — Resend / email setup reference.

Related prior commits (already on `origin/main`): `389aea1 Avoid stall on sign
up`, `959fb5b More error info on failed sign up`, `d14c0b8 Avoid blank
screens`, `7c456f5` (the Cause B email timeout).

---

## 9. Environment notes for the next session

- The debugging sandbox cannot reach the user's dev server
  (`localhost:5173`/`8787` are connection-refused from it) and its system Node
  is v12 — too old for wrangler, for `tsc`, and (v20 too) for the
  `node:sqlite` the verify scripts use. Cause C was diagnosed with plain HTTPS
  probes against **production** plus reading `node_modules`; the fix was
  verified with `tsc`, `eslint`, `vite build` and `pnpm test` under a
  downloaded Node 22. Anything needing `wrangler` still has to run on the
  user's own machine.
- The lesson from Cause B worth keeping: an endpoint that answers proves only
  that *that* endpoint answers. When a whole path prefix hangs, probe a URL
  under it that has no handler at all — if that hangs too, everything
  route-specific is innocent and the bug is in a hook that runs before
  matching.
- The lesson from Cause D: when the error body is empty, **sort the endpoints
  into working and failing and look for what the failing ones share.** Both
  failing routes hashed a password; none of the working ones did. That named
  the file before any of its code was read. Timing is part of the evidence too
  — a failure that returns *faster* than a success is doing no work, which
  rules out timeouts and CPU limits and points at an immediate rejection.
- And the lesson that cost the most: **`wrangler dev` does not enforce every
  production limit.** Local workerd computed the 600,000-iteration hash that
  the real runtime refuses, so localhost was green for two weeks while
  production was broken for everyone. When something works locally and fails
  in production, "it works on my machine" is evidence about the *runtime*, not
  about the code.
