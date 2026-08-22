import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Auth (Better Auth) runs in the Cloudflare Worker, not in Vite. To
      // exercise login flows during development, run the Worker alongside
      // the dev server (`npm run build && npx wrangler dev`, listens on
      // 8787) and Vite forwards /api requests to it. Everything else in
      // the app works without wrangler running.
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: false,
      },
      // Terrain-DEM tiles for the 3D view. In production the Worker serves
      // these from R2 (Kartverket-derived tiles) with AWS fallback
      // (worker/terrain.js); in frontend-only dev we skip straight to the
      // AWS Terrarium fallback so the 3D view works without wrangler
      // running. Run `wrangler dev` and hit :8787 to exercise the R2 path.
      '/terrain-dem': {
        target: 'https://s3.amazonaws.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) =>
          path.replace(/^\/terrain-dem/, '/elevation-tiles-prod/terrarium'),
      },
      // NVE's GridTimeSeries (seNorge snow data) does not return CORS headers,
      // so we forward dev requests through the Vite dev server. The browser
      // hits /gts-api/... and Vite rewrites it to https://gts.nve.no/api/...
      '/gts-api': {
        target: 'https://gts.nve.no',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/gts-api/, '/api'),
      },
      // NVE's Varsom avalanche warning service (the snøskredvarsel shown on
      // senorge.no) also lacks CORS headers, so dev requests are forwarded
      // through Vite: /varsom-api/... → https://api01.nve.no/...
      '/varsom-api': {
        target: 'https://api01.nve.no',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/varsom-api/, ''),
      },
      // There used to be a fourth upstream here, /nvdb-api onto Statens
      // vegvesen's Nasjonal vegdatabank, for the parking tab. Parking moved to
      // OpenStreetMap on 2026-08-22 and is served from D1 by the Worker at
      // /api/parking, which the /api rule below already forwards — no upstream
      // host and no dev-only identifying headers to keep in step with the
      // Worker's. See docs/parking-data-sources.md.
      //
      // MET Norway's locationforecast (yr.no weather) requires an identifying
      // User-Agent header. Browsers don't allow fetch() to set User-Agent, so
      // we proxy through the dev server and stamp the header here.
      '/metno-api': {
        target: 'https://api.met.no',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/metno-api/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader(
              'User-Agent',
              'Fjellrute/0.1 https://github.com/fjellrute',
            );
          });
        },
      },
    },
  },
})
