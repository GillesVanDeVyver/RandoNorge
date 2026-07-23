// HTTP security headers applied to every response the Worker returns
// (wrapped once in worker/index.js). These are defense-in-depth: they don't
// replace the per-endpoint auth/ownership checks, they harden the browser
// side against clickjacking, protocol downgrade, MIME sniffing and injected
// resources.
//
// The Content-Security-Policy is tuned to exactly the origins the app uses:
//   - script:  self only, plus 'wasm-unsafe-eval' because MapLibre GL
//              compiles WebAssembly. No remote/CDN scripts, no eval.
//   - workers: blob: — MapLibre GL spawns its tile workers from blobs.
//   - style:   'unsafe-inline' — Leaflet, MapLibre and CSS-modules set inline
//              style attributes at runtime (unavoidable without nonces).
//   - img:     self + data:/blob: canvases + the raster-tile hosts
//              (Kartverket, NVE, OpenStreetMap).
//   - connect: self (the /api and /*-api proxies + /terrain-dem) plus the
//              Geonorge/NVE/Kartverket hosts the client fetches directly
//              (elevation, place search, steepness export, seNorge WMS).
// If a new external map/data host is added, extend img-src / connect-src here.

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  'worker-src blob:',
  'child-src blob:',
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob: https://cache.kartverket.no https://gis3.nve.no https://kart.nve.no https://tile.openstreetmap.org",
  "connect-src 'self' https://ws.geonorge.no https://cache.kartverket.no https://gis3.nve.no https://kart.nve.no",
  'upgrade-insecure-requests',
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  // Two years, preload-eligible. Harmless over http (wrangler dev): browsers
  // only honour HSTS on https responses.
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  // Belt-and-braces with the CSP frame-ancestors directive above.
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  // Geolocation is used for live tracking, so it stays allowed for same
  // origin; everything else the app never needs is denied.
  'Permissions-Policy':
    'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
};

/**
 * Return a copy of `response` with the security headers set. Rebuilds the
 * response because asset responses can have immutable headers.
 */
export function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
