// Better Auth server configuration.
//
// Runs inside the existing Worker: email/password accounts with mandatory
// email verification, stored in the D1 database (binding DB, see
// wrangler.jsonc). The frontend talks to it on /api/auth/* through
// better-auth's React client.
//
// Required settings (docs/AUTH_SETUP.md):
//   BETTER_AUTH_SECRET  secret — signs session cookies
//   RESEND_API_KEY      secret — outbound email (stubbed to logs if absent)
//   EMAIL_FROM          var    — verified sender, optional during testing

import { betterAuth } from 'better-auth';
import { D1Dialect } from 'kysely-d1';
import { hashPassword, verifyPassword } from './password.js';
import { sendEmail, emailTemplate } from './email.js';

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

    // In-memory rate limiting (per isolate) against credential stuffing;
    // enabled explicitly because "production" detection differs on Workers.
    rateLimit: { enabled: true },
  });

  cached = { origin, auth };
  return auth;
}
