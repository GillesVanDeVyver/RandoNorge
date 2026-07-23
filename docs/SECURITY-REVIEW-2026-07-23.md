# Security review — Fjellrute / RandoNorge

**Date:** 2026-07-23
**Scope:** Full source tree (Cloudflare Worker backend, React frontend, D1 migrations, build output, git history, committed config and docs).
**Stack:** Cloudflare Workers (`worker/`) + Better Auth + D1 (SQLite) + R2, React/Vite SPA (`src/`).

## Executive summary

The application is in good shape. No live secrets are committed anywhere — not in the config, not in the built bundle, and not in git history. The backend is written defensively: every database query is parameterized, ownership is enforced in SQL on all authenticated endpoints, and passwords are hashed with salted PBKDF2 and compared in constant time.

The findings below are almost all defense-in-depth improvements rather than active holes. The two worth prioritizing are the complete absence of HTTP security headers (medium) and the weak, per-isolate rate limiting on the auth endpoints (medium). One privacy item — a personal email address hardcoded as the API User-Agent — is also worth changing.

## Answering the direct questions

**Are there any secrets public that should be private?** No live secrets are exposed. `.dev.vars` is correctly git-ignored and is not tracked. `wrangler.jsonc` contains only non-secret values (the `EMAIL_FROM` address, the Google OAuth **client ID**, and the D1 `database_id`) — all of these are safe to commit, since the client ID is public by design and the database ID is useless without your Cloudflare account credentials. The real secrets (`BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`) are all kept as Worker secrets and never appear in the tree. A scan of the full git history and of `dist/` turned up nothing. There are two soft "exposure" items noted below (a personal email in the User-Agent, and a saved authenticated Google web page committed under `docs/dpa/`), but neither is a credential.

**Are there any other vulnerabilities?** Nothing critical. No SQL injection (all queries use bound parameters), no IDOR (ownership is enforced in the `WHERE` clause on every authenticated read/write/delete), no XSS sink in production code, and no XXE (XML is parsed with the browser's `DOMParser`, which does not resolve external entities). The issues found are the header/rate-limiting/hardening items listed below.

## Findings

| # | Severity | Finding |
|---|----------|---------|
| 1 | Medium | No HTTP security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) on any response |
| 2 | Medium | Auth rate limiting is per-isolate in-memory; weak against distributed brute force. `/api/account-exists` has no rate limit at all |
| 3 | Low-Med | Deliberate account enumeration via `/api/account-exists` (unauthenticated, unthrottled) |
| 4 | Low | PBKDF2 iteration count (100,000) is below current OWASP guidance (600,000 for PBKDF2-HMAC-SHA256) |
| 5 | Low | Personal email `tryggve@sonofit.no` hardcoded as the upstream API User-Agent |
| 6 | Low | Auth emails build HTML by string interpolation without escaping |
| 7 | Low | `worker/proxy.js` is an open, cacheable GET proxy to three fixed hosts |
| 8 | Low | Saved, authenticated Google Cloud web page (with an `xsrf_token`) committed under `docs/dpa/` |

### 1. Missing HTTP security headers (Medium)

No response from the Worker — neither the API nor the served SPA — sets any security header. There is no Content-Security-Policy, no Strict-Transport-Security (HSTS), no X-Frame-Options / `frame-ancestors` (so the app can be framed for clickjacking), no X-Content-Type-Options, and no Referrer-Policy.

Fix: add a small header-stamping step in `worker/index.js` that wraps the final response (both `env.ASSETS.fetch` and the API responses). At minimum: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` (or a CSP `frame-ancestors 'none'`), and a Content-Security-Policy tuned to your MapLibre/Leaflet/tile origins.

### 2. Weak rate limiting (Medium)

`auth.js` enables Better Auth's rate limiting with `rateLimit: { enabled: true }`, which uses the default **in-memory** store. On Cloudflare Workers requests are spread across many short-lived isolates worldwide, so an in-memory counter sees only a fraction of traffic — it does not meaningfully throttle a distributed brute-force or credential-stuffing attack. Separately, the custom `/api/account-exists` endpoint has no rate limiting whatsoever.

Fix: back Better Auth's rate limiter with a durable store (D1, KV, or a Durable Object) so counts are shared, and/or add a Cloudflare Rate Limiting rule in front of `/api/auth/*` and `/api/account-exists`. Apply an explicit limit to `/api/account-exists`.

### 3. Account enumeration by design (Low-Medium)

`/api/account-exists` intentionally reveals whether an email is registered, to let the login form distinguish "user not found" from "wrong password." This is a conscious UX tradeoff (and is documented in the code), but it does leak which email addresses have accounts and helps an attacker build a target list. Combined with the rate-limiting gap above, it is cheap to abuse.

Fix (if you want to close it): remove the distinct message and show a single "wrong email or password," or at least require the endpoint to be rate-limited and consider a small random delay.

### 4. PBKDF2 iteration count (Low)

`password.js` uses PBKDF2-HMAC-SHA256 at 100,000 iterations. Current OWASP guidance is 600,000 for that algorithm. The stored format already encodes the iteration count per hash, so you can raise it safely without breaking existing accounts (old hashes verify at their stored count; new ones use the higher value). The code comment cites the Workers free-plan CPU budget as the reason — worth re-checking on your current plan, and consider re-hashing on next successful login.

### 5. Personal email as User-Agent (Low / privacy)

`worker/proxy.js` hardcodes `USER_AGENT = 'fjellrute/0.1 tryggve@sonofit.no'`. MET's terms do require a contactable identifier, but a personal address is sent to every upstream (MET, NVE) and is visible in the repo and the deployed Worker. Prefer a role address such as `contact@fjellrute.no` or `no-reply@fjellrute.no`.

### 6. Unescaped HTML in auth emails (Low)

`emailTemplate()` in `worker/email.js` interpolates `heading`, `body`, `actionUrl`, and `actionLabel` straight into an HTML string. Today all of these are internally controlled, but the password-reset body includes `user.email`, which originates from user input at sign-up. The practical risk is small (email format constrains the characters, and mail clients sandbox HTML), but escaping the interpolated values is cheap insurance.

### 7. Open forward proxy (Low)

`worker/proxy.js` forwards an arbitrary path and query string to three fixed upstream hosts and caches the result at the edge. Because the host is fixed, this is not classic SSRF — an attacker cannot redirect it elsewhere. However, it is an unauthenticated, cacheable relay to those hosts: it can be used to fill your edge cache and to make requests to MET/NVE that appear to come from your Worker rather than the caller. Low risk given the fixed hosts; if you want to tighten it, allowlist the specific upstream path prefixes you actually use.

### 8. Committed authenticated web page (Low / hygiene)

`docs/dpa/Cloud Data Processing Addendum … Google Cloud.html` is a saved copy of a logged-in Google Cloud console page and contains an `xsrf_token` meta tag. XSRF tokens are session-scoped and expire, so this is not a usable credential, but saved authenticated web pages shouldn't live in a repo. Consider replacing it with the public DPA PDF/URL or removing it.

## What is already done well

Parameterized queries throughout (no SQL injection surface). Ownership enforced in SQL — `where id = ? and userId = ?` — on every authenticated read, update, and delete, so a valid session for one user cannot touch another user's routes or tracks (no IDOR). The public endpoints gate strictly on `isShared = 1`, never return the owner's email, and only expose a private plan behind a shared track when that plan is itself shared. Share slugs are 12 characters of crypto-random from a look-alike-free alphabet (~60 bits, non-enumerable) with a unique index as backstop. Passwords use salted PBKDF2 with a constant-time comparison. Email verification is mandatory. A daily cron purges expired sessions and verification tokens for GDPR data minimization. Input is validated and size-capped (geometry, description, forecast). XML imports use the browser `DOMParser` (no XXE). The only `innerHTML` uses are in `src/dev/*` simulators that are stripped from production builds by an `import.meta.env.DEV` guard.

## Suggested priority order

1. Add security headers (finding 1).
2. Move rate limiting to a durable store and put a limit on `/api/account-exists` (findings 2, 3).
3. Swap the personal User-Agent for a role address (finding 5).
4. Raise PBKDF2 iterations and re-hash on login (finding 4).
5. Escape email template values; tidy the committed DPA page (findings 6, 8).

---

## Remediation applied — 2026-07-23

All eight findings have been fixed in code. The D1 migration has already been applied to the **remote** database (see status below); the only remaining step is `npx wrangler deploy`.

1. **Security headers (1) — fixed.** New `worker/securityHeaders.js` sets a tuned CSP, HSTS (2y, preload), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, and a `Permissions-Policy`. `worker/index.js` now routes every response through a single `withSecurityHeaders()` wrapper. The CSP is scoped to the exact origins the app uses (Kartverket/NVE/OSM tiles, Geonorge fetches, MapLibre blob workers + WASM); extend `img-src`/`connect-src` there if a new host is added.
2. **Auth rate limiting (2) — fixed.** `worker/auth.js` now uses `storage: 'database'` (shared D1 store) instead of per-isolate memory, with stricter per-route caps: sign-in 5/5min, sign-up 10/hr, forget-password 5/hr, reset-password 10/hr, plus a 100/min global default. It also sets `advanced.ipAddress.ipAddressHeaders = ['cf-connecting-ip', 'x-forwarded-for']` so the limiter buckets per real client IP — without this, Better Auth on Workers cannot resolve an IP and falls back to a single shared per-path bucket (which both fails to isolate an attacker and would lock all users out together).
3. **`/api/account-exists` (3) — fixed.** New `worker/rateLimit.js` adds a D1-backed per-IP fixed-window limiter (20 requests / 5 min), returning `429` with `Retry-After`. The upsert was tested for correct increment/reset behaviour.
4. **PBKDF2 (4) — fixed.** `worker/password.js` iterations raised 100,000 → 600,000 (OWASP). Existing hashes still verify at their stored count and upgrade on next password change. Verified correct/wrong/malformed behaviour.
5. **User-Agent (5) — fixed.** `worker/proxy.js` now sends `contact@fjellrute.no` instead of a personal address. (Make sure that mailbox exists/forwards.)
6. **Email HTML escaping (6) — fixed.** `worker/email.js` escapes all interpolated values and validates the action link is http(s) (else `#`).
7. **Open proxy (7) — fixed.** Each proxy route now has an `allow` path prefix; requests outside it get `404`, so the proxy can't relay arbitrary upstream paths.
8. **Committed DPA page (8) — fixed.** `docs/dpa/` untracked (`git rm --cached`) and added to `.gitignore`; local copies kept. Note: the token still exists in prior git history — rewrite history (e.g. `git filter-repo`) only if that repo is or will be shared.

### Verified during `npm run dev`

Running the app against the remote D1 surfaced two issues that only appear at runtime, both now fixed:

- Enabling the database-backed limiter before migration 0005 was applied made every `/api/auth/*` call fail (`D1_ERROR: no such table: rateLimit`, HTTP 500). Resolved by applying the migration (below).
- Better Auth logged `Rate limiting could not determine a client IP and is falling back to a single shared per-path bucket`. Resolved by the `advanced.ipAddress` config in finding 2.

Migration 0005 has been applied to the remote database, confirmed present:

    $ npx wrangler d1 execute fjellrute-db --remote \
        --command "select name from sqlite_master where type='table'"
    ... rateLimit, app_rate_limit ...   # both present
    # rateLimit columns: id TEXT, key TEXT, count INTEGER, lastRequest INTEGER
    #   (matches the Better Auth schema)

### Deploy checklist

Migration already applied to remote D1 (above). Remaining:

    npx wrangler deploy

For a fresh environment (or the local dev DB), the migration still needs to be run there:

    npx wrangler d1 migrations apply fjellrute-db --remote   # creates rateLimit + app_rate_limit tables

After deploying, confirm headers with `curl -sI https://fjellrute.no | grep -iE 'content-security|strict-transport|x-frame'` and load the 2D + 3D map once to confirm the CSP doesn't block any tile/data host.

Note: in pure local dev there may be no `cf-connecting-ip` header, so Better Auth still uses a shared bucket locally — expected, and it resolves once deployed behind Cloudflare.
