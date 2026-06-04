import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
    },
  },
})
