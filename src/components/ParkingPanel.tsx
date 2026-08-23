// "Parking" summary tab: the nearest mapped places to leave the car, measured
// from where the route starts. Source is OpenStreetMap (see
// docs/parking-data-sources.md and src/parking/api.ts); it was NVDB until
// 2026-08-22, and the swap is why the coverage wording below changed.
//
// Two things this panel is careful about:
//
//  1. An empty result is reported as a gap in the map, not as "there is
//     nowhere to park". OSM's trailhead coverage is much better than the
//     register's — that is the whole reason for the move — but it is still
//     volunteer-surveyed, and a lot nobody has walked past with a phone is a
//     lot nobody has mapped. A planner that says "no parking found" flatly
//     would be lying to the user about the ground.
//
//  2. Attributes are shown only where a mapper actually recorded them.
//     Coverage of fee, capacity and payment method is uneven, and an invented
//     "free" is worse than a visible "—".
//
//  3. Every value below goes through a formatter in ../parking/format. OSM
//     answers in machine tags where NVDB answered in Norwegian prose, so the
//     raw row for Innerdalen reads `fee=75 NOK, surface=asphalt,
//     payment=app,credit_cards` — printable as-is only to someone who already
//     knows the tagging scheme. The formatters are shared with the printed
//     briefing so the two never disagree about one row of one query, and so is
//     the list of which facts a lot has (parkingFacts): sharing the formatters
//     but not the list is what let the sheet fall three fields behind this panel
//     and lose the labels off the rest, while every individual value it printed
//     stayed correct.
import { useEffect, useMemo, useState } from 'react';
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
import {
  releaseParkingHighlight,
  takeParkingHighlight,
} from '../parking/hover';
import {
  formatParkingDistance,
  formatParkingRadius,
  parkingFacts,
  parkingUsage,
} from '../parking/format';
import { SourceAttribution, ODBL } from './SourceAttribution';
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
  // Pointing at a row lights the matching lot on the map: its parking sign
  // grows and glows while the others fade, and the dot on the exact coordinate
  // moves to it. Both halves come from ../parking/hover, which owns the pair —
  // the sign highlight is the answer in 2D, the dot is the only half that
  // exists in the 3D view, and the point of going through one function is that
  // the two cannot end up pointing at different lots.

  // "Is this a lot people actually start tours from" is the question this
  // panel is open to answer, so it is not an attribute among seven — it sits
  // beside the name. Everything else `usage` carries is a kind of structure
  // and stays in the facts row below. See parkingUsage in ../parking/format.
  // Only the badge half is read here; the "Type" half of `usage` reaches the
  // facts row below through parkingFacts, which calls parkingUsage itself.
  const { purposes } = parkingUsage(area.usage, t);

  // Leaving by having the row taken away, rather than by moving the pointer off
  // it, fires no mouseleave — switching tabs while hovering, or a re-fetch that
  // drops this lot from the list. Without this the sign would stay lit for a
  // row that is no longer on screen.
  useEffect(
    () => () => {
      releaseParkingHighlight(area.id);
    },
    [area.id],
  );

  const take = () => takeParkingHighlight(area.id, area.point);
  const release = () => releaseParkingHighlight(area.id);

  return (
    <li
      className={styles.row}
      onMouseEnter={take}
      onMouseLeave={release}
      // Keyboard reaches the same highlight: the row is focusable because the
      // reader who tabs to it needs to be told which sign is theirs just as
      // much as the one who points at it.
      tabIndex={0}
      onFocus={take}
      onBlur={release}
    >
      <span className={styles.pin} aria-hidden>
        {index + 1}
      </span>
      <div className={styles.body}>
        <div className={styles.head}>
          <span className={styles.headLead}>
            <span className={styles.name}>
              {area.name ?? t('Parkeringsområde', 'Parking area')}
            </span>
            {/* The tooltip says who claims it, because the badge is a mapper's
                assertion rather than something we worked out: a lot with no
                badge may well be a trailhead nobody has tagged yet, and the
                panel must not read as if the two were the same. */}
            {purposes.map((purpose) => (
              <span
                key={purpose}
                className={styles.purpose}
                title={t(
                  'Merket som utfartsparkering i OpenStreetMap',
                  'Tagged as trailhead parking in OpenStreetMap',
                )}
              >
                {purpose}
              </span>
            ))}
          </span>
          <span className={styles.distance}>
            {formatParkingDistance(area.distanceM, t)}
          </span>
        </div>
        {/* Which facts, in which order, under which labels: ../parking/format,
            because the printed briefing shows the same list and the two used to
            drift. The tab is the side with room, so it shows all of them and
            wraps; the sheet takes as many as fit its one line per lot.

            Two of the labels are worth knowing the history of. "Type" was
            "Bruk / Use", which named the database column rather than the
            question — a row reading "Use: Trailhead" left the reader working
            out whose use, and of what. And what is missing, deliberately:
            "Vinter" / winter maintenance, which NVDB carried and OSM has no
            established tag for. It was the most useful attribute here for a ski
            tour and losing it is a real regression — but NVDB carried it for
            lots that were mostly not trailheads, so a field that was reliably
            present about the wrong car parks has been traded for a wider set of
            the right ones. If OSM settles on a tag for it, add it back in
            parkingFacts, where both renderings will pick it up at once. */}
        <div className={styles.facts}>
          {parkingFacts(area, t).map((fact) => (
            <Fact key={fact.key} label={fact.label} value={fact.value} />
          ))}
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
            'Dataene kommer fra OpenStreetMap og er kartlagt av frivillige. Dekningen er god ved kjente utfartssteder, men en plass ingen har kartlagt står ikke her — at det ikke står noe her betyr ikke at det ikke finnes parkering.',
            'The data comes from OpenStreetMap and is mapped by volunteers. Coverage is good at well-known trailheads, but a lot nobody has mapped will not appear — nothing listed here does not mean there is nowhere to park.',
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
            'Kartlagt av frivillige i OpenStreetMap. Avgift og antall plasser er ikke alltid oppdatert.',
            'Mapped by volunteers in OpenStreetMap. Fees and space counts are not always current.',
          )}
        </p>
      )}
      <SourceAttribution
        what={t('Parkeringsområder', 'Parking areas')}
        source={{
          label: 'OpenStreetMap',
          href: 'https://www.openstreetmap.org/copyright',
        }}
        license={ODBL}
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
