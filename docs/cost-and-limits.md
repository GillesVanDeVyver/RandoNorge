# Cloudflare cost & free-tier limits

Short version: the free tier comfortably covers fjellrute through the Jan 2027
viability gate (~300 weekly active users) and well beyond. The only realistic
way to exceed it is a viral traffic spike (e.g. Show HN front page), for which
the fix is Workers Paid at $5/mo, kept on standby for launch week only. Storage
in R2 is the one number to watch as terrain coverage grows.

_Free-tier figures below are current as of July 2026; Cloudflare adjusts them
periodically, so re-check the pricing page before launch week._

## What the app uses

Four Cloudflare products, all configured in `wrangler.jsonc`:

- **Workers** — serves the SPA and runs the API proxies (`/metno-api`,
  `/gts-api`, `/varsom-api`), auth (`/api/auth/*`), saved routes/tracks, and
  terrain tiles (`/terrain-dem/*`).
- **D1** (`fjellrute-db`) — accounts, sessions, verification tokens, saved
  routes, recorded tracks.
- **R2** (`fjellrute-terrain`) — Kartverket-derived Terrarium terrain tiles for
  the 3D view, with AWS Open Data fallback for uncovered areas.
- **Static assets** (the `dist/` build) plus one **daily cron** (GDPR retention
  cleanup at 03:47 UTC).

## The metric that matters: Worker requests/day (free limit 100k)

`wrangler.jsonc` sets `run_worker_first` on `/api/*`, the three API proxies, and
`/terrain-dem/*`. Every one of those requests invokes the Worker and counts
against the 100k/day budget — **even on an edge-cache hit**, because caching
happens inside the Worker via `caches.default`. What does *not* count: the static
app shell (JS/CSS/images/HTML from the assets binding) and the 2D Kartverket topo
tiles (fetched directly from Kartverket, never through the Worker).

So the daily budget is essentially: auth calls + weather/snow/avalanche proxy
calls + 3D terrain tiles. Modelled scenarios:

| Scenario | Worker requests/day | Verdict |
|---|---|---|
| Founding beta (20–50 users, Sep–Oct) | ~3,400 | Nowhere close |
| Viability target (~300 WAU, busy bulletin weekend) | ~20,000 | Fine |
| Genuinely busy day (500 daily actives w/ 3D) | ~75,000 | Under, but watch |
| Show HN spike (~20,000 visitors, 3D opened) | 100k–500k | **Exceeds free tier** |

The 3D terrain view is the biggest lever: a single view loads dozens to a couple
hundred tiles, each a Worker hit. If Worker-request load ever needs cutting
structurally, the move is to serve terrain tiles so Cloudflare's edge cache can
answer them *without* invoking the Worker — an optimization for later, not now.

## D1, R2 operations, and cron: all comfortably within free tier

- **D1** — storage stays in megabytes for thousands of users (free is 5 GB).
  Writes even in a 20k-signup spike (~60k) stay under the 100k/day write cap;
  reads stay far under the 5M/day read cap.
- **R2 operations** — egress is always free (the whole reason R2 fits tile
  serving). Class A (uploads) is a one-time bulk cost of ~160k ops for ~8 GB of
  tiles against a 1M/month free allowance. Class B (reads) stays within the
  10M/month free allowance even at 300k R2 tile-misses/day (~9M/month), and most
  tiles are browser/edge-cached after first view.
- **Cron** — included free.

## The one thing to watch: R2 storage (free limit 10 GB)

`scripts/terrain/make_terrarium_tiles.py` estimates ~1.4 GB per 100×100 km
region at z8–15. The six priority topptur regions (Lyngen, Tromsø, Sunnmøre,
Romsdal, Lofoten, Jotunheimen) come to roughly 8.4 GB — under 10 GB, but not by
much. Adding a couple more regions or pushing to z16 crosses the limit, at which
point overage is ~$0.015/GB-month (pennies). The AWS Terrarium fallback in
`worker/terrain.js` means all of Norway never has to be stored, which is what
keeps this in budget.

## Practical guidance

- Keep a payment card on file (R2 requires it anyway) so a launch-day spike
  auto-scales instead of erroring.
- Treat Workers Paid ($5/mo) as a launch-week-only insurance switch, per the
  launch plan's risk checklist.
- Watch R2 storage as terrain coverage grows; crossing 10 GB costs pennies, not
  dollars.
- Total cash outlay before revenue remains roughly one `.no` domain
  (~100–150 kr/year).
