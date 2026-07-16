// Data-source attribution line shown under a data panel. Each upstream
// provider's terms require visible credit:
//   - MET Norway (Locationforecast): NLOD 2.0 / CC BY 4.0
//   - NVE seNorge (GridTimeSeries snow depth): NLOD 2.0
//   - Kartverket (høydedata elevation API): CC BY 4.0
// The avalanche panel carries its own equivalent line (see AvalancheRisk).
import styles from './SourceAttribution.module.css';

interface SourceLink {
  label: string;
  href: string;
}

interface Props {
  // e.g. "Weather forecast" — what data the panel shows.
  what: string;
  source: SourceLink;
  license: SourceLink;
  // Optional sentence(s) shown before the © credit, e.g. the retrieval time
  // of the data currently on screen.
  note?: React.ReactNode;
}

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;

export function SourceAttribution({ what, source, license, note }: Props) {
  return (
    <p className={styles.attribution}>
      {note}
      {what} ©{' '}
      <a href={source.href} {...ext}>
        {source.label}
      </a>
      , licensed under{' '}
      <a href={license.href} {...ext}>
        {license.label}
      </a>
      . Data provided “as is”.
    </p>
  );
}

export const NLOD = {
  label: 'NLOD',
  href: 'https://data.norge.no/nlod/en/2.0',
};

export const CC_BY_4 = {
  label: 'CC BY 4.0',
  href: 'https://creativecommons.org/licenses/by/4.0/',
};
