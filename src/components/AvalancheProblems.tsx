import { useState } from 'react';
import type { AvalancheProblem } from '../avalanche/api';
import { translate } from '../i18n/locale.ts';
import { useT } from '../i18n/index.ts';
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

// Compass aspects, clockwise from north, matching the order of the bits in
// Varsom's ValidExpositions string ("11000111" → N, NE, SW, W, NW).
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const DIRS_NO = ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'];

function aspectList(expositions: string): string[] {
  return DIRS.map((d, i) => translate(DIRS_NO[i], d)).filter(
    (_, i) => expositions[i] === '1',
  );
}

// Varsom encodes the danger band with two height lines and a "fill" code that
// says which part of the mountain is affected (see AvalancheProblemType docs).
function elevationText(p: AvalancheProblem): string | null {
  const { exposedHeight1: h1, exposedHeight2: h2, exposedHeightFill: fill } = p;
  switch (fill) {
    case 1:
      return translate(`Over ${h1} moh.`, `Above ${h1} m`);
    case 2:
      return translate(`Under ${h1} moh.`, `Below ${h1} m`);
    case 3:
      return translate(
        `Over ${h1} moh. og under ${h2} moh.`,
        `Above ${h1} m and below ${h2} m`,
      );
    case 4:
      return translate(
        `Mellom ${h2} moh. og ${h1} moh.`,
        `Between ${h2} m and ${h1} m`,
      );
    default:
      return null; // all elevations / not specified
  }
}

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
  const sector = (i: number) => {
    const a1 = ((i * 45 - 22.5) * Math.PI) / 180;
    const a2 = ((i * 45 + 22.5) * Math.PI) / 180;
    const x1 = c + r * Math.sin(a1);
    const y1 = c - r * Math.cos(a1);
    const x2 = c + r * Math.sin(a2);
    const y2 = c - r * Math.cos(a2);
    return `M${c} ${c} L${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
  };
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
