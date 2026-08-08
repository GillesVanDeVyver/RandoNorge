-- Migration 0008: in-app feedback messages.
--
-- Why this exists. Until now the only feedback channel was a mailto: link on
-- the account overview, which asks the tester to leave the app, find a mail
-- client that is actually configured, and write a subject line — on the phone
-- that most of the alpha traffic comes from, that is three chances to give up.
-- The overview now opens a form instead (src/components/FeedbackDialog.tsx),
-- the Worker stores the message here and then emails it out through Resend
-- (worker/feedback.js).
--
-- Why store it at all, when it is emailed anyway. Because the email is the
-- part that can fail: Resend can be down, rate-limited, or misconfigured
-- (RESEND_API_KEY unset logs instead of sending). A tester who took the
-- trouble to write a bug report must not lose it to a 500 from a third party,
-- so the row is written first and the send is attempted second. "delivered"
-- records which messages actually made it out, so the ones that did not can
-- be found with a single query rather than never at all.
--
-- WHAT IS AND IS NOT STORED. The message text and, if the user typed one, a
-- reply address. No user agent, no page URL, no IP address: none of it was
-- asked for, and a free-text table is the wrong place to accumulate technical
-- context nobody committed to reading (GDPR art. 5(1)(c), data minimisation).
-- The author is identified by "userId" alone — their email address already
-- lives on the "user" row, so copying it here would store the same personal
-- data twice and leave the copy behind on deletion.
--
-- Which is the other half of the design: "userId" cascades, so deleting an
-- account (worker/account.js, docs/REMOVE_USER.md) takes that account's
-- feedback with it and no explicit statement is needed. The copy already
-- delivered to our own inbox is outside the database and is handled like any
-- other correspondence — the privacy policy §5 says so.
--
-- Apply locally:  npx wrangler d1 migrations apply fjellrute-db-eu --local
-- Apply in prod:  npx wrangler d1 migrations apply fjellrute-db-eu --remote

create table "feedback" (
  "id" text not null primary key,
  -- The author. Cascades on account deletion (see above); this is the only
  -- link to a person the row holds.
  "userId" text not null references "user" ("id") on delete cascade,
  -- The message as typed. Length is capped in worker/feedback.js, not here:
  -- SQLite would not enforce a CHECK any more usefully than the endpoint
  -- already does, and a rejected message should fail with a readable error in
  -- the form rather than a constraint violation.
  "message" text not null,
  -- Optional reply address. The form prefills the account's own email and the
  -- user may change or clear it; null means "reply to the account address",
  -- which worker/feedback.js resolves from the session when sending. Stored
  -- only when it was actually typed, so a null is a real fact about the
  -- message rather than a duplicate of the "user" row.
  "replyTo" text,
  -- 1 once Resend accepted the message. Starts at 0 and is updated after the
  -- send, so a row still showing 0 is either in flight or lost mail.
  "delivered" integer not null default 0,
  "createdAt" text not null
);

-- SQLite scans the child table on a parent delete unless the referencing
-- column is indexed, so this is what keeps account deletion from walking
-- every feedback row (same reason as "track_userId_idx", migration 0002).
create index "feedback_userId_idx" on "feedback" ("userId");

-- Triage order: newest first, and "find everything that never went out".
create index "feedback_createdAt_idx" on "feedback" ("createdAt");
create index "feedback_delivered_idx" on "feedback" ("delivered");
