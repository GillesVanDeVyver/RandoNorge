// Data-source attribution line shown under a data panel. Each upstream
// provider's terms require visible credit:
//   - MET Norway (Locationforecast): NLOD 2.0 / CC BY 4.0
//   - NVE seNorge (GridTimeSeries snow depth): NLOD 2.0
//   - Kartverket (høydedata elevation API): CC BY 4.0
//   - OpenStreetMap contributors (parking areas): ODbL 1.0
// The avalanche panel carries its own equivalent line (see AvalancheRisk).
//
// The last of those is the only one where the credit is a licence term rather
// than a courtesy — ODbL §4.3 — so it is also rendered outside this component,
// in the map corner and on the printed briefing. See docs/DATA_LICENSES.md §6.
import { useT } from '../i18n/index.ts';
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
  const t = useT();
  return (
    <p className={styles.attribution}>
      {note}
      {what} ©{' '}
      <a href={source.href} {...ext}>
        {source.label}
      </a>
      {t(', lisensiert under ', ', licensed under ')}
      <a href={license.href} {...ext}>
        {license.label}
      </a>
      {t('. Data leveres «som de er».', '. Data provided “as is”.')}
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

/** OpenStreetMap's licence, carried by the parking layer.
 *
 *  Unlike the two above, this one is share-alike, and the credit is not a
 *  courtesy: ODbL §4.3 requires the notice wherever the data is publicly used.
 *  Fjellrute shows it here, in the map corner (MapAttribution) and on the
 *  briefing sheet, and publishes the extract itself at /data/parking to
 *  satisfy §4.6. See docs/DATA_LICENSES.md. */
export const ODBL = {
  label: 'ODbL 1.0',
  href: 'https://opendatacommons.org/licenses/odbl/1-0/',
};
