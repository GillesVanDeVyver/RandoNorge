// Username (public handle) management for the signed-in user.
//
//   GET /api/me/username  → { username: string | null }
//   PUT /api/me/username  → { username } sets/changes it; 409 if taken
//
// The username is the account's public identifier: it appears in the
// /u/<username> profile URL and nowhere sensitive, so it is validated to a
// conservative, URL-safe shape and stored lower-case for case-insensitive
// uniqueness (enforced by the index in migration 0003).

import { getAuth } from './auth.js';
import { validateUsername, isUsernameTaken } from './usernameRules.js';

export async function handleUsernameApi(request, env, url) {
  const session = await getAuth(env, url.origin).api.getSession({
    headers: request.headers,
  });
  if (!session?.user?.id) {
    return Response.json({ error: 'authentication required' }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    if (request.method === 'GET') {
      const row = await env.DB.prepare(
        'select username from "user" where id = ?',
      )
        .bind(userId)
        .first();
      return Response.json({ username: row?.username ?? null });
    }
    if (request.method === 'PUT') {
      return setUsername(request, env, userId);
    }
    return Response.json(
      { error: 'method not allowed' },
      { status: 405, headers: { Allow: 'GET, PUT' } },
    );
  } catch (err) {
    console.error('username api error:', err);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}

async function setUsername(request, env, userId) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const check = validateUsername(body.username);
  if (!check.ok) {
    // "Reserved" is a conflict; the rest are malformed input.
    const status = check.error.includes('reserved') ? 409 : 400;
    return Response.json({ error: check.error }, { status });
  }
  const username = check.username;

  // Reject a handle already taken by another account (case-insensitively).
  if (await isUsernameTaken(env, username, userId)) {
    return Response.json({ error: 'that username is taken' }, { status: 409 });
  }

  try {
    await env.DB.prepare(
      'update "user" set username = ?, "updatedAt" = ? where id = ?',
    )
      .bind(username, new Date().toISOString(), userId)
      .run();
  } catch (err) {
    // The unique index is the source of truth; a race between the check
    // above and the write surfaces here as a constraint violation.
    if (String(err).includes('UNIQUE')) {
      return Response.json({ error: 'that username is taken' }, { status: 409 });
    }
    throw err;
  }
  return Response.json({ username });
}
