// Self-service account deletion (GDPR art. 17, "right to erasure").
//
//   DELETE /api/account  → { confirm, password? } permanently deletes the
//                          signed-in user's account and everything in it
//
// This is the code path behind a "delete my account" button. The manual
// runbook in docs/REMOVE_USER.md does the same thing by hand and must stay in
// sync with deleteAccountRows() below — if a table that holds personal data is
// added later, it has to be added in both places.
//
// WHAT GETS DELETED
//
// Deleting the "user" row cascades to "session" (with its stored IP address
// and user agent), "account" (the password hash and any linked Google
// identity), "route" and "track" — the cascades come from migrations 0001 and
// 0002. Two tables are keyed by email address instead of user id, so they do
// NOT cascade and are deleted explicitly here:
//
//   * "verification"      — pending email-verification / password-reset tokens
//   * "invite_redemption" — the closed-alpha audit trail (migration 0006)
//
// The "invite_code" row itself is left alone: it holds no personal data, and
// its used_count records that a code was spent, which stays true.
//
// Nothing of the user's lives outside D1. R2 holds only self-generated terrain
// tiles, and the app sets no analytics cookies, so there is nothing else to
// clean up.
//
// CONFIRMATION
//
// Deletion is irreversible and a session cookie may be sitting on a shared or
// stolen device, so two guards apply on top of a valid session:
//
//   1. "confirm" must be the account's own email address, typed exactly
//      (compared case-insensitively). This is the anti-accident guard.
//   2. If the account has a password, "password" must verify against it. This
//      is real re-authentication and blocks someone holding only a cookie.
//
// Google-only accounts have no password to check, so for them guard 1 is all
// there is. Closing that gap properly means emailing a one-time confirmation
// link before deleting (Better Auth's own deleteUser flow works that way); it
// is deliberately not built yet, and the request is rate-limited meanwhile.

import { getAuth } from './auth.js';
import { verifyPassword } from './password.js';
import { rateLimit, clientIp } from './rateLimit.js';

// Deleting your own account is a once-ever action, so the cap only needs to be
// high enough not to punish a fumbled password. It is what keeps this endpoint
// from becoming an unthrottled password oracle — it sits outside /api/auth/*
// and so outside Better Auth's own limiter.
const MAX_ATTEMPTS_PER_HOUR = 5;

export async function handleAccountApi(request, env, url) {
  if (request.method !== 'DELETE') {
    return Response.json(
      { error: 'method not allowed' },
      { status: 405, headers: { Allow: 'DELETE' } },
    );
  }

  const auth = getAuth(env, url.origin);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return Response.json({ error: 'authentication required' }, { status: 401 });
  }
  const { id: userId, email } = session.user;

  try {
    const { allowed, resetAt } = await rateLimit(
      env,
      `account-delete:${clientIp(request)}`,
      MAX_ATTEMPTS_PER_HOUR,
      3600,
    );
    if (!allowed) {
      return Response.json(
        { error: 'too many attempts, try again later' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))),
          },
        },
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'invalid JSON body' }, { status: 400 });
    }

    // Guard 1: the typed confirmation must match the account's own address.
    const confirm = typeof body.confirm === 'string' ? body.confirm.trim() : '';
    if (!confirm || confirm.toLowerCase() !== String(email).toLowerCase()) {
      return Response.json(
        { error: 'type your email address to confirm deletion' },
        { status: 422 },
      );
    }

    // Guard 2: re-authenticate against the stored password, if there is one.
    // A row with providerId "credential" and a non-null password means the
    // account can sign in with a password; Google-only accounts have neither.
    const credential = await env.DB.prepare(
      'select password from "account" ' +
        "where userId = ? and providerId = 'credential' and password is not null",
    )
      .bind(userId)
      .first();

    if (credential?.password) {
      const password = typeof body.password === 'string' ? body.password : '';
      if (!password) {
        return Response.json(
          { error: 'password required' },
          { status: 422, headers: { 'X-Reauth': 'password' } },
        );
      }
      const ok = await verifyPassword({
        hash: credential.password,
        password,
      });
      if (!ok) {
        return Response.json({ error: 'password is incorrect' }, { status: 403 });
      }
    }

    // Revoke the current session first and keep the cookie-clearing headers
    // Better Auth produces, so the browser is not left holding a cookie for an
    // account that no longer exists. Done before the delete because signOut
    // needs the session row it is revoking; if the delete below then fails, the
    // caller is merely signed out and the account is untouched.
    let clearCookies = [];
    try {
      const signedOut = await auth.api.signOut({
        headers: request.headers,
        asResponse: true,
      });
      clearCookies = signedOut.headers.getSetCookie?.() ?? [];
    } catch (err) {
      // Not fatal: the session row is about to be cascade-deleted anyway,
      // which invalidates the cookie server-side regardless.
      console.error('sign-out during account deletion failed:', err);
    }

    const counts = await deleteAccountRows(env, { userId, email });
    console.log(
      `account deleted: user ${userId}, ${counts.tokens} verification ` +
        `tokens, ${counts.redemptions} invite redemptions`,
    );

    const headers = new Headers({ 'Cache-Control': 'no-store' });
    for (const cookie of clearCookies) headers.append('Set-Cookie', cookie);
    return Response.json({ deleted: true }, { headers });
  } catch (err) {
    console.error('account api error:', err);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}

/**
 * Delete every row holding this account's personal data.
 *
 * Exported so scripts/verify-account-deletion.mjs can run the real statements
 * against a scratch SQLite database and assert that nothing survives. Keep the
 * statements identical to docs/REMOVE_USER.md step 2.
 *
 * @param {*} env  Worker env (needs the DB binding)
 * @param {{ userId: string, email: string }} account
 * @returns {Promise<{ tokens: number, redemptions: number, users: number }>}
 */
export async function deleteAccountRows(env, { userId, email }) {
  const [tokens, redemptions, users] = await env.DB.batch([
    // Keyed by email, not user id, so no cascade reaches these. The identifier
    // is either the bare address or prefixed ("reset-password:<email>"), hence
    // two conditions — never a bare like '%email%', which would also match a
    // different address that contains this one as a substring.
    env.DB.prepare(
      'delete from "verification" where lower("identifier") = lower(?1) ' +
        "or lower(\"identifier\") like '%:' || lower(?1)",
    ).bind(email),
    env.DB.prepare(
      'delete from "invite_redemption" where lower("email") = lower(?1)',
    ).bind(email),
    // Cascades to session, account, route and track.
    env.DB.prepare('delete from "user" where id = ?1').bind(userId),
  ]);
  return {
    tokens: tokens.meta.changes,
    redemptions: redemptions.meta.changes,
    users: users.meta.changes,
  };
}
