// Lightweight per-IP fixed-window rate limiter backed by D1, for endpoints
// that live outside Better Auth's own limiter. Better Auth throttles
// /api/auth/* itself using a shared database store (see worker/auth.js);
// this covers the custom /api/account-exists endpoint so account
// enumeration can't be scripted at speed.
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
