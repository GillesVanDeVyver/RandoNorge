-- Migration 0003: public sharing of routes and tracks.
--
-- Two additions make the "make a route public / share a link" feature work:
--
--  1. A public handle on "user". Routes and tracks are shared by an
--     unguessable per-item "shareSlug" (a direct link), but a person can
--     also browse *all* of an account's public items at /u/<username>. That
--     needs a stable, human-readable identifier that is safe to expose in a
--     URL — the account's email must never appear there — so users pick a
--     "username". It is nullable (existing accounts have none until they
--     choose one) and unique case-insensitively.
--
--  2. The same sharing columns the "route" table already carries
--     (migration 0001) are added to "track", so completed tours can be made
--     public exactly like planned routes: private until "isShared" is set,
--     then reachable by the unguessable "shareSlug".
--
-- Apply locally:  npx wrangler d1 migrations apply fjellrute-db --local
-- Apply in prod:  npx wrangler d1 migrations apply fjellrute-db --remote

alter table "user" add column "username" text;

-- Case-insensitive uniqueness: usernames are compared and routed in lower
-- case (the API lowercases before storing), but the expression index keeps
-- the guarantee even if a row is written directly. Nullable rows are exempt
-- from a UNIQUE index in SQLite, so accounts without a handle don't clash.
create unique index "user_username_unique" on "user" (lower("username"));

alter table "track" add column "isShared" integer not null default 0;
alter table "track" add column "shareSlug" text;

-- Enforces the same one-slug-per-item guarantee as the "route" table's
-- inline "shareSlug text unique"; done as an index because SQLite can't add
-- a column-level UNIQUE constraint via ALTER TABLE.
create unique index "track_shareSlug_unique" on "track" ("shareSlug");
