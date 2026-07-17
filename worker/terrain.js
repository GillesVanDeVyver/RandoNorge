// Terrain-DEM tile endpoint for the 3D view (see worker/index.js).
//
//   GET /terrain-dem/{z}/{x}/{y}.png   →  Terrarium-encoded elevation tile
//
// Serving order:
//   1. R2 bucket (binding TERRAIN, key terrarium/{z}/{x}/{y}.png) — our own
//      tiles generated from Kartverket's 1 m national LiDAR DTM (NDH,
//      CC BY 4.0) by scripts/terrain/make_terrarium_tiles.py. Coverage is
//      whatever has been generated and uploaded so far (priority topptur
//      regions first); the bucket may be missing tiles or the binding may
//      be absent entirely — both are fine.
//   2. Fallback: the AWS Open Data Terrarium tileset (Mapzen), the source
//      the 3D view used exclusively before. Same 256px PNG Terrarium
//      encoding, so the client needs no knowledge of which source a given
//      tile came from — high-res Kartverket terrain simply "fades in"
//      wherever tiles have been generated.
//
// Both sources are cached at the Cloudflare edge. Elevation data is static,
// so TTLs are long; when tiles are regenerated (new DTM release, bug fix)
// bump TILE_VERSION below to bust the edge cache and browser caches at once
// — the frontend does not need to change, since the version only appears in
// cache keys and headers, not the URL.

const AWS_TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

// Bump when regenerating/replacing already-published R2 tiles.
const TILE_VERSION = 'v1';

// AWS Terrarium tops out at z15; our own tiles are generated to z15 too
// (≈2.4 m/px at 60°N — matching the client's maxzoom, MapLibre overzooms
// beyond it). Reject anything else early.
const MAX_ZOOM = 15;

const TILE_RE = /^\/terrain-dem\/(\d{1,2})\/(\d+)\/(\d+)\.png$/;

/** Handle GET /terrain-dem/{z}/{x}/{y}.png. Returns null when the path
 *  doesn't match, so the caller can fall through to other routes. */
export async function handleTerrainTile(request, env, ctx) {
  const url = new URL(request.url);
  const m = TILE_RE.exec(url.pathname);
  if (!m) return null;

  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const z = Number(m[1]);
  const x = Number(m[2]);
  const y = Number(m[3]);
  const n = 2 ** z;
  if (z > MAX_ZOOM || x >= n || y >= n) {
    return new Response('Tile out of range', { status: 404 });
  }

  // Edge cache lookup. The version is folded into the cache key so a
  // TILE_VERSION bump invalidates everything previously cached.
  const cache = caches.default;
  const cacheKey = new Request(
    `${url.origin}${url.pathname}?v=${TILE_VERSION}`,
  );
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // 1) Our own Kartverket-derived tiles in R2. The binding is optional:
  //    before the bucket exists (or in local dev without it) everything
  //    falls through to AWS below.
  if (env.TERRAIN) {
    const obj = await env.TERRAIN.get(`terrarium/${z}/${x}/${y}.png`);
    if (obj) {
      const res = new Response(obj.body, {
        headers: {
          'Content-Type': 'image/png',
          // Immutable per version; TILE_VERSION bumps handle regeneration.
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Terrain-Source': `kartverket-ndh-${TILE_VERSION}`,
        },
      });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    }
  }

  // 2) AWS Open Data Terrarium fallback (the previous sole source).
  const upstream = await fetch(`${AWS_TERRARIUM}/${z}/${x}/${y}.png`);
  if (!upstream.ok) {
    // Pass the status through but never cache errors.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  const res = new Response(upstream.body, {
    headers: {
      'Content-Type': 'image/png',
      // Long but not immutable: a region may later be covered by R2 tiles,
      // at which point the edge copy should eventually refresh.
      'Cache-Control': 'public, max-age=2592000',
      'X-Terrain-Source': 'aws-terrarium',
    },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
