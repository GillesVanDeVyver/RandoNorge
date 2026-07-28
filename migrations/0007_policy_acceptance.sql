-- Migration 0007: record which version of the terms and privacy policy each
-- account accepted.
--
-- Why this exists. Both documents carry a version (TERMS_VERSION in
-- src/terms/content.ts, PRIVACY_VERSION in src/terms/privacy.ts) and the
-- privacy policy §8 promises that material changes are put in front of the
-- user again. Until this migration nothing anywhere recorded an acceptance:
-- the gate (TermsPage) was shown once before sign-up and the fact was kept
-- only in React state, so after the bump on 2026-07-28 there was no way to
-- tell an account that had seen the new text from one that had not — and no
-- way to keep the promise. Storing the accepted version is what makes "we
-- will ask you again" implementable, and what lets us prove, per account,
-- which text was agreed to.
--
-- Shape. Three nullable columns on "user" rather than a separate
-- acceptance-history table. This records the *current* state, which is what
-- the gate needs to decide whether to re-present itself; it deliberately does
-- not keep a history of every acceptance, because a log of consent events is
-- more personal data than the purpose requires (GDPR art. 5(1)(c), data
-- minimisation). If an audit trail is ever genuinely needed, add a table then
-- and say so in the policy.
--
-- Nullable, not defaulted: null means "no acceptance on record", which is
-- exactly the truth for any row created before this migration and is what the
-- staleness check treats as "must accept". A default of the current version
-- would silently manufacture consent for existing accounts, which is the one
-- thing this migration must not do. (At the time of writing the alpha has no
-- users, so no row is affected either way — but the column definition is what
-- outlives that fact.)
--
-- "user" is a Better Auth table whose columns come from the library's own
-- migration compiler (see 0001). Adding columns to it is safe — Better Auth
-- ignores what it does not know about — but they are also declared in
-- worker/auth.js as `additionalFields` so the library will read and write
-- them, and are stamped on account creation by the create hook there.
--
-- Apply locally:  npx wrangler d1 migrations apply fjellrute-db --local
-- Apply in prod:  npx wrangler d1 migrations apply fjellrute-db --remote

-- The version strings as accepted, e.g. '2026-07-16' / '2026-07-28'. Text
-- rather than a date type because they are opaque labels that happen to look
-- like dates: comparison is equality against the current constant, never
-- ordering.
alter table "user" add column "acceptedTermsVersion" text;
alter table "user" add column "acceptedPrivacyVersion" text;

-- When the most recent acceptance was recorded (ISO-8601). One timestamp for
-- both documents: the gate presents them together and they are accepted in
-- one action, so a per-document timestamp would record a distinction that
-- cannot arise.
alter table "user" add column "policiesAcceptedAt" text;

-- No index. The only query is "the row for this user id", already served by
-- the primary key; the columns are never searched or sorted on.
