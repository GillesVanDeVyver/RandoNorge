// Single source of truth for the terms of use, rendered by BOTH the
// full-screen acceptance gate (TermsPage, shown before sign-up and guest
// entry) and the in-app reference dialog (TermsDialog, opened from the ⓘ
// button). Keeping one canonical text prevents the two from drifting apart
// — two diverging "terms" versions would undermine the acceptance gate's
// legal value, since a user could plausibly claim they accepted the other
// text.
//
// Legal shape (aligned with common practice for avalanche/outdoor apps and
// with Norwegian law): the service is an information and planning aid only,
// provided "as is"; the user bears sole responsibility for their own safety
// and decisions in the terrain; liability is disclaimed "to the fullest
// extent permitted by applicable law" — an absolute waiver would risk being
// set aside under avtaleloven § 36, since liability for gross negligence or
// intent cannot be excluded under Norwegian law.
//
// NOTE: this is a working draft, not legal advice — have it reviewed by a
// lawyer before charging money for the service.

export type TermsLang = 'en' | 'no';

export interface TermsSection {
  heading: string;
  body: string[];
}

export interface TermsText {
  title: string;
  updated: string;
  intro: string;
  sections: TermsSection[];
  acceptLabel: string;
  declineLabel: string;
  gateNote: string;
}

/**
 * Bump this whenever the terms text changes materially. It is shown on both
 * the gate page and the dialog ("Last updated") and can later be recorded
 * server-side if acceptance ever needs to be versioned per account.
 */
export const TERMS_VERSION = '2026-07-16';

export const TERMS: Record<TermsLang, TermsText> = {
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
            'and mountain travel in Norway. It combines open public data ' +
            '(topographic maps, terrain steepness and runout models, snow ' +
            'depth, avalanche forecasts and weather forecasts) into one ' +
            'view to support your own planning. It is a planning aid and ' +
            'nothing more.',
          'Fjellrute is NOT a safety device, a navigation instrument for ' +
            'emergencies, or a substitute for avalanche training, ' +
            'experience, proper equipment, local knowledge, or your own ' +
            'judgement in the terrain.',
        ],
      },
      {
        heading: '2. No guarantee of accuracy — data provided "as is"',
        body: [
          'Map, elevation, weather, snow and avalanche data are obtained ' +
            'from third-party sources and are provided "as is" and "as ' +
            'available", without any warranty of accuracy, completeness ' +
            'or timeliness. Forecasts are predictions, not facts. ' +
            'Conditions in the mountains change quickly and can differ ' +
            'substantially from what the app shows.',
          'Steepness and runout layers are derived from terrain models ' +
            'with limited resolution; real slopes can be steeper, and ' +
            'avalanches can run further, than the map suggests. ' +
            'Calculated values such as steepness, avalanche exposure, ' +
            'routes, distances and elevation profiles are estimates and ' +
            'may be wrong. GPS positioning may be inaccurate or ' +
            'unavailable.',
          'The service may be changed, interrupted or discontinued at ' +
            'any time without notice.',
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
            'Always read the full regional avalanche warning on varsom.no ' +
            'before a trip, verify conditions against official sources ' +
            '(such as varsom.no and yr.no), carry appropriate safety ' +
            'equipment, and never rely on this app as your only source ' +
            'of information.',
          'If what you see in the terrain disagrees with the app, trust ' +
            'the terrain.',
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
            'reliance on, the service or its content, or your inability ' +
            'to use the service.',
          'Nothing in these terms excludes or limits liability that ' +
            'cannot be excluded or limited under mandatory law, including ' +
            'liability for gross negligence or intent and your mandatory ' +
            'rights under Norwegian consumer law.',
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
        heading: '6. Acceptable use',
        body: [
          'The service is intended for personal trip planning. You may ' +
            'not misuse it, attempt to disrupt it, or use it to place ' +
            'unreasonable load on the public APIs it is built on.',
        ],
      },
      {
        heading: '7. Data sources and licences',
        body: [
          'Base maps, place names and elevation data © Kartverket ' +
            '(CC BY 4.0). Slope steepness/runout, snow depth (seNorge) ' +
            'and avalanche forecasts © NVE / Varsom.no, licensed under ' +
            'the Norwegian Licence for Open Government Data (NLOD). ' +
            'Weather forecasts © MET Norway (CC BY 4.0). 3D terrain from ' +
            'Mapzen/AWS Open Data terrain tiles and their upstream ' +
            'sources. These providers accept no responsibility for how ' +
            'their data is used.',
        ],
      },
      {
        heading: '8. Changes and contact',
        body: [
          'The terms may be updated from time to time; the date above ' +
            'shows the current version. Material changes will be ' +
            'presented for acceptance again. Continued use of the ' +
            'service after changes take effect constitutes acceptance of ' +
            'the updated terms. Questions can be sent to ' +
            'tryggve@sonofit.no.',
        ],
      },
      {
        heading: '9. Governing law',
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
            'toppturer og ferdsel i norsk fjellterreng. Tjenesten samler ' +
            'åpne offentlige data (topografiske kart, bratthets- og ' +
            'utløpsmodeller, snødybde, snøskredvarsler og værvarsler) i ' +
            'én visning som støtte til din egen planlegging. Tjenesten ' +
            'er et hjelpemiddel for planlegging, ikke noe mer.',
          'Fjellrute er IKKE sikkerhetsutstyr, ikke et navigasjons' +
            'instrument for nødsituasjoner, og ikke en erstatning for ' +
            'skredopplæring, erfaring, riktig utstyr, lokalkunnskap eller ' +
            'dine egne vurderinger i terrenget.',
        ],
      },
      {
        heading: '2. Ingen garanti for riktighet — data leveres «som de er»',
        body: [
          'Kart-, høyde-, vær-, snø- og skreddata hentes fra tredjeparts' +
            'kilder og leveres «som de er» og «som tilgjengelig», uten ' +
            'noen garanti for at de er riktige, fullstendige eller ' +
            'oppdaterte. Varsler er prognoser, ikke fakta. Forholdene i ' +
            'fjellet endrer seg raskt og kan avvike vesentlig fra det ' +
            'appen viser.',
          'Bratthets- og utløpskartene er avledet fra terrengmodeller ' +
            'med begrenset oppløsning; virkelige heng kan være brattere, ' +
            'og skred kan gå lenger, enn kartet antyder. Beregnede ' +
            'verdier som bratthet, skredutsatthet, ruter, avstander og ' +
            'høydeprofiler er estimater og kan være feil. GPS-' +
            'posisjonering kan være unøyaktig eller utilgjengelig.',
          'Tjenesten kan endres, avbrytes eller legges ned når som helst ' +
            'uten varsel.',
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
            'å starte, fortsette, snu eller velge rute. Les alltid det ' +
            'fullstendige regionale skredvarselet på varsom.no før ' +
            'turen, kontroller forholdene mot offisielle kilder (som ' +
            'varsom.no og yr.no), ta med nødvendig sikkerhetsutstyr, og ' +
            'stol aldri på denne appen som eneste informasjonskilde.',
          'Stemmer ikke terrenget med appen, stol på terrenget.',
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
            'eller tillit til, tjenesten eller dens innhold, eller ' +
            'manglende tilgang til tjenesten.',
          'Ingenting i disse vilkårene utelukker eller begrenser ansvar ' +
            'som ikke kan fraskrives etter ufravikelig lovgivning, ' +
            'herunder ansvar for grov uaktsomhet eller forsett og dine ' +
            'ufravikelige rettigheter etter norsk forbrukerlovgivning.',
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
        heading: '6. Akseptabel bruk',
        body: [
          'Tjenesten er ment for personlig turplanlegging. Du skal ikke ' +
            'misbruke den, forsøke å forstyrre den, eller bruke den til ' +
            'å påføre de offentlige API-ene den bygger på urimelig ' +
            'belastning.',
        ],
      },
      {
        heading: '7. Datakilder og lisenser',
        body: [
          'Bakgrunnskart, stedsnavn og høydedata © Kartverket ' +
            '(CC BY 4.0). Bratthet/utløp, snødybde (seNorge) og ' +
            'snøskredvarsler © NVE / Varsom.no, lisensiert under Norsk ' +
            'lisens for offentlige data (NLOD). Værvarsler © ' +
            'Meteorologisk institutt (CC BY 4.0). 3D-terreng fra ' +
            'Mapzen/AWS Open Data terrain tiles og deres kilder. ' +
            'Leverandørene tar ikke ansvar for hvordan dataene brukes.',
        ],
      },
      {
        heading: '8. Endringer og kontakt',
        body: [
          'Vilkårene kan bli oppdatert; datoen øverst viser gjeldende ' +
            'versjon. Vesentlige endringer vil bli lagt frem for ny ' +
            'aksept. Fortsatt bruk av tjenesten etter at endringer har ' +
            'trådt i kraft, regnes som aksept av de oppdaterte ' +
            'vilkårene. Spørsmål kan sendes til tryggve@sonofit.no.',
        ],
      },
      {
        heading: '9. Lovvalg',
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
