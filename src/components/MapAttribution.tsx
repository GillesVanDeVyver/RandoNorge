// App-controlled replacement for the Leaflet / MapLibre attribution controls.
//
// The built-in controls render one long inline line that, on phone-width
// screens, wraps into a tall block colliding with the 2D/3D pill and the
// info chip. Owning the markup lets the layout adapt instead:
//   - Desktop (>760px): the familiar always-visible glass pill, bottom-right.
//   - Mobile (≤760px): a small © chip that expands to the full credit list
//     on tap — the same compact pattern MapLibre/Mapbox ship on small
//     screens. CC BY 4.0 / NLOD credit stays one tap away at all times.
//
// The basemap credit doubles as the app-wide data attribution: weather
// (MET, CC BY 4.0) and avalanche forecasts (NVE/Varsom, NLOD) are rendered
// in panels rather than map layers, yet their licenses still require
// visible credit. Overlay- and view-specific credits are appended from the
// current `overlay` / `view` props, mirroring what the native controls
// would have accumulated from the mounted layers.
import { useEffect, useRef, useState } from 'react';
import type { Overlay } from '../types';
import { useIsMobile } from '../useIsMobile';
import styles from './MapAttribution.module.css';

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;

interface Props {
  view: '2d' | '3d';
  overlay: Overlay;
}

function Credits({ view, overlay }: Props) {
  return (
    <>
      <span className={styles.item}>
        {view === '2d' ? (
          <a href="https://leafletjs.com/" {...ext}>
            Leaflet
          </a>
        ) : (
          <a href="https://maplibre.org/" {...ext}>
            MapLibre
          </a>
        )}
      </span>
      <span className={styles.item}>
        ©{' '}
        <a href="https://www.kartverket.no/" {...ext}>
          Kartverket
        </a>{' '}
        (CC BY 4.0)
      </span>
      <span className={styles.item}>
        Vær:{' '}
        <a href="https://www.met.no/" {...ext}>
          MET Norway
        </a>{' '}
        (CC BY 4.0)
      </span>
      <span className={styles.item}>
        Snøskredvarsel:{' '}
        <a href="https://varsom.no/" {...ext}>
          NVE / Varsom
        </a>{' '}
        (NLOD)
      </span>
      {view === '3d' && (
        <span className={styles.item}>
          Terrain ©{' '}
          <a href="https://registry.opendata.aws/terrain-tiles/" {...ext}>
            Mapzen / AWS Open Data
          </a>
        </span>
      )}
      {overlay === 'steepness' && (
        <span className={styles.item}>
          Bratthet med utløp ©{' '}
          <a href="https://www.nve.no/" {...ext}>
            NVE
          </a>
        </span>
      )}
      {overlay === 'snowdepth' && (
        <span className={styles.item}>
          Snødybde ©{' '}
          <a href="https://www.nve.no/" {...ext}>
            NVE
          </a>{' '}
          /{' '}
          <a href="https://www.met.no/" {...ext}>
            MET
          </a>{' '}
          (seNorge, NLOD)
        </span>
      )}
    </>
  );
}

export function MapAttribution({ view, overlay }: Props) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Tapping anywhere else on the map collapses the expanded credits.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  if (!isMobile) {
    return (
      <div className={styles.inline}>
        <Credits view={view} overlay={overlay} />
      </div>
    );
  }

  return (
    <div className={styles.root} ref={rootRef}>
      {open && (
        <div className={styles.panel} role="region" aria-label="Map data sources">
          <Credits view={view} overlay={overlay} />
        </div>
      )}
      <button
        type="button"
        className={styles.chip}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Map data sources"
        title="Map data sources"
      >
        ©
      </button>
    </div>
  );
}
