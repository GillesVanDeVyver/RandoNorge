-- Migration 0005: durable rate limiting.
--
-- Cloudflare runs the Worker across many short-lived isolates worldwide, so
-- Better Auth's default *in-memory* rate limiter only ever sees one isolate's
-- slice of traffic — it barely throttles a distributed brute-force / credential
-- stuffing attack. Both limiters below move that state into D1 so counts are
-- shared across every isolate.
--
--   1. "rateLimit"      — Better Auth's own store for /api/auth/* (enabled with
--                         storage:"database" in worker/auth.js). Better Auth
--                         owns the rows; these are the columns it expects.
--   2. "app_rate_limit" — a generic per-IP fixed-window limiter used by the
--                         custom /api/account-exists endpoint (worker/rateLimit.js).
--
-- Apply with:
--   npx wrangler d1 migrations apply fjellrute-db --remote

create table "rateLimit" (
  "id" text not null primary key,
  "key" text,
  "count" integer,
  "lastRequest" integer
);

create table "app_rate_limit" (
  "key" text not null primary key,
  "count" integer not null,
  "resetAt" integer not null
);

-- Lets a future cleanup job (or manual purge) drop stale buckets cheaply.
create index "app_rate_limit_resetAt_idx" on "app_rate_limit" ("resetAt");
