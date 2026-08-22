// How far a lot is from the start, written the way a driver reads it.
//
// Here rather than in either of the two places that print it. The tab and the
// printed briefing show the same five lots, and a guide checking the sheet
// against the screen is checking two renderings of one query — so "240 m" on
// one and "0.2 km" on the other would look like a disagreement about the
// ground rather than about a format string. It had already started: the sheet
// was written with a plain toFixed and printed "1.2 km" to a Norwegian reader
// the tab was showing "1,2 km" to.
//
// Two rules, both about how the number is read rather than how precise it is.
// Below a kilometre it is metres, rounded to ten, because nobody paces out the
// last four; at a kilometre and above it is one decimal, because the choice
// between two lots at that range is made on the map and not on the third digit.
// And the decimal separator follows the language, since a Norwegian sheet that
// prints "1.2 km" is a sheet that was written somewhere else.

import type { Translate } from '../i18n/index.ts';

export function formatParkingDistance(m: number, t: Translate): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  const km = (m / 1000).toFixed(1);
  return t(`${km.replace('.', ',')} km`, `${km} km`);
}

/** The search radius, in the whole kilometres the slider moves in.
 *
 *  Takes no Translate, unlike the distance above: the slider steps in half
 *  kilometres and this rounds to whole ones, so there is no decimal separator
 *  for a language to have an opinion about. */
export function formatParkingRadius(m: number): string {
  return `${(m / 1000).toFixed(0)} km`;
}

// --- Tag values ------------------------------------------------------------
//
// Everything below exists because of what the move from NVDB to OpenStreetMap
// did to the *values* in these fields, which is a change nobody asks about
// when they ask about coverage. NVDB answered in Norwegian prose — "Grus",
// "Avgift", "Vinterdrift" — and the panel could print it. OSM answers in
// machine tags: `surface=asphalt`, `fee=no`, `payment:credit_cards=yes`. Print
// those under the labels the panel already has and a Norwegian driver reads
//
//     Dekke: asphalt · Avgift: no · Betaling: easypark,mastercard,visa
//
// which is worse than the register it replaced, on a screen that is read in a
// car park. So the enumerated values get translated here, in one module, for
// the same reason the distance formatter lives here: the tab and the printed
// briefing must not disagree about how one row of one query reads.
//
// THE RULE FOR EVERY MAP BELOW: an unrecognised value is *humanised*, never
// dropped. OSM tagging is open — a mapper can write `surface=grass_paver`
// tomorrow — and a lookup that returned null for anything it had not been
// told about would silently delete true facts as the data improved. Showing
// "Grass paver" to a Norwegian reader is a small ugliness; hiding that the
// surface was recorded at all is a lie about the map.

/** `some_odd_value` → `Some odd value`. The fallback under every map below. */
function humanise(value: string): string {
  const text = value.replace(/[_-]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : value;
}

/** Fee. `fee=no` is the most common single value in the whole extract (5,332
 *  rows), and "Avgift: no" is both ugly and briefly ambiguous — so the two
 *  booleans become words. Anything else is left exactly as the mapper wrote
 *  it, because it is either a price ("75 NOK") or an opening-hours expression
 *  ("Mo-Fr 08:00-20:00"), and both are facts we must not paraphrase. */
export function formatParkingFee(
  fee: string | null,
  t: Translate,
): string | null {
  if (!fee) return null;
  switch (fee) {
    case 'no':
      return t('Gratis', 'Free');
    case 'yes':
      return t('Ja', 'Yes');
    case 'donation':
      return t('Frivillig betaling', 'Donation');
    case 'interval':
      return t('Avgift i perioder', 'Charged at times');
    case 'seasonal':
      return t('Avgift i sesong', 'Seasonal charge');
    default:
      return fee;
  }
}

const SURFACE_NO: Record<string, string> = {
  asphalt: 'Asfalt',
  paved: 'Fast dekke',
  concrete: 'Betong',
  paving_stones: 'Belegningsstein',
  sett: 'Brostein',
  cobblestone: 'Brostein',
  gravel: 'Grus',
  fine_gravel: 'Finpukk',
  compacted: 'Komprimert grus',
  pebblestone: 'Singel',
  unpaved: 'Løst dekke',
  ground: 'Naturgrunn',
  dirt: 'Jord',
  earth: 'Jord',
  mud: 'Gjørme',
  grass: 'Gress',
  grass_paver: 'Gressarmering',
  sand: 'Sand',
  wood: 'Tre',
  metal: 'Metall',
  snow: 'Snø',
  ice: 'Is',
};

/** Surface. Norwegian only — the English column already reads correctly as
 *  the tag value, and inventing a second English spelling of `fine_gravel`
 *  would only be a way to disagree with OpenStreetMap in public. */
export function formatParkingSurface(
  surface: string | null,
  t: Translate,
): string | null {
  if (!surface) return null;
  return t(SURFACE_NO[surface] ?? humanise(surface), humanise(surface));
}

/** Access values that say nothing once the build script has already dropped
 *  `private`, `no` and `permit`: every row that survives is one you may park
 *  in, so "Adkomst: Ja" is a row of the facts list spent on the reader's own
 *  assumption. `unknown` is worse — it is a mapper recording that they did not
 *  find out, which is exactly the state of every field we leave blank. */
const ACCESS_SAYS_NOTHING = new Set(['yes', 'public', 'unknown']);

const ACCESS_NO: Record<string, string> = {
  customers: 'Kun for kunder',
  guests: 'Kun for gjester',
  visitors: 'Kun for besøkende',
  employees: 'Kun for ansatte',
  destination: 'Kun for tilreisende hit',
  permissive: 'Tillatt av grunneier',
  designated: 'Kun for angitte kjøretøy',
  disabled: 'Kun HC-plasser',
  charging: 'Kun lading',
  tourist_bus: 'Kun turbuss',
};

const ACCESS_EN: Record<string, string> = {
  customers: 'Customers only',
  guests: 'Guests only',
  visitors: 'Visitors only',
  employees: 'Staff only',
  destination: 'Destination traffic only',
  permissive: 'By landowner’s permission',
  designated: 'Designated vehicles only',
  disabled: 'Blue-badge only',
  charging: 'EV charging only',
  tourist_bus: 'Tour coaches only',
};

/** Access, or null when the value is the reader's own default.
 *
 *  This is the one field where the restriction is the whole point: 2,849 lots
 *  in the extract are `access=customers`, and a driver who leaves the car at a
 *  hotel for eight hours on a tour wants that sentence before they walk off,
 *  not after. */
export function formatParkingAccess(
  access: string | null,
  t: Translate,
): string | null {
  if (!access || ACCESS_SAYS_NOTHING.has(access)) return null;
  return t(ACCESS_NO[access] ?? humanise(access), ACCESS_EN[access] ?? humanise(access));
}

const PAYMENT_NO: Record<string, string> = {
  cash: 'Kontant',
  coins: 'Mynt',
  notes: 'Sedler',
  cards: 'Kort',
  credit_cards: 'Kredittkort',
  debit_cards: 'Debetkort',
  contactless: 'Kontaktløst',
  app: 'App',
  mobile_payment: 'Mobilbetaling',
  e_money: 'E-penger',
  qr_code: 'QR-kode',
  telephone: 'Telefon',
  sms: 'SMS',
  membership_card: 'Medlemskort',
  invoice: 'Faktura',
  bank_transfer: 'Bankoverføring',
};

const PAYMENT_EN: Record<string, string> = {
  cash: 'Cash',
  coins: 'Coins',
  notes: 'Notes',
  cards: 'Cards',
  credit_cards: 'Credit card',
  debit_cards: 'Debit card',
  contactless: 'Contactless',
  app: 'App',
  mobile_payment: 'Mobile payment',
  e_money: 'E-money',
  qr_code: 'QR code',
  telephone: 'Telephone',
  sms: 'SMS',
  membership_card: 'Membership card',
  invoice: 'Invoice',
  bank_transfer: 'Bank transfer',
};

/** Brand names, left alone. `payment:vipps=yes` is not a payment *method* in
 *  the sense the map above translates, it is the name of the thing on the
 *  driver's phone, and "Vipps" is what they are looking for. Held as a set of
 *  lowercase keys so the extract's inconsistent casing ("Vipps" and "vipps"
 *  both occur) resolves to one spelling on screen. */
const PAYMENT_BRANDS: Record<string, string> = {
  vipps: 'Vipps',
  easypark: 'EasyPark',
  smartpark: 'SmartPark',
  apcoa: 'Apcoa',
  bankaxept: 'BankAxept',
  visa: 'Visa',
  visa_debit: 'Visa',
  visa_electron: 'Visa Electron',
  mastercard: 'Mastercard',
  maestro: 'Maestro',
  american_express: 'American Express',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
};

/** Payment methods: the comma-joined list the build script writes, unpacked
 *  into something readable and re-joined with a separator that has a space in
 *  it. "easypark,mastercard,smartpark,visa" is a database field;
 *  "EasyPark, Mastercard, SmartPark, Visa" is an answer to "can I pay here".
 *
 *  This is the field that took the winter-maintenance column's place on the
 *  briefing sheet, so it is also the one most worth getting right: "App" alone
 *  is the fact that strands somebody in a valley with no signal. */
export function formatParkingPayment(
  payment: string | null,
  t: Translate,
): string | null {
  if (!payment) return null;
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const raw of payment.split(',')) {
    const key = raw.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const brand = PAYMENT_BRANDS[key];
    parts.push(brand ?? t(PAYMENT_NO[key] ?? humanise(key), PAYMENT_EN[key] ?? humanise(key)));
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

const USAGE_NO: Record<string, string> = {
  hiking: 'Turparkering',
  ski: 'Skiparkering',
  underground: 'Under bakken',
  'multi-storey': 'Parkeringshus',
  rooftop: 'Takparkering',
  carports: 'Carport',
  sheds: 'Garasjer',
  layby: 'Lomme langs veien',
};

const USAGE_EN: Record<string, string> = {
  hiking: 'Trailhead',
  ski: 'Ski touring',
  underground: 'Underground',
  'multi-storey': 'Multi-storey',
  rooftop: 'Rooftop',
  carports: 'Carports',
  sheds: 'Garages',
  layby: 'Lay-by',
};

/** What the lot is for. Order is the build script's, and the build script puts
 *  `hiking` and `ski` first deliberately (usage_of in
 *  scripts/parking/build_parking_extract.py) — they are the two values this
 *  app exists to surface, and a row reading "Turparkering, Parkeringshus" has
 *  answered the question in its first word. Do not sort here; sorting would
 *  put the alphabet in charge of that.
 *
 *  Values of the form `tourism=camp_site` are passed through with the key
 *  dropped: the reader wants "Camp site", not the tag that carried it. */
export function formatParkingUsage(
  usage: string | null,
  t: Translate,
): string | null {
  if (!usage) return null;
  const parts: string[] = [];
  for (const raw of usage.split(',')) {
    const key = raw.trim().split('=').pop()?.trim().toLowerCase() ?? '';
    if (!key) continue;
    const label = t(USAGE_NO[key] ?? humanise(key), USAGE_EN[key] ?? humanise(key));
    if (!parts.includes(label)) parts.push(label);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}
