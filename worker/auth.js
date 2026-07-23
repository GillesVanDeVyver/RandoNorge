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
import { D1Dialect } from 'kysely-d1';
import { hashPassword, verifyPassword } from './password.js';
import { sendEmail, emailTemplate } from './email.js';
import {
  validateUsername,
  isUsernameTaken,
  deriveUniqueUsername,
} from './usernameRules.js';

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
    trustedOrigins: [origin],

    database: {
      dialect: new D1Dialect({ database: env.DB }),
      type: 'sqlite',
    },

    // The public handle is chosen at sign-up and travels as an extra field
    // on the sign-up call. `input: true` lets the client send it; the
    // create hook below validates it and guarantees uniqueness.
    user: {
      additionalFields: {
        username: { type: 'string', required: false, input: true },
      },
    },

    // Validate / normalise / de-duplicate the handle before the user row is
    // written. Email+password sign-ups supply one from the form; social
    // sign-ins (Google) don't, so we derive a unique one from their email.
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
            return { data: { ...user, username } };
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

    // Rate limiting against credential stuffing / brute force, backed by the
    // shared D1 "rateLimit" table (migration 0005) rather than the default
    // per-isolate memory store: Cloudflare spreads requests across many
    // short-lived isolates, so an in-memory counter only sees one isolate's
    // slice of traffic and barely throttles a distributed attack. Sensitive
    // flows get stricter per-route caps on top of the global default.
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'rateLimit',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 300, max: 5 },
        '/sign-up/email': { window: 3600, max: 10 },
        '/forget-password': { window: 3600, max: 5 },
        '/reset-password': { window: 3600, max: 10 },
      },
    },
  });

  cached = { origin, auth };
  return auth;
}
