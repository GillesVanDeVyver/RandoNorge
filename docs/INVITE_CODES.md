# Invite-code gate (closed alpha)

During the alpha, only people you hand a code to can create an account — but
they still go through the **real** email/password sign-up flow, so that flow
gets properly tested. A code only decides *who* gets in; it does not create
the account.

## How it works

1. The sign-up form (`apps/web/src/components/LoginPage.tsx`) shows an **Invite code**
   field and sends it alongside name/email/password/username.
2. The Worker intercepts `POST /api/auth/sign-up/email`
   (`worker/index.js` → `gatedEmailSignUp`) and validates the code against the
   `invite_code` table (`worker/invite.js`):
   - unknown, revoked, expired, or fully-used codes are all rejected with
     **403** and reported to the user the same way, so the endpoint can't be
     used to probe which codes exist;
   - attempts are rate-limited to 15/hour per IP, which — combined with the
     ~40 bits of entropy in each code — makes guessing infeasible.
3. Only if the code is valid does the Worker forward the request to Better
   Auth. When Better Auth confirms success, the Worker consumes **one use** of
   the code and logs the redemption (address + timestamp) in
   `invite_redemption`. A failed sign-up (taken username, weak password) leaves
   the code untouched.

## Schema

`migrations/0006_invite_codes.sql` adds:

- `invite_code` — `code` (PK, normalized upper-case), `note`, `max_uses`
  (default 1), `used_count`, `expires_at` (ISO-8601 or null), `revoked`,
  `created_at`.
- `invite_redemption` — audit trail of `code`, `email`, `redeemed_at`.

Apply it:

```sh
npx wrangler d1 migrations apply fjellrute-db-eu --local     # dev
npx wrangler d1 migrations apply fjellrute-db-eu --remote    # production
```

## Creating codes

Generate codes and the SQL to insert them with the helper script (prints the
codes to the terminal and the SQL to stdout):

```sh
# One single-use codes for the first testers, 7 days:
node scripts/invite/create-invite.mjs --count 1 --days 7 --note "batch-1" > /tmp/codes.sql

# Apply to production (drop --remote + use --local for a dev DB):
npx wrangler d1 execute fjellrute-db-eu --remote --file /tmp/codes.sql
```

Options: `--count N` (default 1), `--uses N` (default 1), `--days N` (default
never expires), `--note "..."`, `--prefix STR` (default `FJELL`).

## Managing codes by hand

List codes and how used they are:

```sh
npx wrangler d1 execute fjellrute-db-eu --remote --command \
  'SELECT code, note, used_count, max_uses, expires_at, revoked FROM invite_code ORDER BY created_at DESC;'
```

See who redeemed what:

```sh
npx wrangler d1 execute fjellrute-db-eu --remote --command \
  'SELECT code, email, redeemed_at FROM invite_redemption ORDER BY redeemed_at DESC;'
```

Revoke a code immediately (kill switch, independent of uses left):

```sh
npx wrangler d1 execute fjellrute-db-eu --remote --command \
  "UPDATE invite_code SET revoked = 1 WHERE code = 'FJELL-XXXX-XXXX';"
```

## Opening public sign-ups later

Delete the intercept block in `worker/index.js` (the
`if (pathname === '/api/auth/sign-up/email' …) return gatedEmailSignUp(…)`
lines) and remove the **Invite code** field from `LoginPage.tsx`. The tables
can stay — they simply stop being consulted.
