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
import type { Overlay } from '@fjellrute/core/types';
import { useIsMobile } from '../useIsMobile';
import { useParkingAreas } from '../parking/store';
import { useT } from '@fjellrute/core/i18n';
import styles from './MapAttribution.module.css';

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;

interface Props {
  view: '2d' | '3d';
  overlay: Overlay;
}

function Credits({ view, overlay }: Props) {
  const t = useT();
  // Parking is not a layer with a `overlay` value of its own — the pins are
  // drawn from the parking store, and they appear and disappear with the tab's
  // query rather than with a control the map owns. So the credit asks the same
  // store the pins do: exactly when there is OpenStreetMap data on the map,
  // OSM is credited for it, and on a session where nobody opened the tab the
  // line never appears at all.
  //
  // This one is a licence condition rather than a courtesy. ODbL §4.3 requires
  // the notice wherever the data is publicly used, so the coupling to the
  // store is what makes the credit provably exact — it cannot be showing OSM
  // pins without this line, and it cannot be claiming OSM without pins.
  const parkingShown = useParkingAreas().length > 0;
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
        {t('Vær:', 'Weather:')}{' '}
        <a href="https://www.met.no/" {...ext}>
          MET Norway
        </a>{' '}
        (CC BY 4.0)
      </span>
      <span className={styles.item}>
        {t('Snøskredvarsel:', 'Avalanche forecast:')}{' '}
        <a href="https://varsom.no/" {...ext}>
          NVE / Varsom
        </a>{' '}
        (NLOD)
      </span>
      {parkingShown && (
        <span className={styles.item}>
          {t('Parkering:', 'Parking:')} ©{' '}
          <a href="https://www.openstreetmap.org/copyright" {...ext}>
            {t('OpenStreetMap-bidragsytere', 'OpenStreetMap contributors')}
          </a>{' '}
          (
          <a href="https://opendatacommons.org/licenses/odbl/1-0/" {...ext}>
            ODbL
          </a>
          )
        </span>
      )}
      {view === '3d' && (
        <span className={styles.item}>
          {/* /terrain-dem serves Kartverket NDH-derived tiles from R2 with
              AWS Terrarium fallback (worker/terrain.js) — credit both. */}
          {t('Terreng', 'Terrain')} ©{' '}
          <a href="https://hoydedata.no/" {...ext}>
            Kartverket
          </a>{' '}
          (CC BY 4.0) /{' '}
          <a href="https://registry.opendata.aws/terrain-tiles/" {...ext}>
            Mapzen, AWS Open Data
          </a>
        </span>
      )}
      {overlay === 'steepness' && (
        <span className={styles.item}>
          {t('Bratthet med utløp', 'Steepness with runout')} ©{' '}
          <a href="https://www.nve.no/" {...ext}>
            NVE
          </a>
        </span>
      )}
      {overlay === 'snowdepth' && (
        <span className={styles.item}>
          {t('Snødybde', 'Snow depth')} ©{' '}
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
  const t = useT();
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
        <div
          className={styles.panel}
          role="region"
          aria-label={t('Datakilder for kart', 'Map data sources')}
        >
          <Credits view={view} overlay={overlay} />
        </div>
      )}
      <button
        type="button"
        className={styles.chip}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t('Datakilder for kart', 'Map data sources')}
        title={t('Datakilder for kart', 'Map data sources')}
      >
        ©
      </button>
    </div>
  );
}
