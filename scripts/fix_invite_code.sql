-- One-off repair: migration 0006 was recorded as applied but the invite_code
-- table was never created (invite_redemption + index already exist). This
-- creates only the missing table so it matches migrations/0006_invite_codes.sql.
create table if not exists "invite_code" (
  "code" text not null primary key,
  "note" text,
  "max_uses" integer not null default 1,
  "used_count" integer not null default 0,
  "expires_at" text,
  "revoked" integer not null default 0,
  "created_at" text not null default (datetime('now'))
);
