-- Migration 0001: authentication tables + saved routes.
--
-- The four auth tables (user, session, account, verification) are exactly
-- what Better Auth v1.6 expects for email/password sign-in with email
-- verification — generated with better-auth's own migration compiler, so
-- column names/types must not be changed independently of the library.
--
-- The "route" table is created now (empty) so the upcoming save/share
-- feature only needs API endpoints, not a schema change.
--
-- Apply locally:  npx wrangler d1 migrations apply fjellrute-db --local
-- Apply in prod:  npx wrangler d1 migrations apply fjellrute-db --remote

create table "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" integer not null,
  "image" text,
  "createdAt" date not null,
  "updatedAt" date not null
);

create table "session" (
  "id" text not null primary key,
  "expiresAt" date not null,
  "token" text not null unique,
  "createdAt" date not null,
  "updatedAt" date not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);

-- One row per credential/provider a user can sign in with. For plain
-- email+password the hashed password lives in "password".
create table "account" (
  "id" text not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" date,
  "refreshTokenExpiresAt" date,
  "scope" text,
  "password" text,
  "createdAt" date not null,
  "updatedAt" date not null
);

-- Short-lived tokens: email verification links, password reset links.
create table "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" date not null,
  "createdAt" date not null,
  "updatedAt" date not null
);

create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");

-- Saved tours (feature comes in the next step; table is ready now).
-- "geometry" holds the route as a GeoJSON LineString string — the same
-- lat/lng list the app already keeps in memory while drawing.
-- Sharing model: a route is private until "isShared" is set; shared
-- routes are reachable by the unguessable "shareSlug" in a URL.
create table "route" (
  "id" text not null primary key,
  "userId" text not null references "user" ("id") on delete cascade,
  "name" text not null,
  "description" text,
  "geometry" text not null,
  "isShared" integer not null default 0,
  "shareSlug" text unique,
  "createdAt" date not null,
  "updatedAt" date not null
);

create index "route_userId_idx" on "route" ("userId");
