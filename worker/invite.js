// Invite-code gate for the closed alpha (migration 0006).
//
// A code does NOT create the account itself — it only decides whether the
// real Better Auth sign-up is allowed to run. worker/index.js validates the
// code before forwarding POST /api/auth/sign-up/email to Better Auth, then
// calls redeemInviteCode() once (and only once) the sign-up actually
// succeeds. Keeping validation and redemption as two steps means a code is
// never spent by a request that fails later (bad password, taken username…).

/**
 * Normalize a user-typed code to the stored form: trim surrounding
 * whitespace and upper-case. Codes are generated upper-case with dashes
 * (scripts/invite/create-invite.mjs), so the dashes must be typed too — this
 * only forgives case and stray spaces.
 */
export function normalizeInviteCode(raw) {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

/**
 * Is this code currently usable? Read-only — does not consume a use. Returns
 * { ok: true } or { ok: false, reason } where reason is a stable machine
 * string the client maps to a localized message ('missing' | 'invalid').
 * A revoked, expired or fully-used code is deliberately reported the same as
 * a non-existent one ('invalid') so the endpoint can't be used to probe which
 * codes exist.
 */
export async function validateInviteCode(env, code) {
  if (!code) return { ok: false, reason: 'missing' };
  const row = await env.DB.prepare(
    `select "max_uses", "used_count", "expires_at", "revoked"
       from "invite_code" where "code" = ?1`,
  )
    .bind(code)
    .first();
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.revoked) return { ok: false, reason: 'invalid' };
  if (row.used_count >= row.max_uses) return { ok: false, reason: 'invalid' };
  if (row.expires_at && row.expires_at <= new Date().toISOString())
    return { ok: false, reason: 'invalid' };
  return { ok: true };
}

/**
 * Consume one use of a code after a successful sign-up. The UPDATE re-checks
 * every condition in its WHERE clause, so it is atomic against two sign-ups
 * racing on the last use of a shared code: at most one UPDATE reports a
 * changed row. Records the redemption (address + timestamp) for the audit
 * trail. Returns true if a use was consumed.
 */
export async function redeemInviteCode(env, code, email) {
  if (!code) return false;
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    `update "invite_code"
        set "used_count" = "used_count" + 1
      where "code" = ?1
        and "revoked" = 0
        and "used_count" < "max_uses"
        and ("expires_at" is null or "expires_at" > ?2)`,
  )
    .bind(code, now)
    .run();
  if (!res.meta.changes) return false;
  await env.DB.prepare(
    `insert into "invite_redemption" ("code", "email") values (?1, ?2)`,
  )
    .bind(code, typeof email === 'string' ? email : '')
    .run();
  return true;
}
