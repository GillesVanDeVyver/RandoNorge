# Deploying fjellrute to Cloudflare Pages (free)

The app is a static Vite build plus three tiny reverse proxies (in `functions/`)
that forward `/metno-api`, `/gts-api` and `/varsom-api` to MET Norway and NVE —
the same paths the Vite dev server proxies locally. Cloudflare Pages hosts both
for free, and the free tier explicitly allows commercial use.

What the free tier gives you:

- Unlimited static requests and bandwidth for the app itself.
- 100,000 Pages Functions invocations per day for the three API proxies.
  Only weather/snow/avalanche lookups hit the functions; map tiles, elevation
  and search go directly to Kartverket/AWS from the browser and cost nothing.
  Edge caching in the proxies means most lookups never even count as fresh
  upstream traffic.
- A `*.pages.dev` subdomain with HTTPS, or bring your own domain (a `.no`
  domain is the only real launch cost, roughly 100–150 kr/year).

## One-time setup

1. Create a free account at https://dash.cloudflare.com (no credit card needed).
2. Push the repository to GitHub or GitLab.
3. In the Cloudflare dashboard: **Workers & Pages → Create → Pages →
   Connect to Git**, pick the repo, and set:
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Deploy. The `functions/` directory is detected automatically — no extra
   configuration. Every push to the default branch redeploys; pull requests
   get free preview deployments.

Alternatively, deploy from the command line without connecting Git:

```sh
npm run build
npx wrangler pages deploy dist --project-name fjellrute
```

(When deploying with wrangler, the `functions/` directory in the repo root is
bundled automatically.)

## Things to keep correct over time

- `functions/_proxy.js` contains the `User-Agent` sent to MET
  (`fjellrute/0.1 tryggve@sonofit.no`). MET's terms require it to identify
  the app and include a working contact — update it if the contact changes,
  and bump the version when releasing.
- Cache lifetimes: MET 30 min, seNorge snow 6 h, Varsom warnings 1 h. They
  are set per-route in `functions/*/[[path]].js`.
- If traffic ever approaches 100k function requests/day (a very good
  problem — that's thousands of daily users), the paid Workers plan is
  $5/month, or the snow/avalanche lookups can be moved behind longer cache
  TTLs first.
