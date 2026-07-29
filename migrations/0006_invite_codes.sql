-- Migration 0006: invite-code gate for the closed alpha.
--
-- During the alpha only people we hand a code to may create an account, but
-- they still go through the *real* email/password sign-up flow (so that flow
-- is actually tested). worker/index.js intercepts POST /api/auth/sign-up/email,
-- checks the supplied code against "invite_code" here, forwards the request to
-- Better Auth only if the code is valid, and records the redemption on success
-- (worker/invite.js). Remove the gate (delete the intercept in index.js) to
-- open public sign-ups later; the tables can stay.
--
-- Apply locally:  npx wrangler d1 migrations apply fjellrute-db-eu --local
-- Apply in prod:  npx wrangler d1 migrations apply fjellrute-db-eu --remote

-- One row per code we issue. "code" is stored normalized (upper-case, trimmed)
-- exactly as the redeem/validate path normalizes user input, so a plain
-- primary-key lookup is the match.
create table "invite_code" (
  "code" text not null primary key,
  -- Free-text reminder of who/what a code is for ("Kari — ski club", "batch-1").
  "note" text,
  -- How many accounts this code may create. 1 = single-use (the default); a
  -- larger number makes a shared code for a whole cohort.
  "max_uses" integer not null default 1,
  -- Bumped atomically on each successful sign-up; a code is spent when
  -- used_count reaches max_uses.
  "used_count" integer not null default 0,
  -- ISO-8601 string, or null for "never expires". Compared as text > text,
  -- which is correct for ISO-8601.
  "expires_at" text,
  -- Kill switch: set to 1 to disable a code immediately regardless of uses.
  "revoked" integer not null default 0,
  "created_at" text not null default (datetime('now'))
);

-- Audit trail: which address redeemed which code and when. Lets us see who a
-- shared code let in, and spot a leaked code being used by strangers.
create table "invite_redemption" (
  "id" integer primary key autoincrement,
  "code" text not null,
  "email" text not null,
  "redeemed_at" text not null default (datetime('now'))
);

create index "invite_redemption_code_idx" on "invite_redemption" ("code");
