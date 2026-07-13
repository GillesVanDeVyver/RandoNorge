# Deploy Fjellrute

Copy-paste this into your terminal to deploy after code changes. These are the
exact commands used for the successful deploy on 2026-07-13 (version
6297ad27-e84a-4aa3-82de-a6b1b023c098):

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
cd ~/Projects/PrivateProjects/RandoNorge/RandoNorge
npx wrangler whoami
npm run build
npx wrangler d1 migrations apply fjellrute-db --remote
npx wrangler deploy
```

Notes:

- The `export PATH=...` line makes the nvm-installed Node available; in a
  normal interactive terminal where nvm is loaded via `.bashrc` it is harmless
  but usually unnecessary.
- `npx wrangler whoami` just confirms you are logged in. If it says "not
  authenticated", run `npx wrangler login` first.
- The migrations step prints "No migrations to apply!" when there is nothing
  new in `migrations/` — safe to run every time.
- A successful deploy ends with the URL
  https://fjellrute.gillesvandevyver1.workers.dev and a new Version ID.
