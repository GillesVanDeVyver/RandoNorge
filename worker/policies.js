// Which version of the terms and privacy policy the signed-in user accepted.
//
//   GET /api/me/policies → { terms: {...}, privacy: {...}, acceptedAt, stale }
//   PUT /api/me/policies → records acceptance of the *current* versions
//
// This is the mechanism behind privacy policy §8's promise that material
// changes are put in front of the user again. The versions are stamped at
// account creation (worker/auth.js) and updated here when an existing user
// accepts a newer text; `stale` is what the client uses to decide whether to
// re-present the gate.
//
// Columns: "acceptedTermsVersion", "acceptedPrivacyVersion",
// "policiesAcceptedAt" on "user" (migration 0007). Null means no acceptance on
// record, which is treated as stale — that is the honest reading for a row
// created before the columns existed.

import { getAuth } from './auth.js';
import { TERMS_VERSION, PRIVACY_VERSION } from './policyVersions.js';

export async function handlePoliciesApi(request, env, url) {
  const session = await getAuth(env, url.origin).api.getSession({
    headers: request.headers,
  });
  if (!session?.user?.id) {
    return Response.json({ error: 'authentication required' }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    if (request.method === 'GET') {
      return Response.json(await readState(env, userId));
    }
    if (request.method === 'PUT') {
      // Awaited, not just returned: a returned promise settles outside this
      // try, so a failed write would escape the catch below and lose both the
      // log line and the JSON error body the client checks for.
      return await acceptCurrent(env, userId);
    }
    return Response.json(
      { error: 'method not allowed' },
      { status: 405, headers: { Allow: 'GET, PUT' } },
    );
  } catch (err) {
    console.error('policies api error:', err);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}

/**
 * The current acceptance state, with the comparison already done server-side.
 *
 * `stale` is computed here rather than left to the client so that both the
 * gate and any future check agree on one rule, and so the client never has to
 * hold its own idea of the current version to reach a verdict.
 */
async function readState(env, userId) {
  const row = await env.DB.prepare(
    'select "acceptedTermsVersion", "acceptedPrivacyVersion", ' +
      '"policiesAcceptedAt" from "user" where id = ?',
  )
    .bind(userId)
    .first();

  const terms = {
    accepted: row?.acceptedTermsVersion ?? null,
    current: TERMS_VERSION,
  };
  const privacy = {
    accepted: row?.acceptedPrivacyVersion ?? null,
    current: PRIVACY_VERSION,
  };
  return {
    terms: { ...terms, stale: terms.accepted !== terms.current },
    privacy: { ...privacy, stale: privacy.accepted !== privacy.current },
    acceptedAt: row?.policiesAcceptedAt ?? null,
    // Convenience for the caller: either document being stale re-presents the
    // gate, because the gate shows both.
    stale:
      terms.accepted !== terms.current ||
      privacy.accepted !== privacy.current,
  };
}

/**
 * Record acceptance of whatever the server currently considers current.
 *
 * The request body is ignored on purpose. A client that could name the version
 * it was accepting could name a version whose text it never displayed, and the
 * gate would then clear without the user having seen the change — which is the
 * exact promise this endpoint exists to keep. The client's only job is to show
 * the text and say "accepted"; what that means is decided here.
 */
async function acceptCurrent(env, userId) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    'update "user" set "acceptedTermsVersion" = ?, ' +
      '"acceptedPrivacyVersion" = ?, "policiesAcceptedAt" = ?, ' +
      '"updatedAt" = ? where id = ?',
  )
    .bind(TERMS_VERSION, PRIVACY_VERSION, now, now, userId)
    .run();

  return Response.json(await readState(env, userId));
}
