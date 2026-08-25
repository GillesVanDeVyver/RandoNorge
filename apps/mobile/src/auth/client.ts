// Better Auth client for the phone, and the one place the shared core package
// is told how to reach the backend.
//
// THE DIFFERENCE FROM THE WEB. apps/web/src/auth/client.ts is three lines:
// `createAuthClient()` with no arguments, because the browser supplies both
// things the client needs — an origin to resolve /api/auth against, and a
// cookie jar that stores the session and attaches it to later requests. React
// Native supplies neither. So this file provides both explicitly:
//
//   baseURL      from src/config/api.ts, the app's single host decision.
//   storage      expo-secure-store, which is the Keychain on iOS and
//                EncryptedSharedPreferences on Android. It survives the app
//                being killed and the phone rebooting, which is precisely the
//                acceptance criterion for this phase: log in, kill the app,
//                reopen it, still logged in.
//
// The `expoClient` plugin is what connects them. It intercepts the Set-Cookie
// on the auth responses, writes the session into `storage` under
// `storagePrefix`, and replays it on subsequent auth calls. `scheme` is the
// deep-link scheme, which it also sends as the request's origin — which is why
// it must equal MOBILE_SCHEME in worker/auth.js, where it is listed in
// trustedOrigins. A mismatch there does not look like a configuration error: it
// looks like correct credentials being rejected, because what fails is Better
// Auth's CSRF check, not the password comparison. scripts/verify-mobile-app.mjs
// asserts the three copies of this string agree.

import { createAuthClient } from 'better-auth/react';
import { expoClient } from '@better-auth/expo/client';
import * as SecureStore from 'expo-secure-store';
import { setApiBase, setAuthHeaders } from '@fjellrute/core/net/base';
import { API_BASE } from '../config/api';

/**
 * Must equal `scheme` in app.json and MOBILE_SCHEME in worker/auth.js.
 * Not imported from app.json because that file is also read by the native
 * build at a point where this module does not exist; the verify script is what
 * keeps the copies honest.
 */
export const MOBILE_SCHEME = 'fjellrute';

export const authClient = createAuthClient({
  baseURL: API_BASE,
  plugins: [
    expoClient({
      scheme: MOBILE_SCHEME,
      storagePrefix: MOBILE_SCHEME,
      storage: SecureStore,
    }),
  ],
});

export type Session = typeof authClient.$Infer.Session;

let installed = false;

/**
 * Point @fjellrute/core at this backend and this session. Called once, before
 * anything renders (see app/_layout.tsx).
 *
 * Two separate installations, because core has two separate gaps:
 *
 *   setApiBase     turns its root-relative paths ('/api/routes') into absolute
 *                  URLs. Without it every core fetch throws immediately.
 *   setAuthHeaders supplies the session. The expoClient plugin only manages
 *                  cookies for its OWN endpoints (/api/auth/*); a call to
 *                  /api/routes is an ordinary fetch and would go out
 *                  unauthenticated, so the Worker would answer 401 and the
 *                  route list would be empty for a user who is demonstrably
 *                  logged in. `getCookie()` hands back the stored cookie
 *                  header for exactly this purpose.
 *
 * Installing a header source is also what makes core send
 * `credentials: 'omit'` — see packages/core/src/net/base.ts. Setting a Cookie
 * header by hand while fetch is also managing cookies is a race, and which one
 * wins differs between the platforms.
 */
export function installCoreNetworking(): void {
  if (installed) return;
  installed = true;
  setApiBase(API_BASE);
  setAuthHeaders((): Record<string, string> => {
    const cookie = authClient.getCookie();
    // Annotated rather than inferred. Without the annotation TypeScript infers
    // the union `{ Cookie: string } | { Cookie?: undefined }` from the two
    // branches, and the second member — a property that may be undefined — is
    // not assignable to Record<string, string>. The annotation makes the empty
    // branch widen to the record type instead of narrowing the whole function.
    return cookie ? { Cookie: cookie } : {};
  });
}
