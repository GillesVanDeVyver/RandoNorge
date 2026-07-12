import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cloudflare()],
  server: {
    proxy: {
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