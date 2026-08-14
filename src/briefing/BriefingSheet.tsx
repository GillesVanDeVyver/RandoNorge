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
import { summariseTerrain, runoutLevelLabel } from './terrain';
import { ProfileSvg } from './ProfileSvg';
import { renderStaticMap } from './staticMap';
import { useT } from '../i18n/index.ts';
import { translate } from '../i18n/locale.ts';

// The map canvas is rendered well above its printed size: print renderers
// output at far more than the 96 dpi the CSS pixel implies, and a canvas sized
// for the screen prints visibly soft. 1280x860 backing pixels across ~128 mm of
// paper works out around 250 dpi — sharp enough for contour lines.
const MAP_W = 1280;
const MAP_H = 860;
const MAP_SCALE = 2;

export interface BriefingData {
  routeName: string;
  routeDescription: string | null;
  /** Tour date (YYYY-MM-DD) the forecasts describe. */
  date: string;
  route: Route;
  profile: ProfileData;
  /** Highest danger level along the route, and the regions it crosses. */
  avalancheLevel: number;
  avalancheRegions: AvalancheWarning[];
  avalancheLoading: boolean;
  /** Hourly forecast for the tour date at the chosen anchor point. */
  weatherHours: WeatherHour[];
  weatherLabel: string;
  weatherLoading: boolean;
  /** Elevation of the weather anchor, for the column header. */
  weatherElevationM: number | null;
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

function MapPicture({
  route,
  onReady,
}: {
  route: Route;
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
      steepness: true,
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
  }, [route]);

  return (
    <div className="briefingMapFrame">
      <canvas
        ref={canvasRef}
        className="briefingMapCanvas"
        role="img"
        aria-label={t(
          'Kart over ruta med bratthetslag, nord opp',
          'Route map with steepness overlay, north up',
        )}
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
    avalancheLevel,
    avalancheRegions,
    avalancheLoading,
    weatherHours,
    weatherLabel,
    weatherLoading,
    weatherElevationM,
    onMapReady,
  } = data;

  const terrain = summariseTerrain(profile);
  const stats = profile.stats;
  const badge = DANGER_LEVELS[avalancheLevel];
  // The route can cross several forecast regions; the headline describes the
  // worst one, and any others are named underneath so nothing is hidden.
  const lead = avalancheRegions[0] ?? null;
  const otherRegions = avalancheRegions.slice(1);
  const hours = briefingHours(weatherHours);

  return (
    <div className="briefingSheet">
      <header className="briefingHeader">
        <div>
          <h1 className="briefingTitle">{routeName}</h1>
          <p className="briefingSubtitle">
            {longDate(date)}
            {routeDescription ? ` — ${routeDescription}` : ''}
          </p>
        </div>
        <div className="briefingBrand">
          <div className="briefingBrandName">Fjellrute</div>
          <div className="briefingBrandKind">
            {t('Turbriefing', 'Tour briefing')}
          </div>
        </div>
      </header>

      <section className="briefingTop briefingSection">
        <MapPicture route={route} onReady={onMapReady} />
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
          {terrain && Number.isFinite(terrain.maxSlopeDeg) && (
            <Fact
              label={t('Bratteste parti', 'Steepest section')}
              value={`${Math.round(terrain.maxSlopeDeg)}°`}
            />
          )}
          {terrain && (
            <Fact
              label={t('I skredterreng (≥30°)', 'In avalanche terrain (≥30°)')}
              value={`${Math.round(terrain.steepFraction * 100)} % · ${km(terrain.steepM)}`}
            />
          )}
        </div>
      </section>

      {/* Danger banner — the single most important line on the page, so it
          sits directly under the map with the level's own colour. */}
      <section className="briefingSection">
        <h2 className="briefingH2">
          {t('Snøskredvarsel', 'Avalanche forecast')} · Varsom
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

      {lead && lead.problems.length > 0 && (
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

      <section className="briefingSection">
        <h2 className="briefingH2">
          {t('Høydeprofil og bratthet', 'Elevation profile and steepness')}
        </h2>
        <ProfileSvg profile={profile} />
        {terrain && !terrain.slopeUnknown && (
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
        {terrain && (
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

      <section className="briefingSection">
        <h2 className="briefingH2">
          {t('Vær', 'Weather')} · {weatherLabel}
          {weatherElevationM != null && ` (${metres(weatherElevationM)})`}
        </h2>
        {hours.length > 0 ? (
          <table className="briefingTable">
            <thead>
              <tr>
                <th>{t('Tid', 'Time')}</th>
                <th className="briefingNum">{t('Temp', 'Temp')}</th>
                <th className="briefingNum">{t('Vind', 'Wind')}</th>
                <th className="briefingNum">{t('Kast', 'Gust')}</th>
                <th>{t('Retning', 'From')}</th>
                <th className="briefingNum">{t('Nedbør', 'Precip')}</th>
              </tr>
            </thead>
            <tbody>
              {hours.map((h) => {
                const p = precip(h);
                return (
                  <tr key={h.time}>
                    <td>
                      {new Date(h.time).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="briefingNum">{Math.round(h.temperature)}°</td>
                    <td className="briefingNum">
                      {Math.round(h.windSpeed)} m/s
                    </td>
                    <td className="briefingNum">
                      {h.windGust == null ? '–' : `${Math.round(h.windGust)} m/s`}
                    </td>
                    <td>{compass(h.windFromDeg)}</td>
                    <td className="briefingNum">{p ? `${p} mm` : '–'}</td>
                  </tr>
                );
              })}
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
      </section>

      {/* Deliberate blank space: the briefing is a working document, and the
          decisions that matter (turnaround time, plan B, who carries what)
          are the ones made by the party, not by us. */}
      <section className="briefingNotes briefingSection">
        <h2 className="briefingH2">
          {t(
            'Plan, vendepunkt og notater',
            'Plan, turnaround and notes',
          )}
        </h2>
        <div className="briefingNoteLines" aria-hidden />
      </section>

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
        <p style={{ margin: 0 }}>
          {t('Kart', 'Map')} © Kartverket (CC BY 4.0) ·{' '}
          {t('Bratthet og utløp', 'Steepness and runout')} © NVE ·{' '}
          {t('Snøskredvarsel', 'Avalanche forecast')} © NVE / Varsom (NLOD) ·{' '}
          {t('Vær', 'Weather')} © MET Norway (CC BY 4.0) ·{' '}
          {t('Generert', 'Generated')}{' '}
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
