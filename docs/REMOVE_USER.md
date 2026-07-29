# Removing a user account from the database

How to delete a user (by email address) from the D1 database
(`fjellrute-db-eu`), for example to clean up test accounts or to handle a
GDPR art. 17 deletion request that arrives by email.

> **There is now a code path for this too.** `DELETE /api/account`
> (`worker/account.js`) lets a signed-in user delete their own account after
> confirming with their email address and, if the account has one, their
> password. It runs the same statements as step 2 below via
> `deleteAccountRows()`. **If you change one, change the other** — and run
> `pnpm test:deletion`, which executes both against a scratch copy of the
> schema and asserts that the address survives nowhere.

Deleting the `user` row takes most of it: `session`, `account` and `route`
cascade from `migrations/0001_auth_and_routes.sql`, and `track` cascades
from `migrations/0002_tracks.sql`. **Two tables do not cascade** because
they are keyed by email address rather than by user id, so they need their
own statements or the address survives the deletion:

- `verification` — pending email-verification / password-reset tokens.
- `invite_redemption` — the closed-alpha audit trail (`code`, `email`,
  `redeemed_at`, `migrations/0006_invite_codes.sql`). Every alpha account
  has a row here, so skipping it leaves the person's email address and
  join date in the database indefinitely.

Step 2 below covers both. The `invite_code` row itself holds no personal
data and stays as-is (its `used_count` records that a code was spent,
which is still true).

All commands run from the project root and need a logged-in wrangler
(`npx wrangler login`).

> **Local vs remote:** the D1 binding in `wrangler.jsonc` carries no
> `"remote"` flag, so `wrangler dev` develops against an isolated **local**
> copy of the database while `--remote` below targets **production**. Pass
> `--local` instead to operate on the dev copy.

## 1. Look up the account first

Confirm the account exists and see what would go with it (replace the
email address throughout):

```sh
npx wrangler d1 execute fjellrute-db-eu --remote --command "
  select u.id, u.email, u.name, u.emailVerified, u.createdAt,
         (select count(*) from session s where s.userId = u.id) as sessions,
         (select count(*) from route   r where r.userId = u.id) as routes,
         (select count(*) from track   t where t.userId = u.id) as tracks
  from user u
  where lower(u.email) = lower('someone@example.com')"
```

No rows → nothing to delete. Note that `routes` and `tracks` are the number
of saved routes and recorded tours that will be permanently deleted along
with the account.

## 2. Delete the user

Three statements. The last removes the user, cascading to sessions,
credentials/linked providers, saved routes and recorded tracks. The first
two clean up the tables keyed by email address, which therefore do **not**
cascade: pending verification / password-reset tokens, and the invite
redemption record.

```sh
npx wrangler d1 execute fjellrute-db-eu --remote --command "
  delete from verification
  where lower(identifier) = lower('someone@example.com')
     or lower(identifier) like '%:' || lower('someone@example.com');
  delete from invite_redemption
  where lower(email) = lower('someone@example.com');
  delete from user
  where lower(email) = lower('someone@example.com')"
```

(The identifier is either the bare email or prefixed like
`reset-password:email`, hence the two conditions. Do **not** use a plain
`like '%email%'` — with one address that is a substring of another, e.g.
`one@example.com` vs `someone@example.com`, it would delete the wrong
user's tokens.)

The output of the last statement shows `"changes": n` — the user row plus
its cascaded rows. `"changes": 0`-style output with `changed_db: false`
means the email didn't match anything.

## 3. Verify

Check every table that stores the address, not just `user` — the point of
this step is to prove the email is actually gone:

```sh
npx wrangler d1 execute fjellrute-db-eu --remote --command "
  select
    (select count(*) from user              where lower(email)      = lower('someone@example.com')) as users,
    (select count(*) from invite_redemption where lower(email)      = lower('someone@example.com')) as redemptions,
    (select count(*) from verification      where lower(identifier) = lower('someone@example.com')
        or lower(identifier) like '%:' || lower('someone@example.com'))                             as tokens"
```

All three `0` and the address is fully removed and free to register again.

## Notes

- **Sessions die with the user.** Any browser still holding a session
  cookie for the deleted account is signed out on its next request (the
  cascade removed the session row), so there is nothing else to revoke.
- **Google accounts too.** Accounts created via "Sign up with Google"
  live in the same `user`/`account` tables, so the same procedure
  applies. Deleting the account here does not touch anything on Google's
  side; signing up again with Google simply creates a fresh account.
- **Case-insensitive matching.** The commands compare emails with
  `lower(...)` so the exact casing used at sign-up doesn't matter.
- **Testing the first-visit greeting.** The account overview greets a
  user's first-ever session with "Welcome" (via `/api/first-visit`) and
  every later session with "Welcome back". To re-test the first-visit
  path with the same email, delete the account as above and sign up
  again.
