// Single source of truth for the privacy policy, rendered by BOTH the
// full-screen acceptance gate (TermsPage, as a second tab next to the terms)
// and the in-app reference dialog (TermsDialog). Same rationale as
// src/terms/content.ts: one canonical text so the accepted version and the
// in-app reference can never drift apart.
//
// A static mirror for external use (the Google OAuth consent screen requires
// a public privacy-policy URL) lives at public/privacy.html — update it
// whenever this file changes.
//
// GDPR shape (Articles 12–14): who the controller is, what is collected,
// why and on what legal basis, who processes it, how long it is kept, and
// what rights the user has. Written to match what the code actually does —
// if the code changes (new data, new processor, analytics), this text and
// PRIVACY_VERSION must change with it.
//
// NOTE: this is a working draft, not legal advice — have it reviewed by a
// lawyer before charging money for the service.

import type { TermsLang, TermsSection } from './content';

export interface PrivacyText {
  title: string;
  updated: string;
  intro: string;
  sections: TermsSection[];
}

/** Bump whenever the privacy policy changes materially. */
export const PRIVACY_VERSION = '2026-07-16';

export const PRIVACY: Record<TermsLang, PrivacyText> = {
  en: {
    title: 'Privacy Policy',
    updated: 'Last updated',
    intro:
      'This policy explains what personal data Fjellrute processes, why, ' +
      'and what rights you have. Short version: we store only what the ' +
      'service needs to work, we use no analytics or advertising ' +
      'trackers, and we never sell or share your data for marketing.',
    sections: [
      {
        heading: '1. Who is responsible',
        body: [
          'Fjellrute is the data controller for the personal data ' +
            'described here. Contact for all privacy matters: ' +
            'tryggve@sonofit.no.',
        ],
      },
      {
        heading: '2. What we collect and why',
        body: [
          'Account data: your email address, display name and — if you ' +
            'sign in with Google — the profile picture Google provides. ' +
            'Used to create and secure your account and to send ' +
            'verification and password-reset emails. Passwords are ' +
            'stored only as salted cryptographic hashes, never in ' +
            'readable form. Legal basis: performance of our agreement ' +
            'with you (GDPR art. 6(1)(b)).',
          'Session data: when you are signed in, each session stores a ' +
            'session token together with the IP address and browser ' +
            '(user-agent) it was created from. Used to keep you signed ' +
            'in and to detect and prevent abuse such as account ' +
            'hijacking. Legal basis: our legitimate interest in keeping ' +
            'the service secure (art. 6(1)(f)).',
          'Content you save: routes you draw and tracks you record are ' +
            'stored in your account when — and only when — you choose to ' +
            'save them. A recorded track contains GPS positions with ' +
            'timestamps and can therefore reveal where you have been; ' +
            'save and delete them with that in mind. Legal basis: ' +
            'performance of our agreement with you (art. 6(1)(b)).',
          'Your live GPS position during navigation is processed on your ' +
            'device only. It is never sent to our servers unless you ' +
            'save the recording as a track. Location access is requested ' +
            'from your browser only when you start navigation or ' +
            'recording, and you can withdraw it in your browser or ' +
            'device settings at any time.',
          'As a guest (without an account) we store no personal data ' +
            'about you at all.',
        ],
      },
      {
        heading: '3. Cookies',
        body: [
          'Fjellrute sets a single strictly necessary cookie: the ' +
            'session cookie that keeps you signed in. There are no ' +
            'analytics cookies, no advertising cookies and no ' +
            'third-party trackers, which is why the app shows no cookie ' +
            'banner.',
        ],
      },
      {
        heading: '4. Who processes the data for us',
        body: [
          'Cloudflare, Inc. hosts the application and the database in ' +
            'which all data above is stored, and acts as our data ' +
            'processor under its data processing addendum.',
          'Resend, Inc. (USA) delivers our account emails and therefore ' +
            'processes your email address when a verification or ' +
            'password-reset message is sent.',
          'Google LLC (USA) is involved only if you choose "Sign in ' +
            'with Google", in which case Google shares your name, email ' +
            'address and profile picture with us under Google\u2019s own ' +
            'privacy policy.',
          'All three act under data processing agreements that meet ' +
            'GDPR art. 28. Where they process personal data in the ' +
            'United States, the transfer is safeguarded by the ' +
            'EU\u2013US Data Privacy Framework, under which Cloudflare, ' +
            'Inc., Resend (Plus Five Five, Inc.) and Google LLC are ' +
            'certified, and additionally by the EU Standard Contractual ' +
            'Clauses incorporated into their data processing agreements ' +
            '(GDPR art. 46).',
          'In addition, when the map loads, your browser fetches map ' +
            'tiles and terrain data directly from the public services ' +
            'the app is built on (Kartverket, NVE and AWS Open Data). ' +
            'Like any web server, those services technically receive ' +
            'your IP address when serving those requests. Weather, snow ' +
            'and avalanche data are fetched through our own server, so ' +
            'those providers do not see your IP address.',
        ],
      },
      {
        heading: '5. How long we keep it',
        body: [
          'Account data, saved routes and recorded tracks are kept until ' +
            'you delete them or your account. Expired sessions — ' +
            'including their IP address and browser information — and ' +
            'expired email-verification tokens are deleted automatically ' +
            'by a daily cleanup job.',
        ],
      },
      {
        heading: '6. Your rights',
        body: [
          'You can at any time request access to, correction of, or ' +
            'deletion of your personal data, restriction of processing, ' +
            'a machine-readable copy of your data (routes and tracks are ' +
            'stored as standard GeoJSON), and you can object to ' +
            'processing based on legitimate interest. Routes and tracks ' +
            'can be deleted directly in the app; for account deletion or ' +
            'any other request, email tryggve@sonofit.no and it will be ' +
            'handled within a month, as the GDPR requires.',
          'If you believe we handle your data unlawfully, you have the ' +
            'right to complain to the Norwegian Data Protection ' +
            'Authority (Datatilsynet, datatilsynet.no).',
        ],
      },
      {
        heading: '7. Children',
        body: [
          'Fjellrute is not directed at children. You must be at least ' +
            '13 years old to create an account.',
        ],
      },
      {
        heading: '8. Changes',
        body: [
          'This policy may be updated; the date above shows the current ' +
            'version. Material changes will be presented for acceptance ' +
            'again.',
        ],
      },
    ],
  },
  no: {
    title: 'Personvernerklæring',
    updated: 'Sist oppdatert',
    intro:
      'Denne erklæringen forklarer hvilke personopplysninger Fjellrute ' +
      'behandler, hvorfor, og hvilke rettigheter du har. Kort versjon: vi ' +
      'lagrer bare det tjenesten trenger for å fungere, vi bruker ingen ' +
      'analyse- eller annonsesporing, og vi selger eller deler aldri ' +
      'opplysningene dine til markedsføring.',
    sections: [
      {
        heading: '1. Hvem som er ansvarlig',
        body: [
          'Fjellrute er behandlingsansvarlig for personopplysningene som ' +
            'beskrives her. Kontakt for alle personvernspørsmål: ' +
            'tryggve@sonofit.no.',
        ],
      },
      {
        heading: '2. Hva vi samler inn og hvorfor',
        body: [
          'Kontoopplysninger: e-postadressen din, visningsnavn og — hvis ' +
            'du logger inn med Google — profilbildet Google oppgir. ' +
            'Brukes til å opprette og sikre kontoen din og til å sende ' +
            'bekreftelses- og passordtilbakestillings-e-post. Passord ' +
            'lagres kun som saltede kryptografiske hasher, aldri i ' +
            'lesbar form. Behandlingsgrunnlag: avtalen med deg ' +
            '(GDPR art. 6 nr. 1 bokstav b).',
          'Øktdata: når du er innlogget, lagres for hver økt et ' +
            'økt-token sammen med IP-adressen og nettleseren ' +
            '(user-agent) økten ble opprettet fra. Brukes til å holde ' +
            'deg innlogget og til å oppdage og hindre misbruk, for ' +
            'eksempel kontokapring. Behandlingsgrunnlag: vår berettigede ' +
            'interesse i å holde tjenesten sikker (art. 6 nr. 1 bokstav f).',
          'Innhold du lagrer: ruter du tegner og spor du tar opp, lagres ' +
            'på kontoen din når — og bare når — du velger å lagre dem. ' +
            'Et opptak inneholder GPS-posisjoner med tidsstempler og kan ' +
            'dermed vise hvor du har vært; lagre og slett dem med det i ' +
            'mente. Behandlingsgrunnlag: avtalen med deg (art. 6 nr. 1 ' +
            'bokstav b).',
          'Din GPS-posisjon under navigasjon behandles kun på din egen ' +
            'enhet. Den sendes aldri til våre servere med mindre du ' +
            'lagrer opptaket som et spor. Nettleseren ber om ' +
            'posisjonstilgang først når du starter navigasjon eller ' +
            'opptak, og du kan når som helst trekke tilgangen tilbake i ' +
            'nettleser- eller enhetsinnstillingene.',
          'Som gjest (uten konto) lagrer vi ingen personopplysninger om ' +
            'deg i det hele tatt.',
        ],
      },
      {
        heading: '3. Informasjonskapsler',
        body: [
          'Fjellrute setter én strengt nødvendig informasjonskapsel: ' +
            'øktkapselen som holder deg innlogget. Det finnes ingen ' +
            'analysekapsler, ingen annonsekapsler og ingen tredjeparts' +
            'sporing — derfor viser appen heller ingen cookie-banner.',
        ],
      },
      {
        heading: '4. Hvem som behandler opplysningene for oss',
        body: [
          'Cloudflare, Inc. drifter applikasjonen og databasen der alle ' +
            'opplysningene over lagres, og er vår databehandler i ' +
            'henhold til sin databehandleravtale.',
          'Resend, Inc. (USA) leverer konto-e-postene våre og behandler ' +
            'derfor e-postadressen din når en bekreftelses- eller ' +
            'tilbakestillingsmelding sendes.',
          'Google LLC (USA) er bare involvert hvis du velger «Logg inn ' +
            'med Google»; da deler Google navn, e-postadresse og ' +
            'profilbilde med oss i henhold til Googles egen personvern' +
            'erklæring.',
          'Alle tre opptrer under databehandleravtaler som oppfyller ' +
            'GDPR art. 28. Der de behandler personopplysninger i USA, ' +
            'er overføringen sikret gjennom EU\u2013US Data Privacy ' +
            'Framework, som Cloudflare, Inc., Resend (Plus Five Five, ' +
            'Inc.) og Google LLC er sertifisert under, og i tillegg ' +
            'gjennom EUs standardkontraktklausuler som inngår i ' +
            'databehandleravtalene deres (GDPR art. 46).',
          'I tillegg henter nettleseren din kartfliser og terrengdata ' +
            'direkte fra de offentlige tjenestene appen bygger på ' +
            '(Kartverket, NVE og AWS Open Data) når kartet lastes. Som ' +
            'enhver webserver mottar disse tjenestene teknisk sett ' +
            'IP-adressen din når de besvarer forespørslene. Vær-, snø- ' +
            'og skreddata hentes via vår egen server, så disse ' +
            'leverandørene ser ikke IP-adressen din.',
        ],
      },
      {
        heading: '5. Hvor lenge vi lagrer',
        body: [
          'Kontoopplysninger, lagrede ruter og opptak beholdes til du ' +
            'sletter dem eller kontoen din. Utløpte økter — inkludert ' +
            'IP-adresse og nettleserinformasjon — og utløpte ' +
            'e-postbekreftelsestokener slettes automatisk av en daglig ' +
            'oppryddingsjobb.',
        ],
      },
      {
        heading: '6. Dine rettigheter',
        body: [
          'Du kan når som helst be om innsyn i, retting av eller ' +
            'sletting av personopplysningene dine, begrensning av ' +
            'behandlingen, en maskinlesbar kopi av dataene dine (ruter ' +
            'og spor lagres som standard GeoJSON), og du kan protestere ' +
            'mot behandling basert på berettiget interesse. Ruter og ' +
            'spor kan slettes direkte i appen; for sletting av konto ' +
            'eller andre henvendelser, send e-post til ' +
            'tryggve@sonofit.no, så håndteres det innen en måned, slik ' +
            'GDPR krever.',
          'Mener du at vi behandler opplysningene dine ulovlig, har du ' +
            'rett til å klage til Datatilsynet (datatilsynet.no).',
        ],
      },
      {
        heading: '7. Barn',
        body: [
          'Fjellrute retter seg ikke mot barn. Du må være minst 13 år ' +
            'for å opprette en konto.',
        ],
      },
      {
        heading: '8. Endringer',
        body: [
          'Erklæringen kan bli oppdatert; datoen øverst viser gjeldende ' +
            'versjon. Vesentlige endringer vil bli lagt frem for ny ' +
            'aksept.',
        ],
      },
    ],
  },
};
