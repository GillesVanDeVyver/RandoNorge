# Deploy Fjellrute

Copy-paste this into your terminal to deploy after code changes.

```bash
cd ~/PrivateProjects/RandoNorge
npx wrangler whoami
pnpm build
npx wrangler d1 migrations apply fjellrute-db-eu --local
npx wrangler d1 migrations apply fjellrute-db-eu --remote
npx wrangler deploy --env=""
```

Notes:

- `--env=""` means "the top-level environment", i.e. production — the Worker
  `fjellrute` on `fjellrute.no`. It became necessary on 2026-08-26, when
  wrangler.jsonc gained a second environment (`env.dev`, the `fjellrute-dev`
  Worker the phone talks to). A bare `npx wrangler deploy` still deploys
  production, but it now prints a warning that no target environment was
  specified, and a deploy command that warns is one somebody eventually
  "fixes" by adding the wrong flag. Passing it explicitly says which of the two
  Workers is being replaced. To deploy the other one:
  `pnpm build && npx wrangler deploy --env dev` — see the `env.dev` comment in
  wrangler.jsonc for what that Worker is and what it does not share with this
  one.

- The repository lives at `~/PrivateProjects/RandoNorge`. This file previously
  named `~/Projects/PrivateProjects/RandoNorge/RandoNorge`, which no longer
  exists; if the path drifts again,
  `find ~ -maxdepth 6 -name wrangler.jsonc -not -path '*/node_modules/*'`
  finds it. Every command here must run from inside the repo — wrangler
  resolves `wrangler.jsonc` relative to the working directory, and from
  anywhere else it fails with "No configuration file found" no matter how
  correct the rest of the command is.
- Node must be ≥ 22: `tsc`, Vite and the `scripts/verify-*.mjs` checks all
  refuse to run on older versions. If the shell has an old Node, load nvm or
  `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"`.
- `npx wrangler whoami` is not a formality — read the **email line**, not just
  the account table. See "Which Cloudflare account" below.
- The migrations step prints "No migrations to apply!" when there is nothing new
  in `migrations/` — safe to run every time. Apply migrations *before* deploying
  the Worker, or the new code meets a table that does not exist yet. `--local`
  only touches the SQLite file under `.wrangler/state` that `wrangler dev` uses;
  `--remote` is production.
- Answer **no** if wrangler offers to add a binding on your behalf. Saying yes
  writes a duplicate binding into `wrangler.jsonc`, which is what stopped step 7
  of `docs/D1-EU-JURISDICTION-MIGRATION.md`.
- A successful deploy ends with the URL
  https://fjellrute.gillesvandevyver1.workers.dev and a new Version ID. The
  reference deploy for this file was 2026-07-13, version
  6297ad27-e84a-4aa3-82de-a6b1b023c098.

## Which Cloudflare account

Everything — the `fjellrute.no` zone, this Worker, the R2 bucket and the D1
database `fjellrute-db-eu` (`1d6f92bf-83c8-4dce-80f6-d20b4a09674b`) — lives in
**one** account:

| Cloudflare login | Account name | Account ID | Holds the project? |
| --- | --- | --- | --- |
| `gillesvandevyver1@gmail.com` | Gillesvandevyver1@gmail.com's Account | `1558c6da960183cc75e12fbd7a9df3ce` | **yes — this is the one** |
| `fjellrute@gmail.com` | Fjellrute@gmail.com's Account | `86b4d4ec6dc6b82b24f2b336c40ca409` | no — zero D1 databases |
| `fjellrute@gmail.com` | gillesvandevyver1@gmail.com | `1894fc39541682a6a6ab0f04a3fa519f` | no — zero D1 databases |

The trap, worked out the hard way on 2026-08-08, is that `fjellrute@gmail.com`
is a *separate Cloudflare user* and not merely an address. It is the Google
OAuth support contact (`docs/AUTH_SETUP.md`), it is the mailbox behind Resend
and Email Routing, so it is the natural guess for the Cloudflare login too. It
is not. Worse, the third row is an account *named* `gillesvandevyver1@gmail.com`
that `fjellrute@gmail.com` is a member of — so the account picker offers a
convincing wrong answer, and signing into the dashboard as the wrong user shows
an empty Websites list, which looks exactly like a lost domain.

`wrangler.jsonc` now pins `account_id`, so this should stay solved. The rest of
this section is for when it does not.

### Reading the failures

**`7403 The given account is not valid or is not authorized to access this
service`** — the token cannot see the account named in the request URL at all.
Compare that account id against `wrangler whoami`. The usual causes are the
account cache described below, or a `CLOUDFLARE_ACCOUNT_ID` /
`CLOUDFLARE_API_TOKEN` left exported in a shell profile, which silently
overrides the OAuth login: check with `env | grep -i CLOUDFLARE`.

**`7404 The database 1d6f92bf-… could not be found`** — the token is fine and
the id is fine; you are asking the wrong account. The id is committed and
production serves from it, so treat this as an account error and never as a
reason to edit `database_id`.

**`npx wrangler d1 list` printing nothing at all** is the fastest tell. This
project's account always holds at least `fjellrute-db-eu`, so an empty list
means wrong account, not deleted database.

### Two reasons switching login is harder than it looks

`wrangler login` inherits the browser's dashboard session. If the browser is
signed in as the wrong user, `wrangler logout && wrangler login` returns a fresh
token for that *same* wrong user and the only visible difference is a new token
— it happened twice in a row here before anyone noticed the email line had not
changed. Sign out at https://dash.cloudflare.com/logout, or use a private
window, before logging in.

wrangler also caches the selected account per checkout in
`node_modules/.cache/wrangler/wrangler-account.json`, and that file survives
`wrangler logout`. When switching accounts, delete it:

```sh
rm -f node_modules/.cache/wrangler/wrangler-account.json
```

### The deterministic escape hatch

If the OAuth dance keeps landing on the wrong identity, create an API token in
the owning account (My Profile → API Tokens, permission **Account → D1 → Edit**)
and pass it explicitly. An environment token beats the OAuth credentials, so
nothing depends on browser state:

```sh
export CLOUDFLARE_API_TOKEN=<token>          # in the shell only, never in a file
export CLOUDFLARE_ACCOUNT_ID=1558c6da960183cc75e12fbd7a9df3ce
npx wrangler d1 migrations apply fjellrute-db-eu --remote
```

`unset` both afterwards, or they become the next `7403`.

### Do not "fix" an empty account by filling it

A zone can exist in only one Cloudflare account, and re-adding `fjellrute.no`
elsewhere drops its DNS records, its Email Routing rules and its edge
certificate — that is how this kind of confusion takes a working site down. D1
databases cannot be transferred between accounts at all; moving one is an
export-and-import of everyone's personal data, which is what
`docs/D1-EU-JURISDICTION-MIGRATION.md` describes. If one login should see
everything, the answer is Members → invite `fjellrute@gmail.com` into
`1558c6da…` as Super Administrator, not a second copy of anything.

### It is not a jurisdiction problem

`fjellrute-db-eu` is an EU-jurisdiction database, which makes "could not be
found" look like the jurisdiction scoping that jurisdictional R2 buckets need.
It is not: wrangler only ever sends a `cf-r2-jurisdiction` header (grep
`node_modules/wrangler/wrangler-dist/cli.js`), there is no D1 equivalent, and
the `d1` subcommands accept no `--jurisdiction` flag. Every remote command in
the EU migration runbook ran against this database with a plain `--remote` on
2026-07-29. The hedge that used to live in that document has been narrowed to
say so.

## The site being up proves nothing about the CLI

`https://fjellrute.no` serves the "Kommer snart" landing page from static assets
and touches no database, so it stays perfectly healthy while wrangler is pointed
at an empty account. Two cheap probes that do mean something:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://fjellrute.no/api/public/route/does-not-exist
curl -s -o /dev/null -w '%{http_code}\n' https://fjellrute.no/api/feedback
```

The first should be `404`: the handler ran and asked D1 for a slug that does not
exist, so the binding works — `500` would mean the deployed Worker's D1 binding
is broken. The second should be `405`, because `/api/feedback` accepts POST
only, which proves the currently served Worker includes the feedback endpoint.
