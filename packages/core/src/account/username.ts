// The signed-in account's public handle — the `<username>` in /u/<username>.
//
// This moved out of apps/web/src/public/api.ts when the phone's saved-routes
// list grew a "copy public link" button. The link is /u/<handle>/r/<slug>, so
// the phone needs the handle, and the web's version could not be imported: it
// called `fetch('/api/me/username')` with a path-only URL, which resolves
// against the document on the web and throws on React Native, which has no
// document to resolve against. Routed through apiUrl()/authHeaders() instead —
// the same two adapters every other client in this package uses — it is the
// identical request in a browser and a working one on a phone.
//
// The PUT sibling comes along because splitting a GET from its matching PUT
// leaves the second one calling a URL that nothing near it names, and the pair
// is nine lines. Only the GET has a caller on the phone today.

import { translate } from '../i18n/locale.ts';
import { apiUrl, authHeaders, usesCookieCredentials } from '../net/base.ts';

/** Credentials handling shared by both calls, identical to routes/api.ts's. */
function credentials(): { credentials?: 'omit' } {
  return usesCookieCredentials() ? {} : { credentials: 'omit' as const };
}

/**
 * The handle, or null when the account has not chosen one.
 *
 * Also null on any failure — a 401 from an expired session, a 5xx, an offline
 * phone. The handle is only ever used to BUILD a link, so "not known" and "not
 * set" want the same treatment at every call site: hide the share URL and try
 * again on the next load. Throwing here would make each caller write that
 * catch itself, and the web's version has returned null since it was written.
 */
export async function getMyUsername(): Promise<string | null> {
  const res = await fetch(apiUrl('/api/me/username'), {
    headers: authHeaders(),
    ...credentials(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { username: string | null };
  return data.username;
}

/** Set/change the handle. Throws with the server's message on 4xx (e.g.
 *  "that username is taken", validation errors). */
export async function setMyUsername(username: string): Promise<string> {
  const res = await fetch(apiUrl('/api/me/username'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ username }),
    ...credentials(),
  });
  const data = (await res.json().catch(() => ({}))) as {
    username?: string;
    error?: string;
  };
  if (!res.ok)
    throw new Error(
      data.error ||
        translate(
          `Forespørselen mislyktes (${res.status})`,
          `Request failed (${res.status})`,
        ),
    );
  return data.username ?? username;
}
