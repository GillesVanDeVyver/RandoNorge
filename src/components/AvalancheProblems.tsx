import { useState } from 'react';
import type { AvalancheProblem } from '../avalanche/api';
import styles from './AvalancheProblems.module.css';

interface Props {
  problems: AvalancheProblem[];
  // Region the problems belong to — shown when the route spans several
  // assessed regions so it's clear which one these problems describe.
  regionName?: string;
}

// Compass aspects, clockwise from north, matching the order of the bits in
// Varsom's ValidExpositions string ("11000111" → N, NE, SW, W, NW).
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function aspectList(expositions: string): string[] {
  return DIRS.filter((_, i) => expositions[i] === '1');
}

// Varsom encodes the danger band with two height lines and a "fill" code that
// says which part of the mountain is affected (see AvalancheProblemType docs).
function elevationText(p: AvalancheProblem): string | null {
  const { exposedHeight1: h1, exposedHeight2: h2, exposedHeightFill: fill } = p;
  switch (fill) {
    case 1:
      return `Above ${h1} m`;
    case 2:
      return `Below ${h1} m`;
    case 3:
      return `Above ${h1} m and below ${h2} m`;
    case 4:
      return `Between ${h2} m and ${h1} m`;
    default:
      return null; // all elevations / not specified
  }
}

// Group the seven Varsom problem types into icon families.
type Family = 'loose' | 'slab' | 'persistent' | 'wet' | 'glide';
function family(typeId: number): Family {
  switch (typeId) {
    case 3: // New snow (loose)
    case 5: // Wet snow (loose)
      return typeId === 5 ? 'wet' : 'loose';
    case 30: // Persistent weak layer
      return 'persistent';
    case 45: // Wet snow (slab)
      return 'wet';
    case 50: // Gliding avalanche
      return 'glide';
    case 7: // New snow (slab)
    case 10: // Wind slab
    default:
      return 'slab';
  }
}

// Compact pictogram per problem family. A point-release fan for loose-snow
// problems, a fracturing slab on a slope for slab problems (with a buried
// dashed layer for persistent ones), a droplet for wet problems, and a basal
// glide crack for glide avalanches.
function ProblemIcon({ typeId }: { typeId: number }) {
  const fam = family(typeId);
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    width: 24,
    height: 24,
    'aria-hidden': true,
  };
  if (fam === 'loose') {
    return (
      <svg {...common}>
        <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
        <path d="M12 7 L7 19 M12 7 L12 19 M12 7 L17 19" />
        <path d="M7 19 H17" />
      </svg>
    );
  }
  if (fam === 'wet') {
    return (
      <svg {...common}>
        <path d="M4 16 L20 9" />
        <path d="M8 13.4 L9.6 17 L17 14.2 L15.4 10.6 Z" />
        <path d="M12 18.5 c1.4 0 2.4 -1 2.4 -2.2 c0 -1.1 -1.4 -2.6 -2.4 -3.6 c-1 1 -2.4 2.5 -2.4 3.6 c0 1.2 1 2.2 2.4 2.2 Z" />
      </svg>
    );
  }
  if (fam === 'glide') {
    return (
      <svg {...common}>
        <path d="M4 17 C 9 15, 15 12, 20 8" />
        <path d="M10 14.6 q2.5 2.4 5 0.2" />
        <path d="M4 17 C 8 18.5, 14 18, 20 8" />
      </svg>
    );
  }
  // slab + persistent
  return (
    <svg {...common}>
      <path d="M3 17 L21 8" />
      <path d="M8 14.2 L9.8 18 L18 14 L16.2 10.2 Z" />
      {family(typeId) === 'persistent' && (
        <path d="M9 18 L17.2 14" strokeDasharray="2 1.6" />
      )}
    </svg>
  );
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
  // Collapsed by default; clicking a problem reveals its details.
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (problems.length === 0) return null;

  const heading = `Avalanche problem${problems.length > 1 ? 's' : ''}${
    regionName ? ` for ${regionName}` : ''
  }`;

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
                      label="Aspects"
                      value={aspects.length ? aspects.join(', ') : null}
                    />
                    <Fact label="Elevation" value={elevationText(p)} />
                    <Fact label="Likelihood" value={p.probability} />
                    <Fact label="Trigger" value={p.sensitivity} />
                    <Fact label="Avalanche size" value={p.size} />
                    <Fact label="Distribution" value={p.distribution} />
                  </dl>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
