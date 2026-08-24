import { useState } from 'react';
import type { AvalancheProblem } from '@fjellrute/core/avalanche/api';
import {
  DIRS,
  aspectList,
  elevationText,
  roseSectorPath,
} from '@fjellrute/core/avalanche/problemText';
import { useT } from '@fjellrute/core/i18n';
import styles from './AvalancheProblems.module.css';
// Official EAWS avalanche-problem pictograms (the same five icons Varsom and
// other European warning services use). Bundled locally so they render
// offline and without depending on an external host.
import newSnowIcon from '../avalanche/problem-icons/new_snow.jpg';
import windSlabIcon from '../avalanche/problem-icons/wind_slab.jpg';
import persistentIcon from '../avalanche/problem-icons/persistent_weak_layer.jpg';
import wetSnowIcon from '../avalanche/problem-icons/wet_snow.jpg';
import glidingIcon from '../avalanche/problem-icons/gliding_snow.jpg';

const VARSOM_PROBLEMS_URL =
  'https://www.varsom.no/en/avalanches/about-avalanches/avalanche-problems/';

interface Props {
  problems: AvalancheProblem[];
  // Region the problems belong to — shown when the route spans several
  // assessed regions so it's clear which one these problems describe.
  regionName?: string;
}

// Aspect/elevation decoding lives in avalanche/problemText.ts so the printable
// briefing describes each problem in exactly the same words as this panel.

// Map each Varsom problem type to its EAWS pictogram. EAWS defines five
// "typical problems"; Varsom's loose/slab split for new and wet snow collapses
// onto the same two icons (new-snow and wet-snow).
const PICTOGRAMS: Record<number, { src: string; alt: string }> = {
  3: { src: newSnowIcon, alt: 'New snow' }, // New snow (loose)
  7: { src: newSnowIcon, alt: 'New snow' }, // New snow (slab)
  10: { src: windSlabIcon, alt: 'Wind-drifted snow' }, // Wind slab
  30: { src: persistentIcon, alt: 'Persistent weak layer' },
  5: { src: wetSnowIcon, alt: 'Wet snow' }, // Wet snow (loose)
  45: { src: wetSnowIcon, alt: 'Wet snow' }, // Wet snow (slab)
  50: { src: glidingIcon, alt: 'Gliding snow' }, // Gliding avalanche
};

// Decorative pictogram — the problem's type name is shown alongside as text.
function ProblemIcon({ typeId }: { typeId: number }) {
  const picto = PICTOGRAMS[typeId] ?? PICTOGRAMS[3];
  return <img className={styles.picto} src={picto.src} alt="" aria-hidden />;
}

// Octagonal aspect rose: sectors that face an at-risk aspect are filled.
function AspectRose({ expositions }: { expositions: string }) {
  const c = 13;
  const r = 11;
  const sector = (i: number) => roseSectorPath(i, c, r);
  return (
    <svg
      viewBox="0 0 26 26"
      width="26"
      height="26"
      className={styles.rose}
      aria-hidden
    >
      {DIRS.map((_, i) => (
        <path
          key={i}
          d={sector(i)}
          className={expositions[i] === '1' ? styles.roseOn : styles.roseOff}
        />
      ))}
      <circle cx={c} cy={c} r={r} className={styles.roseRing} fill="none" />
    </svg>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>{value}</dd>
    </div>
  );
}

export function AvalancheProblems({ problems, regionName }: Props) {
  const t = useT();
  // Collapsed by default; clicking a problem reveals its details.
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (problems.length === 0) return null;

  const heading = regionName
    ? t(`Skredproblemer for ${regionName}`, `Avalanche problems for ${regionName}`)
    : t('Skredproblemer', 'Avalanche problems');

  return (
    <div className={styles.section}>
      <h3 className={styles.heading}>{heading}</h3>
      <ul className={styles.list}>
        {problems.map((p, i) => {
          const expanded = openIdx === i;
          const aspects = aspectList(p.expositions);
          return (
            <li key={i} className={styles.item}>
              <button
                type="button"
                className={styles.summaryRow}
                aria-expanded={expanded}
                onClick={() => setOpenIdx(expanded ? null : i)}
              >
                <span className={styles.icon}>
                  <ProblemIcon typeId={p.typeId} />
                </span>
                <span className={styles.titleCol}>
                  <span className={styles.title}>{p.typeName}</span>
                  {p.cause && <span className={styles.sub}>{p.cause}</span>}
                </span>
                <AspectRose expositions={p.expositions} />
                <span className={styles.chevron} aria-hidden>
                  {expanded ? '▾' : '▸'}
                </span>
              </button>
              {expanded && (
                <div className={styles.detail}>
                  {p.summary && <p className={styles.summary}>{p.summary}</p>}
                  <dl className={styles.facts}>
                    <Fact
                      label={t('Himmelretninger', 'Aspects')}
                      value={aspects.length ? aspects.join(', ') : null}
                    />
                    <Fact label={t('Høyde', 'Elevation')} value={elevationText(p)} />
                    <Fact label={t('Sannsynlighet', 'Likelihood')} value={p.probability} />
                    <Fact label={t('Utløser', 'Trigger')} value={p.sensitivity} />
                    <Fact label={t('Skredstørrelse', 'Avalanche size')} value={p.size} />
                    <Fact label={t('Utbredelse', 'Distribution')} value={p.distribution} />
                  </dl>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className={styles.moreInfo}>
        {t('Mer info på ', 'More info at ')}
        <a href={VARSOM_PROBLEMS_URL} target="_blank" rel="noopener noreferrer">
          varsom.no
        </a>
      </p>
    </div>
  );
}
