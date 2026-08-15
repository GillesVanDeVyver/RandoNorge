// The printable tour briefing: one A4 page a guide can hand a client or pin
// up on a skredkurs.
//
// Everything on it is already in the planner — this is a re-presentation, not
// a new data source. What changes is the framing: the screen is exploratory
// (hover, switch days, expand a problem), whereas paper has to answer "what
// are we doing, how exposed is it, and what is the snowpack doing today?" in
// one glance, with no interaction available.
//
// The page is intentionally NOT a dump of every panel. Anything a person can't
// act on in the field is left off to keep it to a single sheet.

import { useEffect, useRef } from 'react';
import type { ProfileData } from '../elevation/profile';
import type { Route } from '../types';
import type { AvalancheWarning } from '../avalanche/api';
import type { WeatherHour } from '../weather/api';
import { DANGER_LEVELS, dangerLevelLabel } from '../avalanche/dangerScale';
import {
  DIRS,
  aspectList,
  elevationText,
  roseSectorPath,
} from '../avalanche/problemText';
import type { SnowData } from '../snow/useSnow';
import { summariseTerrain, runoutLevelLabel } from './terrain';
import { ProfileSvg } from './ProfileSvg';
import { SnowSvg } from './SnowSvg';
import { summariseSnow } from './snowSummary';
import { renderStaticMap } from './staticMap';
import type { BriefingOptions } from './options';
import { useT } from '../i18n/index.ts';
import { translate } from '../i18n/locale.ts';

// The map canvas is rendered well above its printed size: print renderers
// output at far more than the 96 dpi the CSS pixel implies, and a canvas sized
// for the screen prints visibly soft. 1280x860 backing pixels across ~128 mm of
// paper works out around 250 dpi — sharp enough for contour lines.
const MAP_W = 1280;
const MAP_H = 860;
const MAP_SCALE = 2;

/** One end of the route as a weather anchor: the forecast, plus the elevation
 *  it applies to (a summit reading means little without its height). */
export interface BriefingAnchor {
  elevationM: number | null;
  hours: WeatherHour[];
}

export interface BriefingData {
  routeName: string;
  routeDescription: string | null;
  /** Tour date (YYYY-MM-DD) the forecasts describe. */
  date: string;
  route: Route;
  profile: ProfileData;
  /** Which sections to print. Only the route's own facts are not optional. */
  options: BriefingOptions;
  /** Highest danger level along the route, and the regions it crosses. */
  avalancheLevel: number;
  avalancheRegions: AvalancheWarning[];
  avalancheLoading: boolean;
  /** Epoch ms the bulletin was fetched from Varsom, or null when nothing was
   *  retrieved. Printed instead of the tour date: bulletins are rewritten
   *  during the day, and a saved route replays whatever was captured. */
  avalancheFetchedAt: number | null;
  /** Forecast at both ends of the route, printed side by side: the difference
   *  between valley and summit is usually the decision-relevant part. */
  weatherLow: BriefingAnchor;
  weatherHigh: BriefingAnchor;
  weatherLoading: boolean;
  /** seNorge depths along the route, and the date they actually describe. */
  snow: SnowData | null;
  snowLoading: boolean;
  snowDate: string;
  /** True when snowDate had to fall back off the tour date because seNorge
   *  models the past, not the future. Printed so nobody reads a stale depth
   *  as a forecast. */
  snowIsFallback: boolean;
  /** Fired once the map canvas has finished drawing (or has given up on the
   *  tiles). The dialog holds Print until then: printing while tiles are still
   *  arriving would put a half-drawn map on the paper. */
  onMapReady?: () => void;
}

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_NO = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
const DOW_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DOW_NO = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];

function longDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const dow = new Date(y, m - 1, d).getDay();
  return translate(
    `${DOW_NO[dow]} ${d}. ${MONTHS_NO[m - 1]} ${y}`,
    `${DOW_EN[dow]} ${d} ${MONTHS_EN[m - 1]} ${y}`,
  );
}

/** When a forecast was fetched, worded as the panels on screen word it, so a
 *  printed sheet and the app never disagree about how old the data is. */
function retrievedAt(ms: number): string {
  return new Date(ms).toLocaleString(translate('nb-NO', 'en-GB'), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function km(m: number): string {
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

function metres(m: number): string {
  return `${Math.round(m).toLocaleString(translate('nb-NO', 'en-GB'))} m`;
}

/** Compass point for a wind direction in degrees. */
function compass(deg: number): string {
  const i = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return translate(
    ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'][i],
    ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][i],
  );
}

/** Precipitation for an hour, or null when nothing is forecast. Mirrors the
 *  weather panel's rule so the sheet and the screen agree. */
function precip(h: WeatherHour): string | null {
  const lo = h.precipMinMm;
  const hi = h.precipMaxMm;
  const mid = h.precipMm;
  if (
    (lo == null || lo === 0) &&
    (hi == null || hi === 0) &&
    (mid == null || mid === 0)
  ) {
    return null;
  }
  if (typeof lo === 'number' && typeof hi === 'number' && hi !== lo) {
    return `${lo.toFixed(lo < 1 ? 1 : 0)}–${hi.toFixed(hi < 10 ? 1 : 0)}`;
  }
  if (typeof mid === 'number') return mid.toFixed(mid < 10 ? 1 : 0);
  return null;
}

/** Daylight-hours slice of the forecast, every three hours. A tour briefing
 *  does not need 03:00. */
function briefingHours(hours: WeatherHour[]): WeatherHour[] {
  return hours.filter((h) => {
    const hour = new Date(h.time).getHours();
    return hour >= 6 && hour <= 21 && hour % 3 === 0;
  });
}

interface WeatherRow {
  time: string;
  low: WeatherHour | null;
  high: WeatherHour | null;
}

/** One row per hour with the valley and summit readings side by side. Merged
 *  on the timestamp rather than by position, so a gap in one anchor's series
 *  can't silently shift the other's numbers up a row. */
function weatherRows(
  low: BriefingAnchor,
  high: BriefingAnchor,
): WeatherRow[] {
  const byTime = new Map<string, WeatherRow>();
  for (const h of briefingHours(low.hours)) {
    byTime.set(h.time, { time: h.time, low: h, high: null });
  }
  for (const h of briefingHours(high.hours)) {
    const row = byTime.get(h.time);
    if (row) row.high = h;
    else byTime.set(h.time, { time: h.time, low: null, high: h });
  }
  return [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
}

/** Wind as one cell: direction, speed, and the gust in parentheses. Three
 *  separate columns per anchor would not fit twice across the page, and the
 *  gust is only ever read next to the mean anyway. */
function windCell(h: WeatherHour | null): string {
  if (!h) return '–';
  const gust = h.windGust == null ? '' : ` (${Math.round(h.windGust)})`;
  return `${compass(h.windFromDeg)} ${Math.round(h.windSpeed)}${gust}`;
}

function tempCell(h: WeatherHour | null): string {
  return h ? `${Math.round(h.temperature)}°` : '–';
}

function precipCell(h: WeatherHour | null): string {
  const p = h ? precip(h) : null;
  return p ?? '–';
}

function MapPicture({
  route,
  steepness,
  onReady,
}: {
  route: Route;
  /** Paint NVE's steepness/runout layer over the topo tiles. Follows the
   *  steepness switch, so a briefing without slope angles gets a clean map. */
  steepness: boolean;
  onReady?: () => void;
}) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Held in a ref so a caller passing a fresh closure each render can't
  // restart the (network-bound) tile fetch. Synced in its own effect, which
  // runs before the render effect below.
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    void renderStaticMap(canvas, {
      route,
      width: MAP_W,
      height: MAP_H,
      scale: MAP_SCALE,
      padding: 0.1,
      steepness,
      routeWeight: 9,
      haloWeight: 17,
      endpoints: true,
      scaleBar: true,
      cancelled: () => cancelled,
    })
      .catch(() => {
        // Tiles unavailable (offline, no coverage): the neutral backdrop and
        // the traced route still print, which beats an empty frame. Still
        // "ready" — waiting longer would not produce a better page.
      })
      .finally(() => {
        if (!cancelled) onReadyRef.current?.();
      });
    return () => {
      cancelled = true;
    };
  }, [route, steepness]);

  return (
    <div className="briefingMapFrame">
      <canvas
        ref={canvasRef}
        className="briefingMapCanvas"
        role="img"
        aria-label={
          steepness
            ? t(
                'Kart over ruta med bratthetslag, nord opp',
                'Route map with steepness overlay, north up',
              )
            : t('Kart over ruta, nord opp', 'Route map, north up')
        }
      />
      <div className="briefingNorth" aria-hidden>
        ↑N
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="briefingFact">
      <span className="briefingFactLabel">{label}</span>
      <span className="briefingFactValue">{value}</span>
    </div>
  );
}

function PrintRose({ expositions }: { expositions: string }) {
  return (
    <svg viewBox="0 0 26 26" width="26" height="26" className="briefingRose" aria-hidden>
      {DIRS.map((_, i) => (
        <path
          key={i}
          d={roseSectorPath(i, 13, 11)}
          className={
            expositions[i] === '1' ? 'briefingRoseOn' : 'briefingRoseOff'
          }
        />
      ))}
      <circle cx={13} cy={13} r={11} className="briefingRoseRing" fill="none" />
    </svg>
  );
}

export function BriefingSheet({ data }: { data: BriefingData }) {
  const t = useT();
  const {
    routeName,
    routeDescription,
    date,
    route,
    profile,
    options,
    avalancheLevel,
    avalancheRegions,
    avalancheLoading,
    avalancheFetchedAt,
    weatherLow,
    weatherHigh,
    weatherLoading,
    snow,
    snowLoading,
    snowDate,
    snowIsFallback,
    onMapReady,
  } = data;

  const terrain = summariseTerrain(profile);
  const stats = profile.stats;
  const badge = DANGER_LEVELS[avalancheLevel];
  // The route can cross several forecast regions; the headline describes the
  // worst one, and any others are named underneath so nothing is hidden.
  const lead = avalancheRegions[0] ?? null;
  const otherRegions = avalancheRegions.slice(1);
  const rows = options.weather ? weatherRows(weatherLow, weatherHigh) : [];
  const showLow = rows.some((r) => r.low);
  const showHigh = rows.some((r) => r.high);
  const snowSummary = options.snow ? summariseSnow(profile, snow) : null;
  // Credit only the sources that actually contributed to this print: a footer
  // citing Varsom on a sheet with no avalanche section is a small lie.
  const credits = [
    // Kartverket is credited on every sheet, with or without the map: the
    // ascent and the high point in the facts panel are its elevations, and
    // those print whatever else is switched off.
    `${options.map ? t('Kart og høyder', 'Map and elevations') : t('Høyder', 'Elevations')} © Kartverket (CC BY 4.0)`,
    options.steepness
      ? `${t('Bratthet og utløp', 'Steepness and runout')} © NVE`
      : null,
    options.avalanche
      ? `${t('Snøskredvarsel', 'Avalanche forecast')} © NVE / Varsom (NLOD)`
      : null,
    options.snow ? `${t('Snødybde', 'Snow depth')} © NVE / seNorge` : null,
    options.weather ? `${t('Vær', 'Weather')} © MET Norway (CC BY 4.0)` : null,
  ].filter(Boolean);

  return (
    <div className="briefingSheet">
      {/* The day is not stated once at the top: each forecast carries the date
          it actually describes, which is the only place the reader can act on
          it and the only way a weather day and a bulletin's retrieval time can
          honestly differ. */}
      <header className="briefingHeader">
        <div>
          <h1 className="briefingTitle">{routeName}</h1>
          {routeDescription && (
            <p className="briefingSubtitle">{routeDescription}</p>
          )}
        </div>
        <div className="briefingBrand">
          <div className="briefingBrandName">Fjellrute</div>
        </div>
      </header>

      {/* The route's own numbers are not a section: they are what makes the
          sheet this tour. With the map switched off they widen into a row
          rather than leaving a column-shaped hole where it was. */}
      <section
        className={`briefingTop briefingSection ${options.map ? '' : 'briefingTopNoMap'}`}
      >
        {options.map && (
          <MapPicture
            route={route}
            steepness={options.steepness}
            onReady={onMapReady}
          />
        )}
        <div className="briefingFacts">
          <Fact label={t('Lengde', 'Distance')} value={km(stats.distance)} />
          <Fact label={t('Stigning', 'Ascent')} value={metres(stats.ascent)} />
          <Fact label={t('Fall', 'Descent')} value={metres(stats.descent)} />
          <Fact
            label={t('Høyeste punkt', 'High point')}
            value={metres(stats.maxElevation)}
          />
          <Fact
            label={t('Laveste punkt', 'Low point')}
            value={metres(stats.minElevation)}
          />
          {options.steepness && terrain && Number.isFinite(terrain.maxSlopeDeg) && (
            <Fact
              label={t('Bratteste parti', 'Steepest section')}
              value={`${Math.round(terrain.maxSlopeDeg)}°`}
            />
          )}
          {options.steepness && terrain && (
            <Fact
              label={t('I skredterreng (≥30°)', 'In avalanche terrain (≥30°)')}
              value={`${Math.round(terrain.steepFraction * 100)} % · ${km(terrain.steepM)}`}
            />
          )}
          {options.snow && snowSummary && (
            <Fact
              label={t('Snødybde', 'Snow depth')}
              value={`${Math.round(snowSummary.minCm)}–${Math.round(snowSummary.maxCm)} cm`}
            />
          )}
        </div>
      </section>

      {/* Danger banner — the single most important line on the page, so it
          sits directly under the map with the level's own colour. */}
      {options.avalanche && (
      <section className="briefingSection">
        {/* Retrieval time, not the tour date: a bulletin is rewritten during
            the day, and a sheet printed from a saved route can be replaying
            one that was fetched a week ago. */}
        <h2 className="briefingH2">
          {t('Snøskredvarsel', 'Avalanche forecast')} · Varsom
          {avalancheFetchedAt != null &&
            Number.isFinite(avalancheFetchedAt) &&
            ` · ${t('hentet', 'retrieved')} ${retrievedAt(avalancheFetchedAt)}`}
        </h2>
        <div className="briefingDanger">
          <div
            className="briefingDangerBadge"
            style={
              badge ? { background: badge.color, color: badge.onColor } : undefined
            }
          >
            <span className="briefingDangerNum">
              {avalancheLevel > 0 ? avalancheLevel : '?'}
            </span>
            <span className="briefingDangerOf">
              {avalancheLevel > 0 ? t('av 5', 'of 5') : t('ikke vurdert', 'not rated')}
            </span>
          </div>
          <div className="briefingDangerBody">
            <div className="briefingDangerLabel">
              {dangerLevelLabel(avalancheLevel)}
            </div>
            <div className="briefingDangerRegion">
              {lead
                ? lead.regionName
                : avalancheLoading
                  ? t('Henter varsel …', 'Loading forecast…')
                  : t(
                      'Ingen vurdert skredregion langs ruta',
                      'No assessed avalanche region along the route',
                    )}
              {otherRegions.length > 0 &&
                ` · ${t('også', 'also')} ${otherRegions
                  .map((r) => `${r.regionName} (${r.dangerLevel})`)
                  .join(', ')}`}
            </div>
            {lead?.mainText && (
              <p className="briefingDangerText">{lead.mainText}</p>
            )}
          </div>
        </div>
      </section>
      )}

      {options.avalanche && lead && lead.problems.length > 0 && (
        <section className="briefingSection">
          <h2 className="briefingH2">
            {t('Skredproblemer', 'Avalanche problems')}
          </h2>
          <div className="briefingProblems">
            {lead.problems.slice(0, 4).map((p, i) => {
              const aspects = aspectList(p.expositions);
              const height = elevationText(p);
              return (
                <div className="briefingProblem" key={i}>
                  <PrintRose expositions={p.expositions} />
                  <div className="briefingProblemBody">
                    <div className="briefingProblemName">{p.typeName}</div>
                    <div className="briefingProblemMeta">
                      {[
                        aspects.length > 0
                          ? `${t('Himmelretning', 'Aspects')}: ${aspects.join(', ')}`
                          : null,
                        height,
                        p.size ? `${t('Størrelse', 'Size')} ${p.size}` : null,
                        p.sensitivity || null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Steepness is a way of drawing the profile rather than a section of
          its own: with it on, the line is coloured by slope angle and carries
          the band breakdown and runout exposure; with it off, the same line is
          drawn plain. */}
      {options.elevation && (
      <section className="briefingSection">
        <h2 className="briefingH2">
          {options.steepness
            ? t('Høydeprofil og bratthet', 'Elevation profile and steepness')
            : t('Høydeprofil', 'Elevation profile')}
        </h2>
        <ProfileSvg
          profile={profile}
          steepness={options.steepness}
          runout={options.steepness}
        />
        {options.steepness && terrain && !terrain.slopeUnknown && (
          <>
            <div className="briefingBands" aria-hidden>
              {terrain.bands.map((b) =>
                b.fraction > 0 ? (
                  <div
                    key={b.label}
                    className="briefingBandFill"
                    style={{
                      width: `${b.fraction * 100}%`,
                      background: b.color,
                    }}
                  />
                ) : null,
              )}
            </div>
            <div className="briefingBandKeys">
              {terrain.bands
                .filter((b) => b.fraction > 0.005)
                .map((b) => (
                  <span className="briefingBandKey" key={b.label}>
                    <span
                      className="briefingSwatch"
                      style={{ background: b.color }}
                    />
                    {b.label}
                    <span className="briefingBandVal">
                      {Math.round(b.fraction * 100)} %
                    </span>
                  </span>
                ))}
            </div>
          </>
        )}
        {options.steepness && terrain && (
          <p className="briefingTerrainNote">
            {terrain.runout.metres > 0 ? (
              <>
                <span className="briefingWarn">
                  {t('Utløpssoner', 'Runout zones')}:
                </span>{' '}
                {t(
                  `${km(terrain.runout.metres)} av ruta (${Math.round(terrain.runout.fraction * 100)} %) ligger i modellert utløpssone, verste grad: ${runoutLevelLabel(terrain.runout.worstLevel)}.`,
                  `${km(terrain.runout.metres)} of the route (${Math.round(terrain.runout.fraction * 100)} %) lies inside a modeled runout zone, worst class: ${runoutLevelLabel(terrain.runout.worstLevel)}.`,
                )}
              </>
            ) : (
              t(
                'Ingen del av ruta ligger i en modellert utløpssone.',
                'No part of the route lies inside a modeled runout zone.',
              )
            )}
            {terrain.runout.incomplete &&
              ' ' +
                t(
                  'Utløpsdata manglet for deler av ruta — tallet er et minimum.',
                  'Runout data was missing for part of the route — treat this as a minimum.',
                )}
          </p>
        )}
      </section>
      )}

      {options.snow && (
        <section className="briefingSection">
          <h2 className="briefingH2">
            {t('Snødybde', 'Snow depth')} · seNorge · {longDate(snowDate)}
          </h2>
          {snowSummary ? (
            <>
              <SnowSvg profile={profile} snow={snow} />
              <p className="briefingTerrainNote">
                {t(
                  `Modellert snødybde ${Math.round(snowSummary.minCm)}–${Math.round(snowSummary.maxCm)} cm langs ruta, i snitt ${Math.round(snowSummary.meanCm)} cm.`,
                  `Modeled snow depth ${Math.round(snowSummary.minCm)}–${Math.round(snowSummary.maxCm)} cm along the route, averaging ${Math.round(snowSummary.meanCm)} cm.`,
                )}
                {snowSummary.atLowCm != null &&
                  snowSummary.atHighCm != null &&
                  ' ' +
                    t(
                      `Ved laveste punkt ${Math.round(snowSummary.atLowCm)} cm, ved høyeste ${Math.round(snowSummary.atHighCm)} cm.`,
                      `${Math.round(snowSummary.atLowCm)} cm at the low point, ${Math.round(snowSummary.atHighCm)} cm at the high point.`,
                    )}
                {snowSummary.coverage < 0.98 &&
                  ' ' +
                    t(
                      'Rutenettet manglet verdier for deler av ruta.',
                      'The grid had no value for part of the route.',
                    )}{' '}
                {snowIsFallback
                  ? t(
                      `seNorge modellerer snø som har falt, ikke snø som skal komme, så tallene er fra ${longDate(snowDate)} og ikke fra turdagen.`,
                      `seNorge models snow that has fallen, not snow to come, so these figures are from ${longDate(snowDate)} rather than the tour date.`,
                    )
                  : t(
                      'Tallene er modellerte, ikke målte — behandle dem som et utgangspunkt.',
                      'These are modeled, not measured — treat them as a starting point.',
                    )}
              </p>
            </>
          ) : (
            <p className="briefingEmpty">
              {snowLoading
                ? t('Henter snødybde …', 'Loading snow depth…')
                : t(
                    'Ingen modellert snødybde for denne ruta og datoen.',
                    'No modeled snow depth for this route and date.',
                  )}
            </p>
          )}
        </section>
      )}

      {options.weather && (
        <section className="briefingSection">
          <h2 className="briefingH2">
            {t('Vær', 'Weather')} · MET · {longDate(date)}
          </h2>
          {rows.length > 0 ? (
            <table className="briefingTable briefingWeatherTable">
              <thead>
                {/* Two header rows: the anchors span their three columns, so
                    the valley and summit readings can be compared down the
                    page at a glance instead of on two separate tables. */}
                <tr>
                  <th rowSpan={2}>{t('Tid', 'Time')}</th>
                  {showLow && (
                    <th colSpan={3} className="briefingGroupHead">
                      {t('Laveste punkt', 'Low point')}
                      {weatherLow.elevationM != null &&
                        ` · ${metres(weatherLow.elevationM)}`}
                    </th>
                  )}
                  {showHigh && (
                    <th colSpan={3} className="briefingGroupHead">
                      {t('Høyeste punkt', 'High point')}
                      {weatherHigh.elevationM != null &&
                        ` · ${metres(weatherHigh.elevationM)}`}
                    </th>
                  )}
                </tr>
                <tr>
                  {showLow && (
                    <>
                      <th className="briefingNum briefingGroupStart">°C</th>
                      <th className="briefingNum">
                        {t('Vind m/s', 'Wind m/s')}
                      </th>
                      <th className="briefingNum">mm</th>
                    </>
                  )}
                  {showHigh && (
                    <>
                      <th className="briefingNum briefingGroupStart">°C</th>
                      <th className="briefingNum">
                        {t('Vind m/s', 'Wind m/s')}
                      </th>
                      <th className="briefingNum">mm</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.time}>
                    <td>
                      {new Date(r.time).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    {showLow && (
                      <>
                        <td className="briefingNum briefingGroupStart">
                          {tempCell(r.low)}
                        </td>
                        <td className="briefingNum">{windCell(r.low)}</td>
                        <td className="briefingNum">{precipCell(r.low)}</td>
                      </>
                    )}
                    {showHigh && (
                      <>
                        <td className="briefingNum briefingGroupStart">
                          {tempCell(r.high)}
                        </td>
                        <td className="briefingNum">{windCell(r.high)}</td>
                        <td className="briefingNum">{precipCell(r.high)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="briefingEmpty">
              {weatherLoading
                ? t('Henter værvarsel …', 'Loading forecast…')
                : t(
                    'Ingen værvarsel for denne dagen. MET varsler omtrent ti døgn fram i tid.',
                    'No forecast for this day. MET forecasts roughly ten days ahead.',
                  )}
            </p>
          )}
          {rows.length > 0 && (
            <p className="briefingTerrainNote">
              {t(
                'Vind oppgitt som retning, middelvind og kast i parentes.',
                'Wind given as direction, mean speed, and gust in parentheses.',
              )}
            </p>
          )}
        </section>
      )}

      {/* Deliberate blank space: the briefing is a working document, and the
          decisions that matter (turnaround time, plan B, who carries what)
          are the ones made by the party, not by us. */}
      {options.notes && (
        <section className="briefingNotes briefingSection">
          <h2 className="briefingH2">
            {t('Plan, vendepunkt og notater', 'Plan, turnaround and notes')}
          </h2>
          <div className="briefingNoteLines" aria-hidden />
        </section>
      )}

      <footer className="briefingFooter">
        <p style={{ margin: '0 0 1mm' }}>
          <span className="briefingWarn">
            {t(
              'Sjekk alltid det nyeste varselet på varsom.no før du drar ut.',
              'Always check the latest bulletin on varsom.no before heading out.',
            )}
          </span>{' '}
          {t(
            'Dette arket er et planleggingsverktøy, ikke en garanti for trygge forhold. Terrengvurdering i felt går alltid foran.',
            'This sheet is a planning aid, not a guarantee of safe conditions. Assessment in the field always takes precedence.',
          )}
        </p>
        {/* Only credit what actually made it onto the page: an attribution for
            a source the reader cannot see is noise, and in the licences' own
            terms there is nothing to attribute. */}
        <p style={{ margin: 0 }}>
          {credits.join(' · ')} · {t('Generert', 'Generated')}{' '}
          {new Date().toLocaleString([], {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}{' '}
          · fjellrute.no
        </p>
      </footer>
    </div>
  );
}
