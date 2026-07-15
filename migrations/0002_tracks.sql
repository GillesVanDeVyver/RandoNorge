-- Migration 0002: recorded tracks ("actual routes").
--
-- A track is what the user actually travelled while navigating a planned
-- route ("Start route" in the planner). It mirrors the "route" table's
-- storage model: "geometry" holds a stringified GeoJSON Feature with a
-- MultiLineString (one line per uninterrupted recording stretch — pauses
-- start a new line) and precomputed display stats in properties
-- (distanceM, ascentM, descentM, durationS).
--
-- "routeId" links the track back to the planned route it navigated; it is
-- nullable (recording an unsaved plan) and set null if the plan is later
-- deleted, so the activity log survives route cleanup.
--
-- Apply locally:  npx wrangler d1 migrations apply fjellrute-db --local
-- Apply in prod:  npx wrangler d1 migrations apply fjellrute-db --remote

create table "track" (
  "id" text not null primary key,
  "userId" text not null references "user" ("id") on delete cascade,
  "routeId" text references "route" ("id") on delete set null,
  "name" text not null,
  "geometry" text not null,
  "startedAt" date not null,
  "finishedAt" date not null,
  "createdAt" date not null
);

create index "track_userId_idx" on "track" ("userId");
create index "track_routeId_idx" on "track" ("routeId");
