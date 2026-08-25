// Better Auth server configuration.
//
// Runs inside the existing Worker: email/password accounts with mandatory
// email verification, stored in the D1 database (binding DB, see
// wrangler.jsonc). The frontend talks to it on /api/auth/* through
// better-auth's React client.
//
// Required settings (docs/AUTH_SETUP.md):
//   BETTER_AUTH_SECRET    secret — signs session cookies
//   RESEND_API_KEY        secret — outbound email (stubbed to logs if absent)
//   EMAIL_FROM            var    — verified sender, optional during testing
//   GOOGLE_CLIENT_ID      var    — Google OAuth client (Sign in with Google)
//   GOOGLE_CLIENT_SECRET  secret — Google OAuth client secret

import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { expo } from '@better-auth/expo';
import { D1Dialect } from 'kysely-d1';
import { hashPassword, verifyPassword } from './password.js';
import { sendEmail, emailTemplate } from './email.js';
import {
  validateUsername,
  isUsernameTaken,
  deriveUniqueUsername,
} from './usernameRules.js';
import { TERMS_VERSION, PRIVACY_VERSION } from './policyVersions.js';
import { betterAuthRateLimitStorage } from './rateLimit.js';

/**
 * The mobile app's deep-link scheme, without the '://'.
 *
 * Kept here as a named constant rather than inlined because two things must
 * agree with it: `scheme` in apps/mobile/app.json, and the `scheme` passed to
 * expoClient() in apps/mobile/src/auth/client.ts. A drift between them presents
 * as a login that fails with a CSRF error, so scripts/verify-mobile-app.mjs
 * checks all three against each other.
 */
export const MOBILE_SCHEME = 'fjellrute';

/**
 * Whether this origin is a development server, and therefore whether Expo's
 * development-client scheme should be trusted.
 *
 * Conservative on purpose: it recognises localhost and the three private IPv4
 * ranges — the addresses `wrangler dev --host` actually serves on — and treats
 * everything else, including anything it does not recognise, as production. The
 * failure mode of being wrong in that direction is "cannot log in from Expo Go
 * on my laptop"; the other direction is trusting any Expo client that can reach
 * the production Worker.
 */
function isDevOrigin(origin) {
  let host;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  // 10.0.0.0/8, 192.168.0.0/16, and 172.16.0.0/12.
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const m = /^172\.(\d+)\./.exec(host);
  return m !== null && Number(m[1]) >= 16 && Number(m[1]) <= 31;
}

// One instance per isolate+origin is enough; the D1 binding is stable for
// the isolate's lifetime.
let cached = null;

export function getAuth(env, origin) {
  if (cached && cached.origin === origin) return cached.auth;

  const auth = betterAuth({
    appName: 'Fjellrute',
    baseURL: origin,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    // The web app's own origin, plus the mobile app's custom scheme.
    //
    // MOBILE_SCHEME is the app's deep-link scheme, declared in
    // apps/mobile/app.json. It must match exactly — the value the Expo client
    // sends is derived from that manifest, and a mismatch fails as a CSRF
    // rejection, which reads like bad credentials rather than a misconfigured
    // origin. scripts/verify-mobile-app.mjs asserts the two agree so the pair
    // cannot drift apart silently.
    //
    // The exp:// entries are Expo's own development-client scheme, and they are
    // added only when this Worker is serving a development origin. In production
    // they would be a real hole: exp://** trusts any Expo client on any network,
    // which is fine for `wrangler dev` on a laptop and not fine for the origin
    // holding real accounts. isDevOrigin() below is deliberately conservative —
    // it names localhost and the private IPv4 ranges rather than trying to
    // detect "not production".
    trustedOrigins: [
      origin,
      `${MOBILE_SCHEME}://`,
      ...(isDevOrigin(origin) ? ['exp://', 'exp://**'] : []),
    ],

    database: {
      dialect: new D1Dialect({ database: env.DB }),
      type: 'sqlite',
    },

    // The public handle is chosen at sign-up and travels as an extra field
    // on the sign-up call. `input: true` lets the client send it; the
    // create hook below validates it and guarantees uniqueness.
    //
    // The three policy-acceptance fields (migration 0007) are `input: false`:
    // they are stamped by the create hook below from the Worker's own
    // constants, never accepted from the request. A client that could name the
    // version it accepted could name one whose text it never showed.
    user: {
      additionalFields: {
        username: { type: 'string', required: false, input: true },
        acceptedTermsVersion: {
          type: 'string',
          required: false,
          input: false,
        },
        acceptedPrivacyVersion: {
          type: 'string',
          required: false,
          input: false,
        },
        policiesAcceptedAt: { type: 'string', required: false, input: false },
      },
    },

    // Validate / normalise / de-duplicate the handle before the user row is
    // written. Email+password sign-ups supply one from the form; social
    // sign-ins (Google) don't, so we derive a unique one from their email.
    //
    // The same hook stamps which version of the terms and privacy policy the
    // account accepted. Every route to a new account passes the acceptance
    // gate first — the sign-up form and "Continue with Google" both hold their
    // action behind TermsPage (src/components/LoginPage.tsx) — so account
    // creation *is* the acceptance event, and this is the only place that sees
    // both paths. Recording it here rather than in the client is what makes
    // the Google flow work at all: that round trip leaves the app entirely and
    // comes back through an OAuth callback carrying none of its state.
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const provided =
              typeof user.username === 'string' ? user.username : '';
            let username;
            if (provided.trim()) {
              const check = validateUsername(provided);
              if (!check.ok) {
                throw new APIError('UNPROCESSABLE_ENTITY', {
                  message: check.error,
                });
              }
              if (await isUsernameTaken(env, check.username)) {
                throw new APIError('UNPROCESSABLE_ENTITY', {
                  message: 'that username is taken',
                });
              }
              username = check.username;
            } else {
              username = await deriveUniqueUsername(env, user.email);
            }
            return {
              data: {
                ...user,
                username,
                acceptedTermsVersion: TERMS_VERSION,
                acceptedPrivacyVersion: PRIVACY_VERSION,
                policiesAcceptedAt: new Date().toISOString(),
              },
            };
          },
        },
      },
    },

    // Social sign-in. Google is only enabled when its credentials are
    // configured, so local dev without the secrets keeps working (the
    // button then returns a "provider not found" error instead of
    // crashing the whole auth handler).
    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              // Google addresses arrive pre-verified, so Google users skip
              // the confirmation-email step entirely.
            },
          }
        : {}),
    },

    // If someone signed up with email+password and later uses Google with
    // the same (verified) address, link it to the existing account instead
    // of failing with "account already exists".
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google'],
      },
    },

    emailAndPassword: {
      enabled: true,
      // No sign-in until the address is confirmed (a verification mail is
      // sent on sign-up, and again on any sign-in attempt before that).
      requireEmailVerification: true,
      // NIST 800-63B style: length is the requirement; composition rules
      // and the common-password check live in the client for instant
      // feedback (the server still enforces length).
      minPasswordLength: 8,
      maxPasswordLength: 128,
      // Native-WebCrypto PBKDF2 instead of the default pure-JS scrypt,
      // which exceeds the Workers free plan CPU budget (worker/password.js).
      password: {
        hash: hashPassword,
        verify: verifyPassword,
      },
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(env, {
          to: user.email,
          subject: 'Reset your Fjellrute password',
          ...emailTemplate({
            heading: 'Reset your password',
            body:
              'Someone (hopefully you) asked to reset the password for ' +
              `${user.email}. The link is valid for one hour. If this ` +
              "wasn't you, you can ignore this email.",
            actionUrl: url,
            actionLabel: 'Choose a new password',
          }),
        });
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(env, {
          to: user.email,
          subject: 'Confirm your email for Fjellrute',
          ...emailTemplate({
            heading: 'Welcome to Fjellrute',
            body:
              'Confirm this email address to activate your account. ' +
              "Once confirmed you'll be signed in automatically.",
            actionUrl: url,
            actionLabel: 'Confirm email',
          }),
        });
      },
    },

    // Let errors Better Auth doesn't recognise escape to the Worker instead of
    // becoming its router's bodiless 500.
    //
    // better-call answers an unrecognised error with `new Response(null, {
    // status: 500 })` — no body, nothing for the client to read, nothing in the
    // response naming the cause. Every one of this app's own endpoints already
    // returns JSON on failure; this was the one path that didn't, and it hid a
    // rejected PBKDF2 iteration count (worker/password.js) behind the sign-up
    // form's generic "could not create the account" for two weeks.
    //
    // `throw` only affects that unrecognised case. Better Auth's own APIErrors
    // — every 401, 403, 422, 429 the flows raise deliberately — are re-caught
    // inside the router and converted to their normal responses, and OAuth's
    // "FOUND" redirect is returned before this is consulted at all. What is
    // left is genuine faults, which runAuthHandler (worker/index.js) logs and
    // answers as JSON.
    onAPIError: { throw: true },

    // Resolve the caller's real IP from Cloudflare's trusted CF-Connecting-IP
    // header so the rate limiter buckets per client. Without this Better Auth
    // can't find an IP on Workers and falls back to ONE shared per-path bucket
    // — which both fails to isolate an attacker and would lock every user out
    // together once the shared count is hit.
    advanced: {
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'],
      },
    },

    // Rate limiting against credential stuffing / brute force, backed by D1
    // rather than the default per-isolate memory store: Cloudflare spreads
    // requests across many short-lived isolates, so an in-memory counter only
    // sees one isolate's slice of traffic and barely throttles a distributed
    // attack. Sensitive flows get stricter per-route caps on top of the
    // global default.
    //
    // NOT `storage: 'database'`. Better Auth's own database backend hangs
    // forever on D1 — it froze every sign-up until 2026-08-06 — so the store
    // is the app's own bounded limiter instead. The full explanation is on
    // `betterAuthRateLimitStorage` in worker/rateLimit.js; read it before
    // changing this back. Everything else here (windows, per-route caps) is
    // resolved by Better Auth exactly as before and passed to the storage.
    rateLimit: {
      enabled: true,
      customStorage: betterAuthRateLimitStorage(env),
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 300, max: 5 },
        '/sign-up/email': { window: 3600, max: 10 },
        '/forget-password': { window: 3600, max: 5 },
        '/reset-password': { window: 3600, max: 10 },
      },
    },

    // The Expo app (apps/mobile) is a second client of this same auth server,
    // and it needs this plugin rather than only a CORS header, which is the one
    // thing about mobile auth that is easy to get backwards: CORS is enforced by
    // browsers, and React Native's fetch is not a browser, so a native build
    // never consults an Access-Control-Allow-Origin header at all. What would
    // reject the phone is `trustedOrigins` below — Better Auth's CSRF check —
    // and what makes a session survive the app being killed is this plugin
    // cooperating with the client's SecureStore.
    //
    // It is safe on the web: the plugin adds routes and cookie handling used by
    // the Expo client and changes nothing about the existing browser flow.
    plugins: [expo()],
  });

  cached = { origin, auth };
  return auth;
}
