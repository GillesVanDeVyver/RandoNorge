// "Parking" summary tab: the nearest places NVDB knows about to leave the car,
// measured from where the route starts.
//
// Two things this panel is careful about, both from docs/parking-data-sources.md:
//
//  1. An empty result is reported as a gap in NVDB's coverage, not as "there is
//     nowhere to park". NVDB only describes the road network Statens vegvesen
//     administers or has registered, so the gravel lot at the end of a private
//     forest road — the classic Norwegian trailhead — is frequently absent. A
//     planner that says "no parking found" flatly would be lying to the user
//     about the ground.
//
//  2. Attributes are shown only where the register actually carries them.
//     Coverage of fee, capacity and winter maintenance is patchy, and an
//     invented "free" is worse than a visible "—".
import { useMemo, useState } from 'react';
import type { LatLng, Route } from '../types';
import { routeEnds } from '../geometry';
import {
  PARKING_DEFAULT_RADIUS_M,
  PARKING_LIMIT,
  PARKING_MAX_RADIUS_M,
  PARKING_MIN_RADIUS_M,
  useParking,
} from '../parking/useParking';
import type { ParkingArea } from '../parking/api';
import { recallParkingRadius, rememberParkingRadius } from '../parking/radius';
import { setHoverPoint } from '../hoverStore';
import { PARKING_PIN_COLOR } from '../parking/pin';
import {
  formatParkingDistance,
  formatParkingRadius,
} from '../parking/format';
import { SourceAttribution, NLOD } from './SourceAttribution';
import { useT, type Translate } from '../i18n/index.ts';
import styles from './ParkingPanel.module.css';

interface Props {
  route: Route;
}

// One attribute chip, rendered only when the register carries a value.
function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <span className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      <span className={styles.factValue}>{value}</span>
    </span>
  );
}

function ParkingRow({
  area,
  index,
  t,
}: {
  area: ParkingArea;
  index: number;
  t: Translate;
}) {
  // Hovering a row lights the matching point on the map, reusing the same
  // hover store the elevation chart drives. Cheaper than a bespoke highlight
  // and it already behaves correctly across the 2D/3D switch.
  return (
    <li
      className={styles.row}
      onMouseEnter={() => setHoverPoint(area.point, PARKING_PIN_COLOR)}
      onMouseLeave={() => setHoverPoint(null)}
    >
      <span className={styles.pin} aria-hidden>
        {index + 1}
      </span>
      <div className={styles.body}>
        <div className={styles.head}>
          <span className={styles.name}>
            {area.name ?? t('Parkeringsområde', 'Parking area')}
          </span>
          <span className={styles.distance}>
            {formatParkingDistance(area.distanceM, t)}
          </span>
        </div>
        <div className={styles.facts}>
          <Fact
            label={t('Plasser', 'Spaces')}
            value={area.capacity !== null ? String(area.capacity) : null}
          />
          <Fact label={t('Avgift', 'Fee')} value={area.fee} />
          <Fact label={t('Vinter', 'Winter')} value={area.winter} />
          <Fact label={t('Dekke', 'Surface')} value={area.surface} />
          <Fact label={t('Eier', 'Owner')} value={area.owner} />
          <Fact label={t('Bruk', 'Use')} value={area.usage} />
        </div>
        {/* Getting there is the whole point of knowing it exists. */}
        <a
          className={styles.directions}
          href={`https://www.google.com/maps/dir/?api=1&destination=${area.point[0]},${area.point[1]}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('Veibeskrivelse →', 'Directions →')}
        </a>
      </div>
    </li>
  );
}

export function ParkingPanel({ route }: Props) {
  const t = useT();
  // Survives the panel being unmounted and back — clearing the route and
  // drawing another one in the same valley should not put the search back to
  // 2 km — and is what the briefing reads to print the radius the guide is
  // actually looking at. See parking/radius.ts.
  const [radiusM, setRadiusM] = useState(
    () => recallParkingRadius() ?? PARKING_DEFAULT_RADIUS_M,
  );

  // Measured from the start of the tour, which is where the car goes. On an
  // out-and-back that is also where it comes back to; on a point-to-point it
  // is the half of the problem the driver solves first.
  const ends = useMemo(() => routeEnds(route), [route]);
  const origin: LatLng | null = ends?.start ?? null;

  const { areas, loading, error, fetchedAt } = useParking(
    origin,
    radiusM,
    PARKING_LIMIT,
  );

  const control = (
    <div className={styles.controls}>
      <label className={styles.radiusField} htmlFor="parking-radius">
        <span className={styles.radiusLabel}>
          {t('Søkeradius fra start', 'Search radius from start')}
        </span>
        <span className={styles.radiusValue}>{formatParkingRadius(radiusM)}</span>
      </label>
      <input
        id="parking-radius"
        className={styles.slider}
        type="range"
        min={PARKING_MIN_RADIUS_M}
        max={PARKING_MAX_RADIUS_M}
        step={500}
        value={radiusM}
        onChange={(e) => {
          const next = Number(e.target.value);
          setRadiusM(next);
          rememberParkingRadius(next);
        }}
      />
    </div>
  );

  let content: React.ReactNode;
  if (!origin) {
    content = (
      <p className={styles.status}>
        {t(
          'Tegn en rute for å se parkering nær startpunktet.',
          'Draw a route to see parking near its start point.',
        )}
      </p>
    );
  } else if (loading && areas.length === 0) {
    content = (
      <p className={styles.status}>
        {t('Laster parkering …', 'Loading parking…')}
      </p>
    );
  } else if (error) {
    content = (
      <p className={styles.status}>
        {t('Parkeringsdata utilgjengelig', 'Parking data unavailable')}
      </p>
    );
  } else if (areas.length === 0) {
    // Deliberately worded as a limit of the register rather than of the world.
    content = (
      <div className={styles.empty}>
        <p className={styles.emptyLead}>
          {t(
            `Ingen registrerte parkeringsområder innenfor ${formatParkingRadius(radiusM)}.`,
            `No registered parking areas within ${formatParkingRadius(radiusM)}.`,
          )}
        </p>
        <p className={styles.emptyNote}>
          {t(
            'NVDB dekker bare vegnettet Statens vegvesen har registrert. Utfartsparkering langs private veier og skogsbilveier mangler ofte — at det ikke står noe her betyr ikke at det ikke finnes parkering.',
            "NVDB only covers the road network Statens vegvesen has registered. Trailhead parking along private and forest roads is often missing — nothing listed here does not mean there is nowhere to park.",
          )}
        </p>
      </div>
    );
  } else {
    content = (
      <ol className={styles.list}>
        {areas.map((a, i) => (
          <ParkingRow key={a.id} area={a} index={i} t={t} />
        ))}
      </ol>
    );
  }

  return (
    <div className={styles.panel}>
      {control}
      {content}
      {areas.length > 0 && (
        <p className={styles.coverageNote}>
          {t(
            'Kun områder registrert i NVDB. Utfartsparkering langs private veier mangler ofte.',
            'Only areas registered in NVDB. Trailhead parking on private roads is often missing.',
          )}
        </p>
      )}
      <SourceAttribution
        what={t('Parkeringsområder', 'Parking areas')}
        source={{
          label: 'Statens vegvesen (NVDB)',
          href: 'https://www.vegvesen.no/fag/teknologi/nasjonal-vegdatabank/',
        }}
        license={NLOD}
        note={
          fetchedAt != null && Number.isFinite(fetchedAt) ? (
            <>
              {t('Data hentet ', 'Data retrieved ')}
              {new Date(fetchedAt).toLocaleString([], {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
              {'. '}
            </>
          ) : undefined
        }
      />
    </div>
  );
}
