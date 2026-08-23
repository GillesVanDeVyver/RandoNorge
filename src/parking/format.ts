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
import type { ParkingArea } from './api';

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

// The `usage` column holds two kinds of fact that a reader treats completely
// differently, and printing them in one row under one label was the reason
// nobody could tell what the row meant.
//
// The first is *why a tour planner cares that this lot exists*: somebody has
// recorded that people leave the car here to walk or ski into the hills. That
// is the answer to the question the panel was opened to ask, and it belongs
// where the eye already is — beside the lot's name, as a badge.
//
// The second is what sort of structure it is: a multi-storey, a rooftop deck,
// a lay-by, a camp site's own parking. True, worth showing, and no more
// urgent than the surface or the fee — so it stays in the attribute row, under
// a label that says what it is answering.
//
// Splitting them here rather than in the panel keeps the vocabulary in the one
// module that knows how OSM tags read in Norwegian.

/** A lot somebody starts a tour from. Two values, both from tags a mapper set
 *  deliberately, and the whole reason this panel is on by default. */
const PURPOSE_NO: Record<string, string> = {
  hiking: 'Turparkering',
  ski: 'Skiparkering',
};

const PURPOSE_EN: Record<string, string> = {
  hiking: 'Trailhead parking',
  ski: 'Ski touring parking',
};

/** `trailhead=yes` is a third spelling of `hiking=yes` — the same claim about
 *  the same ground, from a mapper who reached for a different key — so it
 *  resolves to the same badge instead of standing beside it saying the same
 *  thing twice. */
const PURPOSE_ALIASES: Record<string, string> = {
  trailhead: 'hiking',
};

const KIND_NO: Record<string, string> = {
  underground: 'Under bakken',
  'multi-storey': 'Parkeringshus',
  rooftop: 'Takparkering',
  carports: 'Carport',
  sheds: 'Garasjer',
  layby: 'Lomme langs veien',
  camp_site: 'Campingplass',
  caravan_site: 'Bobilplass',
  alpine_hut: 'Turisthytte',
  wilderness_hut: 'Ubetjent hytte',
  hotel: 'Hotell',
  attraction: 'Attraksjon',
  viewpoint: 'Utsiktspunkt',
  picnic_site: 'Rasteplass',
  information: 'Informasjonspunkt',
};

const KIND_EN: Record<string, string> = {
  underground: 'Underground',
  'multi-storey': 'Multi-storey',
  rooftop: 'Rooftop',
  carports: 'Carports',
  sheds: 'Garages',
  layby: 'Lay-by',
  camp_site: 'Camp site',
  caravan_site: 'Caravan site',
  alpine_hut: 'Alpine hut',
  wilderness_hut: 'Wilderness hut',
  hotel: 'Hotel',
  attraction: 'Attraction',
  viewpoint: 'Viewpoint',
  picnic_site: 'Picnic site',
  information: 'Information point',
};

/** Tag values that mean "the key is true", and therefore carry no information
 *  of their own. `trailhead=yes` printed as "Yes" was the old bug: the word
 *  that meant something was the key, and it was the one thrown away. */
const BOOLEAN_VALUES = new Set(['yes', 'true', '1']);

export interface ParkingUsage {
  /** Labelled for the badge beside the name. Usually empty or one entry; both
   *  when a lot is tagged for summer and winter starts. */
  purposes: string[];
  /** Everything else the mapper recorded about what sort of place it is. */
  kinds: string[];
}

/** Split the `usage` column into the badge and the attribute row.
 *
 *  Order within each list is the build script's, never sorted here: usage_of
 *  in scripts/parking/build_parking_extract.py writes `hiking` and `ski`
 *  first deliberately, and sorting would put the alphabet in charge of which
 *  fact the reader meets first.
 *
 *  A token of the form `key=value` is read on its value when the value says
 *  something (`tourism=camp_site` → "Campingplass") and on its key when it
 *  does not (`trailhead=yes` → "Turparkering"). Unrecognised either way, it is
 *  humanised rather than dropped — same rule as every map above. */
export function parkingUsage(usage: string | null, t: Translate): ParkingUsage {
  const purposes: string[] = [];
  const kinds: string[] = [];
  if (!usage) return { purposes, kinds };

  for (const token of usage.split(',')) {
    const [rawKey, ...rest] = token.trim().split('=');
    const key = rawKey.trim().toLowerCase();
    if (!key) continue;
    const value = rest.join('=').trim().toLowerCase();
    const word = value && !BOOLEAN_VALUES.has(value) ? value : key;

    const canonical = PURPOSE_ALIASES[word] ?? word;
    if (PURPOSE_NO[canonical]) {
      const label = t(PURPOSE_NO[canonical], PURPOSE_EN[canonical]);
      if (!purposes.includes(label)) purposes.push(label);
      continue;
    }
    const label = t(KIND_NO[word] ?? humanise(word), KIND_EN[word] ?? humanise(word));
    if (!kinds.includes(label)) kinds.push(label);
  }
  return { purposes, kinds };
}

// --- The attribute row -----------------------------------------------------
//
// Which facts a lot shows, in which order, under which labels — for both the
// planner's tab and the printed sheet, from here.
//
// The formatters above were already shared, on the grounds that the tab and the
// briefing are two renderings of one query and must not disagree about a row.
// The *selection* was not, and that is exactly where they drifted: the tab grew
// max stay, operator and type, and the sheet — written when the section was a
// four-column table with 48 mm to spend — kept the five it started with and
// printed them label-less, middot-joined. So a guide comparing paper to screen
// found the screen's "Avgift: Gratis · Maks tid: 48 t · Drives av: Stryn
// kommune" against the paper's "Gratis · Grus", and had no way to tell a lot
// where nobody recorded the max stay from a lot where the sheet simply does not
// carry the field. One list, one order, one set of labels: the two renderings
// can now only differ in how many of these fit, which is a fact about the paper
// rather than about the car park.
//
// Order is the tab's, which is roughly descending usefulness to a driver, and
// is what both sides read top to bottom / left to right.

export interface ParkingFact {
  /** Stable across languages, for React keys and for the tests. */
  key: string;
  label: string;
  value: string;
  /** What survives when there is not room for all of it. Lower is kept
   *  longer; see takeParkingFacts. Display order is the array's, never this —
   *  a sheet that reordered its columns per lot would be unreadable down the
   *  page. */
  priority: number;
}

/** Every fact a mapper actually recorded about this lot, in the order both the
 *  tab and the sheet show them.
 *
 *  Absent fields are dropped rather than rendered as "—": across the whole
 *  extract most lots carry two or three of these eight, and a row padded to
 *  eight columns of dashes says "we asked and the map is empty" eight times
 *  over. The one caller that wants a placeholder for a lot with nothing at all
 *  supplies it itself. */
export function parkingFacts(area: ParkingArea, t: Translate): ParkingFact[] {
  const { kinds } = parkingUsage(area.usage, t);
  const all: (Omit<ParkingFact, 'value'> & { value: string | null })[] = [
    {
      key: 'capacity',
      label: t('Plasser', 'Spaces'),
      value: area.capacity !== null ? String(area.capacity) : null,
      priority: 2,
    },
    // Fee and access are the two that are kept to the last column. Whether it
    // costs anything is the question the section is opened to answer, and
    // access is only ever present when it restricts — the formatter returns
    // null for yes/public/unknown — so on the lots that have it, it is the
    // sentence to read before walking away from the car for eight hours.
    {
      key: 'fee',
      label: t('Avgift', 'Fee'),
      value: formatParkingFee(area.fee, t),
      priority: 1,
    },
    {
      key: 'payment',
      label: t('Betaling', 'Payment'),
      value: formatParkingPayment(area.payment, t),
      priority: 2,
    },
    {
      key: 'surface',
      label: t('Dekke', 'Surface'),
      value: formatParkingSurface(area.surface, t),
      priority: 3,
    },
    // maxstay and operator are free text a mapper typed — "48 t", "Stryn
    // kommune" — not an enumeration, so there is nothing to translate.
    { key: 'maxstay', label: t('Maks tid', 'Max stay'), value: area.maxstay, priority: 4 },
    {
      key: 'access',
      label: t('Adkomst', 'Access'),
      value: formatParkingAccess(area.access, t),
      priority: 1,
    },
    { key: 'operator', label: t('Drives av', 'Operator'), value: area.operator, priority: 5 },
    {
      key: 'kinds',
      label: t('Type', 'Type'),
      value: kinds.length > 0 ? kinds.join(', ') : null,
      priority: 5,
    },
  ];
  return all.filter((f): f is ParkingFact => Boolean(f.value));
}

/** As many facts as fit a line `budget` characters wide, most important first,
 *  returned in display order.
 *
 *  For the printed sheet, which has one line per lot and no way to discover it
 *  has overrun: paper does not reflow, and CSS cannot count. The tab wraps
 *  instead and calls parkingFacts directly.
 *
 *  This function drops whole facts and never truncates one: "Betaling: EasyPark,
 *  Mastercard, V…" is a worse thing to hand a driver than no payment column at
 *  all, because they cannot tell whether the card they hold is in the part that
 *  was cut. What goes is the least load-bearing — type, then operator, then max
 *  stay — so a lot with eight recorded facts prints the same first few as a lot
 *  with three, and the columns stay comparable down the page.
 *
 *  What it cannot promise is that the page agrees, because `budget` counts
 *  characters and the column is measured in millimetres, and the exchange rate
 *  between them depends on which characters. Measured on the sheet's 7.4 pt
 *  face, real rows cost 1.255–1.321 mm per character against a column that
 *  breaks even at 1.372, so the margin is real but not large; a value made of
 *  unusually wide glyphs can spend well under budget and still overrun, and
 *  .briefingParkingFacts then clips it. Two things make that acceptable rather
 *  than a bug to design around. The clip falls on the last fact in display
 *  order, which is the low-priority end, so what gets damaged is what would have
 *  been dropped next anyway. And it cannot cost a line: the cell is nowrap, so
 *  the row's height — the thing the page's vertical budget is built on — holds
 *  whatever the data does. Widening the budget past the measured range would
 *  trade that for nothing. */
export function takeParkingFacts(
  facts: ParkingFact[],
  budget: number,
): ParkingFact[] {
  // Label, the space before the value, the value, and the " · " that will
  // separate this fact from the next. Counted for the first fact too: it is one
  // separator's worth of slack in the caller's favour, and the alternative is a
  // budget whose meaning depends on which fact happens to come first.
  const cost = (f: ParkingFact) => f.label.length + 1 + f.value.length + 3;
  const order = facts
    .map((f, i) => ({ f, i }))
    .sort((a, b) => a.f.priority - b.f.priority || a.i - b.i);

  const kept = new Set<number>();
  let used = 0;
  for (const { f, i } of order) {
    const next = used + cost(f);
    if (kept.size > 0 && next > budget) continue;
    kept.add(i);
    used = next;
  }
  return facts.filter((_, i) => kept.has(i));
}
