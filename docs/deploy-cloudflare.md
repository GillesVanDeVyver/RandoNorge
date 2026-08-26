# Deploying fjellrute to Cloudflare Workers (free)

The app deploys as a single Cloudflare Worker: the Vite build in `dist/` is
served as static assets, and a small script (`worker/index.js`) proxies the
three APIs that need server-side help — `/metno-api`, `/gts-api` and
`/varsom-api`, the same paths the Vite dev server proxies locally. The proxy
stamps the identifying `User-Agent` that MET's terms of service require and
caches responses at Cloudflare's edge, which MET's terms also require and
which keeps load off NVE's free APIs.

Configuration lives in the committed `wrangler.jsonc`. This matters: without
it, Cloudflare's build system auto-generates an assets-only config and the
API proxies are silently skipped (the app loads, but weather, snow and
avalanche panels fail).

What the free tier gives you (commercial use explicitly allowed):

- Static asset requests are free and unlimited — the app itself, map tiles,
  elevation and search never touch the Worker.
- 100,000 Worker requests per day for the three API proxies. Edge caching
  means most lookups are served without new upstream traffic, so realistic
  usage sits far below the cap.
- A `*.workers.dev` subdomain with HTTPS, or bring your own domain (a `.no`
  domain is the only real launch cost, roughly 100–150 kr/year).

## Deploying

There are now **two** Workers built from this one repository, and every deploy
command has to say which:

| Worker | Environment flag | Where it answers | Database |
| --- | --- | --- | --- |
| `fjellrute` | `--env=""` | `fjellrute.no` | `fjellrute-db-eu` — real accounts |
| `fjellrute-dev` | `--env dev` | `fjellrute-dev.<subdomain>.workers.dev` | `fjellrute-db-dev-eu` — throwaway |

`fjellrute-dev` exists so the phone app has a backend on the internet rather
than one on a laptop's Wi-Fi; the full rationale, and what the two Workers do
and do not share, is in the `env.dev` comment in `wrangler.jsonc`.

Via the connected Git integration (Workers Builds), every push deploys with:

- Build command: `pnpm run build` (or `npm run build`)
- Deploy command: `npx wrangler deploy --env=""`

> The `--env=""` in that dashboard field is worth checking after reading this.
> Workers Builds stores the deploy command in Cloudflare's UI, not in this
> repository, so editing this document does not change it. A bare
> `npx wrangler deploy` there still deploys production correctly — it warns
> rather than guessing — but the setting should be explicit for the same reason
> the local command is.

Or from the command line:

```sh
npm run build
npx wrangler deploy --env=""
```

and for the dev Worker (first-time setup — creating its database, applying
migrations, setting its secrets — is in the `env.dev` comment in
`wrangler.jsonc`):

```sh
pnpm build
npx wrangler deploy --env dev
```

Preview a production-like build locally (Worker + assets together) with:

```sh
npm run build
npx wrangler dev
```

Then check that `http://localhost:8787/metno-api/weatherapi/locationforecast/2.0/compact?lat=62.548&lon=7.747`
returns JSON — that proves the proxy path works end to end.

## Things to keep correct over time

- `worker/proxy.js` contains the `User-Agent` sent to MET
  (`fjellrute/0.1 contact@fjellrute.no`). MET's terms require it to identify
  the app and include a working contact — update it if the contact changes,
  and bump the version when releasing.
- Cache lifetimes are defined in `worker/index.js`: MET 30 min, seNorge
  snow 6 h, Varsom warnings 1 h.
- If traffic ever approaches 100k Worker requests/day (a very good
  problem — that's thousands of daily users), the paid Workers plan is
  $5/month, or the cache TTLs can simply be raised first.
