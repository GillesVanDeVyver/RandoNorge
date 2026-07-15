import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Root } from './Root.tsx'

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
