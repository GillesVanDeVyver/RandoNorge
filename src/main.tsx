import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Inter is bundled locally (@fontsource) instead of loaded from
// fonts.googleapis.com: remote Google Fonts sends every visitor's IP
// address to Google before any consent, which EU case law treats as a
// GDPR violation (LG München I, 3 O 17493/20). Self-hosting also makes
// the app faster and usable offline in the mountains.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import './index.css'
import { consumeSeasonPathOverride } from './theme/season.ts'
import { Root } from './Root.tsx'

// Seasonal theme override via the URL ("/summer", "/winter/planner", …):
// remember it for this browser session and strip the segment from the URL.
// Must happen before <Root/> reads window.location for its routing.
consumeSeasonPathOverride()

// Dev-only GPS movement simulator: run `npm run dev` and open the app with
// `?simulate` in the URL (e.g. http://localhost:5173/?simulate). Excluded
// from production builds via the import.meta.env.DEV guard.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('simulate')) {
  import('./dev/gpsSimulator')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
