# Removing a user account from the database

How to delete a user (by email address) from the D1 database
(`fjellrute-db`), for example to clean up test accounts or to handle a
deletion request. Deleting the `user` row is enough to remove everything:
the `session`, `account` and `route` tables all reference `user` with
`on delete cascade` (see `migrations/0001_auth_and_routes.sql`).

All commands run from the project root and need a logged-in wrangler
(`npx wrangler login`).

> **Local vs remote:** `wrangler.jsonc` sets `"remote": true` for the D1
> binding, so `--remote` below targets the **production** database — the
> same one `wrangler dev` uses. Only use `--local` if you removed that
> line and develop against an isolated local copy.

## 1. Look up the account first

Confirm the account exists and see what would go with it (replace the
email address throughout):

```sh
npx wrangler d1 execute fjellrute-db --remote --command "
  select u.id, u.email, u.name, u.emailVerified, u.createdAt,
         (select count(*) from session s where s.userId = u.id) as sessions,
         (select count(*) from route   r where r.userId = u.id) as routes
  from user u
  where lower(u.email) = lower('someone@example.com')"
```

No rows → nothing to delete. Note that `routes` is the number of saved
routes that will be permanently deleted along with the account.

## 2. Delete the user

Two statements: the second removes the user (cascading to sessions,
credentials/linked providers and saved routes); the first cleans up any
pending verification / password-reset tokens, which are keyed by email
rather than by user id and therefore do **not** cascade.

```sh
npx wrangler d1 execute fjellrute-db --remote --command "
  delete from verification
  where lower(identifier) = lower('someone@example.com')
     or lower(identifier) like '%:' || lower('someone@example.com');
  delete from user
  where lower(email) = lower('someone@example.com')"
```

(The identifier is either the bare email or prefixed like
`reset-password:email`, hence the two conditions. Do **not** use a plain
`like '%email%'` — with one address that is a substring of another, e.g.
`one@example.com` vs `someone@example.com`, it would delete the wrong
user's tokens.)

The output of the second statement shows `"changes": n` — the user row
plus its cascaded rows. `"changes": 0`-style output with `changed_db:
false` means the email didn't match anything.

## 3. Verify

```sh
npx wrangler d1 execute fjellrute-db --remote --command "
  select count(*) as remaining
  from user
  where lower(email) = lower('someone@example.com')"
```

`remaining = 0` and the address is free to register again.

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
