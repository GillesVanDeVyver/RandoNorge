import { useEffect, useRef, useState } from 'react';
import styles from './TermsDialog.module.css';

// Terms of service / vilkår, shown in a modal. The text mirrors the "as is"
// stance of the upstream data providers (NVE, Kartverket, MET): fjellrute is
// a planning aid built on open data that carries no warranty, and the user
// keeps full responsibility for decisions in avalanche terrain.
//
// NOTE: this is a working draft, not legal advice — have it reviewed by a
// lawyer before charging money for the service.

type Lang = 'en' | 'no';

interface Section {
  heading: Record<Lang, string>;
  paragraphs: Record<Lang, string[]>;
}

const LAST_UPDATED: Record<Lang, string> = {
  en: 'Last updated: 12 July 2026',
  no: 'Sist oppdatert: 12. juli 2026',
};

const TITLE: Record<Lang, string> = {
  en: 'Terms of service',
  no: 'Vilkår for bruk',
};

const SECTIONS: Section[] = [
  {
    heading: {
      en: '1. What fjellrute is',
      no: '1. Hva fjellrute er',
    },
    paragraphs: {
      en: [
        'fjellrute is a planning tool for ski touring and other backcountry trips in Norway. It combines open public data — topographic maps, slope steepness and runout models, snow depth, avalanche forecasts and weather forecasts — into one view to help you prepare a trip. It is a planning aid and nothing more.',
      ],
      no: [
        'fjellrute er et planleggingsverktøy for toppturer og andre turer i norsk fjellterreng. Tjenesten samler åpne offentlige data — topografiske kart, bratthets- og utløpsmodeller, snødybde, snøskredvarsler og værvarsler — i én visning for å hjelpe deg å planlegge turen. Tjenesten er et hjelpemiddel for planlegging, ikke noe mer.',
      ],
    },
  },
  {
    heading: {
      en: '2. Your safety is your responsibility',
      no: '2. Din sikkerhet er ditt ansvar',
    },
    paragraphs: {
      en: [
        'Travel in avalanche terrain is inherently dangerous. fjellrute is not a substitute for avalanche training, experience, proper equipment, local knowledge or your own judgment in the field. Conditions in the mountains change quickly and can differ substantially from anything shown in this app.',
        'Steepness and runout layers are derived from terrain models with limited resolution; real slopes can be steeper, and avalanches can run further, than the map suggests. Snow depth is model data, and weather and avalanche bulletins are forecasts — none of them are measurements of the conditions you will actually meet.',
        'Always read the full regional avalanche warning on varsom.no before a trip, and make your own decisions based on what you observe on the ground. If what you see in the terrain disagrees with the app, trust the terrain.',
      ],
      no: [
        'Ferdsel i skredterreng er forbundet med reell fare. fjellrute erstatter ikke skredopplæring, erfaring, riktig utstyr, lokalkunnskap eller dine egne vurderinger i terrenget. Forholdene i fjellet endrer seg raskt og kan avvike vesentlig fra det som vises i denne tjenesten.',
        'Bratthets- og utløpskartene er avledet fra terrengmodeller med begrenset oppløsning; virkelige heng kan være brattere, og skred kan gå lenger, enn kartet antyder. Snødybde er modelldata, og vær- og skredvarsler er prognoser — ingen av dem er målinger av forholdene du faktisk møter.',
        'Les alltid det fullstendige regionale skredvarselet på varsom.no før turen, og ta egne beslutninger basert på det du observerer i terrenget. Stemmer ikke terrenget med appen, stol på terrenget.',
      ],
    },
  },
  {
    heading: {
      en: '3. Data is provided “as is”',
      no: '3. Data leveres «som de er»',
    },
    paragraphs: {
      en: [
        'All map and condition data in fjellrute comes from third parties, including Kartverket, NVE (Varsom and seNorge) and MET Norway. These providers supply their data “as is”: it can contain errors and omissions, be outdated or incomplete, and give a wrong or misleading picture of actual conditions. They accept no responsibility for how the data is used.',
        'fjellrute passes this data on under the same terms. We give no warranty of any kind — express or implied — for the accuracy, completeness, timeliness or availability of the service or of any data shown in it. The service may be changed, interrupted or discontinued at any time without notice.',
      ],
      no: [
        'Alle kart- og føredata i fjellrute kommer fra tredjeparter, blant andre Kartverket, NVE (Varsom og seNorge) og Meteorologisk institutt. Disse leverer sine data «som de er»: de kan inneholde feil og mangler, være utdaterte eller ufullstendige, og gi et feilaktig eller misvisende bilde av de faktiske forholdene. Leverandørene tar ikke ansvar for hvordan dataene brukes.',
        'fjellrute videreformidler dataene på samme vilkår. Vi gir ingen garantier av noe slag — verken uttrykkelige eller underforståtte — for at tjenesten eller dataene i den er korrekte, fullstendige, oppdaterte eller tilgjengelige. Tjenesten kan endres, avbrytes eller legges ned når som helst uten varsel.',
      ],
    },
  },
  {
    heading: {
      en: '4. Limitation of liability',
      no: '4. Ansvarsbegrensning',
    },
    paragraphs: {
      en: [
        'To the maximum extent permitted by Norwegian law, fjellrute and its developer accept no liability for any loss or damage — including personal injury or death — arising from use of the service, from inability to use it, or from reliance on any data shown in it.',
        'Nothing in these terms limits or excludes liability that cannot lawfully be limited or excluded, including your mandatory rights under Norwegian consumer law.',
      ],
      no: [
        'Så langt norsk rett tillater det, fraskriver fjellrute og utvikleren seg ethvert ansvar for tap eller skade — herunder personskade eller dødsfall — som følge av bruk av tjenesten, manglende tilgang til den, eller tillit til data som vises i den.',
        'Ingenting i disse vilkårene begrenser eller utelukker ansvar som ikke lovlig kan begrenses eller utelukkes, herunder dine ufravikelige rettigheter etter norsk forbrukerlovgivning.',
      ],
    },
  },
  {
    heading: {
      en: '5. Acceptable use',
      no: '5. Akseptabel bruk',
    },
    paragraphs: {
      en: [
        'The service is intended for personal trip planning. You may not misuse it, attempt to disrupt it, or use it to place unreasonable load on the public APIs it is built on.',
      ],
      no: [
        'Tjenesten er ment for personlig turplanlegging. Du skal ikke misbruke den, forsøke å forstyrre den, eller bruke den til å påføre de offentlige API-ene den bygger på urimelig belastning.',
      ],
    },
  },
  {
    heading: {
      en: '6. Data sources and licences',
      no: '6. Datakilder og lisenser',
    },
    paragraphs: {
      en: [
        'Base maps and place names © Kartverket (CC BY 4.0). Slope steepness/runout, snow depth (seNorge) and avalanche forecasts © NVE / Varsom.no, licensed under the Norwegian Licence for Open Government Data (NLOD). Weather forecasts © MET Norway (CC BY 4.0). Terrain elevation from Mapzen/AWS Open Data terrain tiles and their upstream sources.',
      ],
      no: [
        'Bakgrunnskart og stedsnavn © Kartverket (CC BY 4.0). Bratthet/utløp, snødybde (seNorge) og snøskredvarsler © NVE / Varsom.no, lisensiert under Norsk lisens for offentlige data (NLOD). Værvarsler © Meteorologisk institutt (CC BY 4.0). Terrenghøyder fra Mapzen/AWS Open Data terrain tiles og deres kilder.',
      ],
    },
  },
  {
    heading: {
      en: '7. Changes and contact',
      no: '7. Endringer og kontakt',
    },
    paragraphs: {
      en: [
        'These terms may be updated as the service evolves; the date above shows the current version. Continued use of the service after a change means you accept the updated terms. Questions can be sent to tryggve@sonofit.no.',
      ],
      no: [
        'Vilkårene kan bli oppdatert etter hvert som tjenesten utvikler seg; datoen øverst viser gjeldende versjon. Fortsatt bruk av tjenesten etter en endring innebærer at du godtar de oppdaterte vilkårene. Spørsmål kan sendes til tryggve@sonofit.no.',
      ],
    },
  },
];

interface Props {
  onClose: () => void;
}

export function TermsDialog({ onClose }: Props) {
  const [lang, setLang] = useState<Lang>('en');
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc closes the dialog. Stop propagation so the app-level Esc handler
  // (which exits draw/erase mode) doesn't also fire.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Move focus into the dialog when it opens.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={TITLE[lang]}
        tabIndex={-1}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>{TITLE[lang]}</h2>
          <div
            className={styles.langToggle}
            role="group"
            aria-label="Language"
          >
            <button
              type="button"
              className={lang === 'en' ? styles.langActive : ''}
              onClick={() => setLang('en')}
              aria-pressed={lang === 'en'}
            >
              EN
            </button>
            <button
              type="button"
              className={lang === 'no' ? styles.langActive : ''}
              onClick={() => setLang('no')}
              aria-pressed={lang === 'no'}
            >
              NO
            </button>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label={lang === 'en' ? 'Close' : 'Lukk'}
          >
            ×
          </button>
        </header>
        <div className={styles.body}>
          <p className={styles.updated}>{LAST_UPDATED[lang]}</p>
          {SECTIONS.map((s) => (
            <section key={s.heading.en}>
              <h3 className={styles.sectionHeading}>{s.heading[lang]}</h3>
              {s.paragraphs[lang].map((p, i) => (
                <p key={i} className={styles.paragraph}>
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
