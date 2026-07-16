import { useState } from 'react';
import { MountainIcon } from './icons';
import styles from './TermsPage.module.css';

/**
 * Bump this whenever the terms text changes materially. It is shown on the
 * page ("Last updated") and can later be recorded server-side if acceptance
 * ever needs to be versioned per account.
 */
export const TERMS_VERSION = '2026-07-16';

type Props = {
  /** The user read the terms and pressed Accept. */
  onAccept: () => void;
  /** The user declined — return to wherever they came from. */
  onDecline: () => void;
};

type Lang = 'en' | 'no';

type Section = { heading: string; body: string[] };

type TermsText = {
  title: string;
  updated: string;
  intro: string;
  sections: Section[];
  acceptLabel: string;
  declineLabel: string;
  gateNote: string;
};

/**
 * The terms themselves, in both languages.
 *
 * Legal shape (aligned with common practice for avalanche/outdoor apps and
 * with Norwegian law): the service is an information and planning aid only,
 * provided "as is"; the user bears sole responsibility for their own safety
 * and decisions in the terrain; liability is disclaimed "to the fullest
 * extent permitted by applicable law" — an absolute waiver would risk being
 * set aside under avtaleloven § 36, since liability for gross negligence or
 * intent cannot be excluded under Norwegian law.
 */
const TERMS: Record<Lang, TermsText> = {
  en: {
    title: 'Terms of Use',
    updated: 'Last updated',
    intro:
      'Please read these terms carefully. You must accept them before ' +
      'creating an account or using Fjellrute as a guest. If you do not ' +
      'accept the terms, you cannot use the service.',
    sections: [
      {
        heading: '1. What Fjellrute is — and what it is not',
        body: [
          'Fjellrute is a planning and information tool for ski touring ' +
            'and mountain travel. It presents maps, terrain steepness, ' +
            'weather, snow and avalanche information to support your own ' +
            'planning.',
          'Fjellrute is NOT a safety device, a navigation instrument for ' +
            'emergencies, or a substitute for avalanche training, ' +
            'experience, proper equipment, local knowledge, or your own ' +
            'judgement in the terrain.',
        ],
      },
      {
        heading: '2. No guarantee of accuracy',
        body: [
          'Map, elevation, weather, snow and avalanche data are obtained ' +
            'from third-party sources and are provided "as is" and "as ' +
            'available", without any warranty of accuracy, completeness ' +
            'or timeliness. Forecasts are predictions, not facts. ' +
            'Conditions in the mountains change quickly and can differ ' +
            'substantially from what the app shows.',
          'Calculated values such as steepness, avalanche exposure, ' +
            'routes, distances and elevation profiles are estimates and ' +
            'may be wrong. GPS positioning may be inaccurate or ' +
            'unavailable.',
        ],
      },
      {
        heading: '3. Your responsibility — use at your own risk',
        body: [
          'Travel in the mountains and in avalanche terrain is inherently ' +
            'dangerous and can lead to serious injury or death. You use ' +
            'Fjellrute, and you travel in the terrain, entirely at your ' +
            'own risk.',
          'You are solely responsible for your own safety and for every ' +
            'decision you make before and during a trip, including the ' +
            'decision to start, continue, turn around, or choose a route. ' +
            'Always verify conditions against official sources (such as ' +
            'varsom.no and yr.no), carry appropriate safety equipment, ' +
            'and never rely on this app as your only source of ' +
            'information.',
        ],
      },
      {
        heading: '4. Disclaimer of liability',
        body: [
          'To the fullest extent permitted by applicable law, Fjellrute ' +
            'and its provider accept no responsibility for your safety ' +
            'and disclaim all liability for any loss or damage of any ' +
            'kind — including personal injury, death, or damage to ' +
            'property — arising from or connected to your use of, or ' +
            'reliance on, the service or its content.',
          'Nothing in these terms excludes or limits liability that ' +
            'cannot be excluded or limited under mandatory law, including ' +
            'liability for gross negligence or intent.',
        ],
      },
      {
        heading: '5. Not for emergency use',
        body: [
          'Do not rely on Fjellrute in an emergency. In Norway, call 112 ' +
            '(police), 113 (medical emergency) or 110 (fire).',
        ],
      },
      {
        heading: '6. Changes to these terms',
        body: [
          'The terms may be updated from time to time. Material changes ' +
            'will be presented for acceptance again. Continued use of the ' +
            'service after changes take effect constitutes acceptance of ' +
            'the updated terms.',
        ],
      },
      {
        heading: '7. Governing law',
        body: [
          'These terms are governed by Norwegian law. Disputes are ' +
            'subject to the ordinary Norwegian courts.',
        ],
      },
    ],
    acceptLabel: 'I have read and accept the terms',
    declineLabel: 'Decline',
    gateNote:
      'By pressing accept you confirm that you understand that Fjellrute ' +
      'is a planning aid only and that you travel at your own risk.',
  },
  no: {
    title: 'Vilkår for bruk',
    updated: 'Sist oppdatert',
    intro:
      'Les disse vilkårene nøye. Du må godta dem før du oppretter en ' +
      'konto eller bruker Fjellrute som gjest. Godtar du ikke vilkårene, ' +
      'kan du ikke bruke tjenesten.',
    sections: [
      {
        heading: '1. Hva Fjellrute er — og ikke er',
        body: [
          'Fjellrute er et planleggings- og informasjonsverktøy for ' +
            'toppturer og ferdsel i fjellet. Tjenesten viser kart, ' +
            'bratthet, vær-, snø- og skredinformasjon som støtte til din ' +
            'egen planlegging.',
          'Fjellrute er IKKE sikkerhetsutstyr, ikke et navigasjons' +
            'instrument for nødsituasjoner, og ikke en erstatning for ' +
            'skredopplæring, erfaring, riktig utstyr, lokalkunnskap eller ' +
            'dine egne vurderinger i terrenget.',
        ],
      },
      {
        heading: '2. Ingen garanti for riktighet',
        body: [
          'Kart-, høyde-, vær-, snø- og skreddata hentes fra tredjeparts' +
            'kilder og leveres «som de er» og «som tilgjengelig», uten ' +
            'noen garanti for at de er riktige, fullstendige eller ' +
            'oppdaterte. Varsler er prognoser, ikke fakta. Forholdene i ' +
            'fjellet endrer seg raskt og kan avvike vesentlig fra det ' +
            'appen viser.',
          'Beregnede verdier som bratthet, skredutsatthet, ruter, ' +
            'avstander og høydeprofiler er estimater og kan være feil. ' +
            'GPS-posisjonering kan være unøyaktig eller utilgjengelig.',
        ],
      },
      {
        heading: '3. Ditt ansvar — bruk på egen risiko',
        body: [
          'Ferdsel i fjellet og i skredterreng er forbundet med fare og ' +
            'kan føre til alvorlig skade eller død. Du bruker Fjellrute, ' +
            'og du ferdes i terrenget, helt på egen risiko.',
          'Du er alene ansvarlig for din egen sikkerhet og for alle ' +
            'beslutninger du tar før og under en tur, inkludert valget om ' +
            'å starte, fortsette, snu eller velge rute. Kontroller alltid ' +
            'forholdene mot offisielle kilder (som varsom.no og yr.no), ' +
            'ta med nødvendig sikkerhetsutstyr, og stol aldri på denne ' +
            'appen som eneste informasjonskilde.',
        ],
      },
      {
        heading: '4. Ansvarsfraskrivelse',
        body: [
          'Så langt gjeldende rett tillater, påtar Fjellrute og ' +
            'leverandøren seg intet ansvar for din sikkerhet og ' +
            'fraskriver seg ethvert ansvar for tap eller skade av enhver ' +
            'art — herunder personskade, dødsfall eller tingsskade — som ' +
            'oppstår som følge av eller i forbindelse med din bruk av, ' +
            'eller tillit til, tjenesten eller dens innhold.',
          'Ingenting i disse vilkårene utelukker eller begrenser ansvar ' +
            'som ikke kan fraskrives etter ufravikelig lovgivning, ' +
            'herunder ansvar for grov uaktsomhet eller forsett.',
        ],
      },
      {
        heading: '5. Ikke for nødsituasjoner',
        body: [
          'Ikke stol på Fjellrute i en nødsituasjon. I Norge: ring 112 ' +
            '(politi), 113 (medisinsk nødhjelp) eller 110 (brann).',
        ],
      },
      {
        heading: '6. Endringer i vilkårene',
        body: [
          'Vilkårene kan bli oppdatert. Vesentlige endringer vil bli ' +
            'lagt frem for ny aksept. Fortsatt bruk av tjenesten etter at ' +
            'endringer har trådt i kraft, regnes som aksept av de ' +
            'oppdaterte vilkårene.',
        ],
      },
      {
        heading: '7. Lovvalg',
        body: [
          'Disse vilkårene er underlagt norsk rett. Tvister hører inn ' +
            'under de ordinære norske domstolene.',
        ],
      },
    ],
    acceptLabel: 'Jeg har lest og godtar vilkårene',
    declineLabel: 'Avslå',
    gateNote:
      'Ved å trykke godta bekrefter du at du forstår at Fjellrute kun er ' +
      'et planleggingsverktøy, og at du ferdes på egen risiko.',
  },
};

/**
 * Full-screen terms gate shown before sign-up (email or Google) and before
 * entering the app as a guest. Acceptance is deliberately not persisted:
 * sign-up simply cannot complete without it, and guests are asked on every
 * visit.
 */
export function TermsPage({ onAccept, onDecline }: Props) {
  const [lang, setLang] = useState<Lang>('en');
  const t = TERMS[lang];

  return (
    <div className={styles.page}>
      <div className={styles.scrim} aria-hidden="true" />

      <header className={styles.brand}>
        <span className={styles.brandIcon}>
          <MountainIcon />
        </span>
        <span className={styles.brandName}>Fjellrute</span>
      </header>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h1 className={styles.title}>{t.title}</h1>
            <p className={styles.updated}>
              {t.updated}: {TERMS_VERSION}
            </p>
          </div>
          <div
            className={styles.langToggle}
            role="group"
            aria-label="Language"
          >
            <button
              type="button"
              className={styles.langBtn}
              data-active={lang === 'en' || undefined}
              onClick={() => setLang('en')}
            >
              EN
            </button>
            <button
              type="button"
              className={styles.langBtn}
              data-active={lang === 'no' || undefined}
              onClick={() => setLang('no')}
            >
              NO
            </button>
          </div>
        </div>

        <div className={styles.body}>
          <p className={styles.intro}>{t.intro}</p>
          {t.sections.map((section) => (
            <section key={section.heading}>
              <h2 className={styles.sectionHeading}>{section.heading}</h2>
              {section.body.map((paragraph, i) => (
                <p key={i} className={styles.paragraph}>
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>

        <footer className={styles.footer}>
          <p className={styles.gateNote}>{t.gateNote}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.declineBtn}
              onClick={onDecline}
            >
              {t.declineLabel}
            </button>
            <button
              type="button"
              className={styles.acceptBtn}
              onClick={onAccept}
            >
              {t.acceptLabel}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
