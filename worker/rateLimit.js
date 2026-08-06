// Per-IP fixed-window rate limiter backed by D1.
//
// It covers the app's own endpoints (/api/account-exists, the invite gate in
// worker/index.js) and, since 2026-08-06, Better Auth's /api/auth/* limiter
// too: `betterAuthRateLimitStorage()` at the bottom of this file is handed to
// Better Auth as `rateLimit.customStorage` (worker/auth.js). See that
// function's comment for why Better Auth's own database backend cannot be
// used on D1 — it is what froze every sign-up.
//
// State lives in the "app_rate_limit" table (migration 0005): one row per
// (route, client) key, holding the current count and the epoch-ms instant
// the window resets. A single upsert both advances the window and increments
// the count atomically, so concurrent requests can't race past the cap.

/** Best-effort caller identity. CF-Connecting-IP is set by Cloudflare on
 *  every request and cannot be spoofed by the client; the fallbacks only
 *  matter in local dev. */
export function clientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * Record a hit against `key` and report whether it is within the limit.
 *
 * @param {*} env               Worker env (needs the DB binding)
 * @param {string} key          bucket key, e.g. `account-exists:<ip>`
 * @param {number} max          allowed hits per window
 * @param {number} windowSeconds  window length in seconds
 * @returns {Promise<{ allowed: boolean, resetAt: number }>}
 *
 * Fails open (allowed) on a DB error so a transient D1 problem never locks
 * legitimate users out — the auth endpoints keep their own limiter regardless.
 */
export async function rateLimit(env, key, max, windowSeconds) {
  const now = Date.now();
  const resetAt = now + windowSeconds * 1000;
  try {
    const row = await env.DB.prepare(
      'insert into "app_rate_limit" ("key", "count", "resetAt") ' +
        'values (?1, 1, ?2) ' +
        'on conflict("key") do update set ' +
        '  "count" = case when "app_rate_limit"."resetAt" <= ?3 then 1 ' +
        '                 else "app_rate_limit"."count" + 1 end, ' +
        '  "resetAt" = case when "app_rate_limit"."resetAt" <= ?3 then ?2 ' +
        '                   else "app_rate_limit"."resetAt" end ' +
        'returning "count", "resetAt"',
    )
      .bind(key, resetAt, now)
      .first();
    return { allowed: row.count <= max, resetAt: row.resetAt };
  } catch (err) {
    console.error('rate limit check failed (failing open):', err);
    return { allowed: true, resetAt };
  }
}

/**
 * Better Auth's rate-limit storage contract, implemented on the limiter
 * above. Passed to `betterAuth()` as `rateLimit.customStorage`.
 *
 * WHY THIS EXISTS — the 2026-08-06 sign-up freeze.
 *
 * Better Auth's built-in `storage: "database"` backend cannot be used on D1.
 * Its `consume()` (node_modules/better-auth/dist/api/rate-limiter/index.mjs)
 * is written as a compare-and-set retry loop: whenever its guarded UPDATE
 * reports no changed row it calls itself again — `return consume(key, rule)`
 * — with no attempt counter and no ceiling. On a backend where that UPDATE
 * can keep reporting "nothing changed", the call never returns.
 *
 * D1 through kysely-d1 is exactly such a backend: the driver reports
 * `numAffectedRows: undefined` rather than 0 when an UPDATE matches nothing
 * (node_modules/kysely-d1/dist/index.js), and it cannot fall back to the
 * adapter's transactional path at all because `beginTransaction()` throws
 * "Transactions are not supported yet". One of the recursing branches also
 * calls `incrementOne` with an empty `increment: {}`.
 *
 * That limiter runs in the router's `onRequest` hook, which better-call
 * invokes BEFORE route matching (node_modules/better-call/dist/router.mjs).
 * So the loop swallowed *every* /api/auth/* request — including paths with no
 * endpoint behind them — long before sign-up code, the username hook or
 * `sendVerificationEmail` could run. That is why the form sat on "One
 * moment…" forever and why no verification email was ever attempted: the
 * request never got far enough to send one. `/get-session` appeared healthy
 * only because the app polls it often enough that its bucket never went
 * stale and it took the one branch that terminates.
 *
 * The replacement below has no loop at all. One upsert decides everything,
 * the same statement the app's own endpoints have used since migration 0005.
 *
 * Semantics differ slightly and deliberately: this is a fixed window (the
 * count resets when `resetAt` passes) where Better Auth's own backend rolls
 * the window forward from the last request. For throttling credential
 * stuffing the difference is immaterial, and the per-route caps configured in
 * worker/auth.js still apply — Better Auth resolves the rule (window, max)
 * before calling in, so `customRules` keeps working unchanged.
 *
 * @param {*} env  Worker env (needs the DB binding)
 */
export function betterAuthRateLimitStorage(env) {
  // Better Auth's keys are "<ip>:<path>". Namespacing them keeps auth buckets
  // from ever colliding with the app's own ("account-exists:<ip>",
  // "invite-signup:<ip>") in the shared table.
  const bucket = (key) => `auth:${key}`;

  return {
    /**
     * Atomic check-and-increment. Better Auth prefers this over get/set and
     * uses it exclusively when present, so this is the path that actually
     * runs on every /api/auth/* request.
     */
    async consume(key, rule) {
      const { allowed, resetAt } = await rateLimit(
        env,
        bucket(key),
        rule.max,
        rule.window,
      );
      return {
        allowed,
        retryAfter: allowed
          ? null
          : Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
      };
    },

    // get/set are the legacy non-atomic path Better Auth falls back to only
    // when `consume` is absent. They are required members of the interface,
    // so they cannot simply be dropped — but they must not be stubs either: a
    // no-op `get` would make a future Better Auth that ignored `consume`
    // silently stop rate limiting /api/auth/* altogether, which is the one
    // failure mode worse than the freeze. So they are implemented for real,
    // against Better Auth's own "rateLimit" table (migration 0005), whose
    // columns are exactly the { key, count, lastRequest } shape it expects.
    // The daily retention job (worker/index.js) already purges that table.

    async get(key) {
      try {
        const row = await env.DB.prepare(
          'select "key", "count", "lastRequest" from "rateLimit" ' +
            'where "key" = ?1',
        )
          .bind(bucket(key))
          .first();
        if (!row) return null;
        return {
          key: row.key,
          count: Number(row.count),
          lastRequest: Number(row.lastRequest),
        };
      } catch (err) {
        console.error('auth rate limit read failed:', err);
        return null;
      }
    },

    async set(key, value) {
      const stored = bucket(key);
      try {
        // Update-then-insert rather than ON CONFLICT: the table's unique
        // constraint is on "id", not "key" (migration 0005), so an upsert on
        // "key" has nothing to conflict against.
        const updated = await env.DB.prepare(
          'update "rateLimit" set "count" = ?2, "lastRequest" = ?3 ' +
            'where "key" = ?1',
        )
          .bind(stored, value.count, value.lastRequest)
          .run();
        if (updated.meta.changes) return;
        await env.DB.prepare(
          'insert into "rateLimit" ("id", "key", "count", "lastRequest") ' +
            'values (?1, ?2, ?3, ?4)',
        )
          .bind(crypto.randomUUID(), stored, value.count, value.lastRequest)
          .run();
      } catch (err) {
        console.error('auth rate limit write failed:', err);
      }
    },
  };
}
