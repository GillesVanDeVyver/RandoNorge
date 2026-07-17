import { useEffect, useRef } from 'react';
import type { Route } from '../types';
import type { SavedRoute } from '../routes/api';
import type { SavedTrack } from '../tracking/api';
import {
  formatAscent,
  formatDate,
  formatDistance,
  formatDuration,
} from '../routes/format';
import { ArrowLeftIcon, CircleCheckIcon, MountainIcon } from './icons';
import styles from './TrackOverviewPage.module.css';

// Same tile sources and drawing approach as RouteThumbnail, generalised to
// several lines so the planned tour and the recorded track can be compared
// on one north-up map.
const BASE_URL = (z: number, x: number, y: number) =>
  `https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/${z}/${y}/${x}.png`;
const STEEPNESS_URL = (z: number, x: number, y: number) =>
  `https://gis3.nve.no/arcgis/rest/services/wmts/Bratthet_med_utlop_2024/MapServer/tile/${z}/${y}/${x}`;
const STEEPNESS_OPACITY = 0.6;
const STEEPNESS_MAX_ZOOM = 16; // maxNativeZoom of the NVE WMTS cache
const MIN_ZOOM = 3;

// Line styling. The planned tour uses the planner's accent teal
// (DrawingHandler's ROUTE_COLOR); the recorded track uses navigation
// mode's orange (NavigationLayer's TRACK_COLOR), so the overview reads
// like the tour did on the day.
export const PLANNED_COLOR = '#2dd4bf';
export const ACTUAL_COLOR = '#f97316';
const LINE_WEIGHT = 3;
const HALO_WEIGHT = 6;

// Fraction of the map kept clear around the lines on each side.
const PADDING = 0.1;

const TILE_SIZE = 256;

/** One line to render: geometry plus its stroke color. */
type MapLine = { route: Route; color: string };

/** Web Mercator projection to global pixel coordinates at zoom `z`. */
function project(lat: number, lng: number, z: number): [number, number] {
  const scale = TILE_SIZE * 2 ** z;
  const x = ((lng + 180) / 360) * scale;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return [x, y];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // No crossOrigin: we only draw the tiles (never read pixels back), so a
    // tainted canvas is fine and we avoid failing on strict CORS setups.
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Tile failed: ${url}`));
    img.src = url;
  });
}

/**
 * Renders the given lines onto the 2D steepness map (Kartverket topo base +
 * NVE "bratthet med utløp" overlay), fitted to the union of their bounds.
 * Later lines draw on top, so pass the recorded track last. The first point
 * of the last line gets a start dot and its final point a finish dot.
 */
async function draw(
  canvas: HTMLCanvasElement,
  lines: MapLine[],
  cancelled: () => boolean,
) {
  const cssW = canvas.clientWidth || 320;
  const cssH = canvas.clientHeight || 240;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  // Combined bounds in lat/lng.
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const { route } of lines) {
    for (const seg of route) {
      for (const [lat, lng] of seg) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      }
    }
  }
  if (!Number.isFinite(minLat)) return;

  // Pick the highest zoom at which everything (plus padding) fits.
  const availW = cssW * (1 - 2 * PADDING);
  const availH = cssH * (1 - 2 * PADDING);
  let zoom = STEEPNESS_MAX_ZOOM;
  for (; zoom > MIN_ZOOM; zoom--) {
    const [x0, y0] = project(maxLat, minLng, zoom);
    const [x1, y1] = project(minLat, maxLng, zoom);
    if (x1 - x0 <= availW && y1 - y0 <= availH) break;
  }

  // Global-pixel frame of the map, centred on the bounds.
  const [x0, y0] = project(maxLat, minLng, zoom);
  const [x1, y1] = project(minLat, maxLng, zoom);
  const left = (x0 + x1) / 2 - cssW / 2;
  const top = (y0 + y1) / 2 - cssH / 2;

  // Fetch every tile intersecting the frame, for both layers.
  const maxTile = 2 ** zoom - 1;
  const txMin = Math.floor(left / TILE_SIZE);
  const txMax = Math.floor((left + cssW) / TILE_SIZE);
  const tyMin = Math.max(0, Math.floor(top / TILE_SIZE));
  const tyMax = Math.min(maxTile, Math.floor((top + cssH) / TILE_SIZE));

  type Tile = { img: HTMLImageElement; dx: number; dy: number };
  const base: Promise<Tile>[] = [];
  const steep: Promise<Tile>[] = [];
  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) {
      const dx = tx * TILE_SIZE - left;
      const dy = ty * TILE_SIZE - top;
      base.push(
        loadImage(BASE_URL(zoom, tx, ty)).then((img) => ({ img, dx, dy })),
      );
      steep.push(
        loadImage(STEEPNESS_URL(zoom, tx, ty)).then((img) => ({ img, dx, dy })),
      );
    }
  }

  // Missing tiles (e.g. steepness has no coverage outside Norway) just stay
  // blank; everything else still renders.
  const [baseTiles, steepTiles] = await Promise.all([
    Promise.allSettled(base),
    Promise.allSettled(steep),
  ]);
  if (cancelled()) return;

  ctx.fillStyle = '#e8edf2';
  ctx.fillRect(0, 0, cssW, cssH);
  for (const t of baseTiles) {
    if (t.status === 'fulfilled') {
      ctx.drawImage(t.value.img, t.value.dx, t.value.dy, TILE_SIZE, TILE_SIZE);
    }
  }
  ctx.globalAlpha = STEEPNESS_OPACITY;
  for (const t of steepTiles) {
    if (t.status === 'fulfilled') {
      ctx.drawImage(t.value.img, t.value.dx, t.value.dy, TILE_SIZE, TILE_SIZE);
    }
  }
  ctx.globalAlpha = 1;

  // Lines on top: white halo, then the line color. Drawn in order, so the
  // recorded track (passed last) sits above the planned tour.
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const trace = (route: Route) => {
    ctx.beginPath();
    for (const seg of route) {
      seg.forEach(([lat, lng], i) => {
        const [gx, gy] = project(lat, lng, zoom);
        if (i === 0) ctx.moveTo(gx - left, gy - top);
        else ctx.lineTo(gx - left, gy - top);
      });
    }
    ctx.stroke();
  };
  for (const { route, color } of lines) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = HALO_WEIGHT;
    trace(route);
    ctx.strokeStyle = color;
    ctx.lineWidth = LINE_WEIGHT;
    trace(route);
  }

  // Start / finish dots for the last line (the recorded track).
  const last = lines[lines.length - 1];
  const points = last?.route.flat() ?? [];
  if (points.length >= 2) {
    const dot = (
      [lat, lng]: [number, number],
      fill: string,
      stroke: string,
    ) => {
      const [gx, gy] = project(lat, lng, zoom);
      ctx.beginPath();
      ctx.arc(gx - left, gy - top, 5, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    };
    dot(points[0], '#ffffff', last.color); // start: hollow
    dot(points[points.length - 1], last.color, '#ffffff'); // finish: solid
  }
}

/**
 * North-up map comparing the planned tour and the recorded track, fitted to
 * both. Redraws when the panel resizes so the map stays sharp.
 */
function ComparisonMap({ lines }: { lines: MapLine[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || lines.length === 0) return;
    let cancelled = false;
    let frame = 0;
    const render = () => {
      void draw(canvas, lines, () => cancelled).catch(() => {
        // Network hiccup: the placeholder background simply stays.
      });
    };
    render();
    // Redraw on panel resizes (debounced to the next frame) so a window
    // resize doesn't leave a stretched, blurry bitmap behind.
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(render);
    });
    observer.observe(canvas);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [lines]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.map}
      role="img"
      aria-label="Planned and recorded tour on steepness map, north up"
    />
  );
}

type Props = {
  /** The completed tour (recorded track) being reviewed. */
  track: SavedTrack;
  /** The planned route it navigated, if it still exists in the library. */
  planned: SavedRoute | null;
  /** Back to the completed-routes list. */
  onBack: () => void;
};

/** True when the geometry has at least two drawable points. */
function drawable(route: Route): boolean {
  return route.reduce((n, seg) => n + seg.length, 0) >= 2;
}

/**
 * Full-page overview of one completed tour, reached from the completed
 * list. Shows the planned tour and the actually recorded track together on
 * a north-up steepness map, with the key stats of both side by side. Same
 * photo backdrop + glass panel language as the other account pages.
 */
export function TrackOverviewPage({ track, planned, onBack }: Props) {
  const hasTrack = drawable(track.track);
  const hasPlanned = planned !== null && drawable(planned.route);
  const lines: MapLine[] = [
    // Planned first so the recorded track draws on top.
    ...(hasPlanned ? [{ route: planned.route, color: PLANNED_COLOR }] : []),
    ...(hasTrack ? [{ route: track.track, color: ACTUAL_COLOR }] : []),
  ];

  const durationMs = track.durationS !== null ? track.durationS * 1000 : null;

  return (
    <div className={styles.page}>
      <div className={styles.scrim} aria-hidden="true" />

      <header className={styles.topBar}>
        <button type="button" className={styles.backBtn} onClick={onBack}>
          <ArrowLeftIcon />
          Completed routes
        </button>
        <span className={styles.brand}>
          <span className={styles.brandIcon}>
            <MountainIcon />
          </span>
          <span className={styles.brandName}>Fjellrute</span>
        </span>
      </header>

      <main className={styles.content}>
        <div className={styles.panel}>
          <header className={styles.panelHeader}>
            <span className={styles.panelIcon}>
              <CircleCheckIcon />
            </span>
            <div className={styles.panelHeading}>
              <h1 className={styles.title}>{track.name}</h1>
              <p className={styles.intro}>
                Completed <span className="tnum">{formatDate(track.finishedAt)}</span>
                {durationMs !== null && (
                  <>
                    {' '}
                    · <span className="tnum">{formatDuration(durationMs)}</span>{' '}
                    moving time
                  </>
                )}
              </p>
            </div>
          </header>

          {lines.length > 0 ? (
            <>
              <ComparisonMap lines={lines} />
              <div className={styles.legend}>
                {hasPlanned && (
                  <span className={styles.legendItem}>
                    <span
                      className={styles.legendSwatch}
                      style={{ background: PLANNED_COLOR }}
                      aria-hidden="true"
                    />
                    Planned tour
                  </span>
                )}
                {hasTrack && (
                  <span className={styles.legendItem}>
                    <span
                      className={styles.legendSwatch}
                      style={{ background: ACTUAL_COLOR }}
                      aria-hidden="true"
                    />
                    Actual tour
                  </span>
                )}
              </div>
            </>
          ) : (
            <p className={styles.mapNote}>
              This tour has no drawable geometry, so the map can't be shown.
            </p>
          )}

          {!hasPlanned && (
            <p className={styles.plannedNote}>
              {track.routeId
                ? 'The planned tour is no longer in your route library, so only the recorded track is shown.'
                : 'This tour was recorded without a planned route.'}
            </p>
          )}

          <div className={styles.statsGrid}>
            {hasPlanned && (
              <section className={styles.statsCol}>
                <h2 className={styles.statsTitle}>
                  <span
                    className={styles.legendSwatch}
                    style={{ background: PLANNED_COLOR }}
                    aria-hidden="true"
                  />
                  Planned
                </h2>
                <dl className={styles.statsList}>
                  <div className={styles.stat}>
                    <dt>Distance</dt>
                    <dd className="tnum">{formatDistance(planned.distanceM)}</dd>
                  </div>
                  <div className={styles.stat}>
                    <dt>Ascent</dt>
                    <dd className="tnum">{formatAscent(planned.ascentM)}</dd>
                  </div>
                  <div className={styles.stat}>
                    <dt>Descent</dt>
                    <dd className="tnum">{formatAscent(planned.descentM)}</dd>
                  </div>
                </dl>
              </section>
            )}
            <section className={styles.statsCol}>
              <h2 className={styles.statsTitle}>
                <span
                  className={styles.legendSwatch}
                  style={{ background: ACTUAL_COLOR }}
                  aria-hidden="true"
                />
                Actual
              </h2>
              <dl className={styles.statsList}>
                <div className={styles.stat}>
                  <dt>Distance</dt>
                  <dd className="tnum">{formatDistance(track.distanceM)}</dd>
                </div>
                <div className={styles.stat}>
                  <dt>Ascent</dt>
                  <dd className="tnum">{formatAscent(track.ascentM)}</dd>
                </div>
                <div className={styles.stat}>
                  <dt>Descent</dt>
                  <dd className="tnum">{formatAscent(track.descentM)}</dd>
                </div>
                <div className={styles.stat}>
                  <dt>Duration</dt>
                  <dd className="tnum">{formatDuration(durationMs)}</dd>
                </div>
              </dl>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
