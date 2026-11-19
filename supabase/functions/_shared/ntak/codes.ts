/**
 * NTAK PMS interface v9 value sets (NTAK_PMS_Interface_v9.07, annexes 12.2–12.5,
 * section 9.5 and the published v9 WSDLs). Pure data, no I/O.
 */

export const NTAK_NS = 'http://mtu.gov.hu/ntak/v9';

export const UNIT_TYPES = [
  'ECONOMY', 'STANDARD', 'SUPERIOR', 'JUNIOR_SUITE', 'SUITE', 'MOBILHAZ', 'UDULOHAZ', 'PARCELLA',
  'SATORHELY_KEMPINGHELY', 'EGYEDI', 'PRIVAT_SZOBA_KOZOS_FURDOVEL', 'PRIVAT_SZOBA_SAJAT_FURDOVEL',
  'HALOTERMI_AGY', 'APARTMAN', 'EGYEB',
] as const;
export type UnitType = typeof UNIT_TYPES[number];

export const MARKET_SEGMENTS = ['SZABADIDOS_EGYENI', 'SZABADIDOS_CSOPORTOS', 'UZLETI_EGYENI', 'UZLETI_CSOPORTOS', 'ISMERETLEN'] as const;
export type MarketSegment = typeof MARKET_SEGMENTS[number];

export const SALES_CHANNELS = ['DIREKT_ONLINE', 'DIREKT_HAGYOMANYOS', 'KOZVETITO_ONLINE', 'KOZVETITO_HAGYOMANYOS'] as const;
export type SalesChannel = typeof SALES_CHANNELS[number];

export const PAYMENT_TYPES = ['BANKKARTYA', 'KESZPENZ', 'SZEP_KARTYA', 'ATUTALAS', 'UTALVANY', 'UTOLAGOS', 'EGYEB'] as const;
export type PaymentType = typeof PAYMENT_TYPES[number];

export const SEXES = ['NO', 'FERFI', 'EGYEB_VAGY_NEM_ISMERT'] as const;
export type Sex = typeof SEXES[number];

export const VAT_RATES = [0, 5, 18, 27] as const;
export type VatRate = typeof VAT_RATES[number];

export const IFA_TYPES = ['SZAZALEKOS', 'TETELES', 'NINCS'] as const;
export type IfaType = typeof IFA_TYPES[number];

/** Message processing states returned by the verification endpoint (7.6). */
export const NTAK_STATUSES = ['BEFOGADVA', 'TELJESEN_SIKERES', 'VIZSGALANDO', 'TELJESEN_HIBAS', 'UJRA_KULDENDO'] as const;
export type NtakStatus = typeof NTAK_STATUSES[number];

/** Annex 12.3: complete set of NTAK main categories and their subcategories. */
export const CATEGORIES: Record<string, readonly string[]> = {
  SZALLASDIJ: [],
  IFA: [],
  KOZFURDO: ['FURDO_PROGRAM', 'STRAND_PROGRAM', 'USZODAI_PROGRAM', 'WELLNESS_PROGRAM', 'EGESZSEGUGYI_SZOLGALTATAS'],
  TERMESZETES_FURDO: ['SZABADVIZI_STRAND_PROGRAM'],
  MUZEUM_VAR_KASTELY: ['KIALLITAS', 'MUZEUMPEDAGOGIA', 'TARLATVEZETES', 'EGYHAZI_LETESITMENY_LATOGATASA', 'KASTELYLATOGATAS', 'VARLATOGATAS', 'EGYEB_MUEMLEK_LATOGATASA', 'OKTATASI_PROGRAM'],
  TURISZTIKAI_KOZLEKEDES: ['TAVI_HAJOZAS', 'FOLYAMI_HAJOZAS', 'HOP_ON_HOP_OFF'],
  KALANDPARK: ['KALANDPARKI_PROGRAM', 'ELMENYKOZPONTI_PROGRAM'],
  ALLATKERT: ['ALLATKERTI_PROGRAM', 'VADASPARKI_PROGRAM'],
  VIDAMPARK: ['VIDAMPARKI_PROGRAM'],
  VEDETT_TERMESZETI_TERULET: ['NEMZETI_PARK_LATOGATAS', 'BARLANGLATOGATAS', 'TARLATVEZETES', 'OKTATASI_PROGRAM', 'PARKLATOGATAS', 'TEMATIKUS_BEMUTATOHELY_LATOGATAS', 'TURAK_KIRANDULASOK'],
  ZENES_TANCOS_RENDEZVENY: ['KULTURALIS_RENDEZVENY', 'KONCERT', 'FESZTIVAL'],
  ETEL: ['REGGELI', 'SZENDVICS', 'ELOETEL', 'LEVES', 'FOETEL', 'KORET', 'SAVANYUSAG_SALATA', 'KOSTOLO', 'PEKSUTEMENY', 'DESSZERT', 'SNACK', 'FOETEL_KORETTEL', 'ETELCSOMAG', 'EGYEB'],
  ALKMENTESITAL_HELYBEN: ['VIZ', 'LIMONADE_SZORP_FACSART', 'ALKOHOLMENTES_KOKTEL', 'TEA_FORROCSOKOLADE', 'ITALCSOMAG', 'KAVE'],
  ALKMENTESITAL_NEM_HELYBEN: ['VIZ', 'ROSTOS_UDITO', 'SZENSAVAS_UDITO', 'SZENSAVMENTES_UDITO', 'ITALCSOMAG'],
  ALKOHOLOSITAL: ['KOKTEL', 'LIKOR', 'PARLAT', 'SOR', 'BOR', 'PEZSGO', 'ITALCSOMAG'],
  EGYEB: ['EGYEB', 'SZERVIZDIJ', 'BORRAVALO', 'EGYEB_VENDEGLATAS'],
};

/** Where a charge item sits in the daily closure (annex 12.3.1–12.3.4). */
export type ChargeSlot =
  | 'night_in_package' | 'night_out_package'
  | 'checkout_in_package' | 'checkout_out_package'
  | 'post_departure' | 'other';

/** Value pairs NOT allowed per slot: "MAIN" bans the whole main category, "MAIN/SUB" one pair. */
const SLOT_EXCLUSIONS: Record<ChargeSlot, string[]> = {
  night_in_package: ['IFA', 'EGYEB/EGYEB_VENDEGLATAS'],
  night_out_package: ['SZALLASDIJ', 'EGYEB/EGYEB_VENDEGLATAS'],
  checkout_in_package: ['IFA', 'SZALLASDIJ', 'EGYEB/EGYEB_VENDEGLATAS'],
  checkout_out_package: ['SZALLASDIJ', 'EGYEB/EGYEB_VENDEGLATAS'],
  post_departure: ['IFA', 'EGYEB/EGYEB_VENDEGLATAS'],
  other: ['SZALLASDIJ', 'IFA'],
};

/** null when the pair is valid for the slot, otherwise a short reason. */
export function categoryProblem(slot: ChargeSlot, main: string, sub: string | null | undefined): string | null {
  const subs = CATEGORIES[main];
  if (!subs) return `Unknown NTAK main category ${main}`;
  if (subs.length === 0 && sub) return `${main} has no subcategory`;
  if (subs.length > 0 && (!sub || !subs.includes(sub))) return `${main} needs one of: ${subs.join(', ')}`;
  const ex = SLOT_EXCLUSIONS[slot];
  if (ex.includes(main) || (sub && ex.includes(`${main}/${sub}`))) return `${sub ? main + '/' + sub : main} is not allowed in ${slot}`;
  return null;
}

/** Annex 12.2: country codes accepted by the PMS interface. */
export const COUNTRY_CODES = new Set((
  'AF AX AL DZ UM US AS VI AD AO AI AQ AG AR AW AU AT AZ BS BH BD BB BE BZ BJ BM BT GW BO BA BW BV BR IO VG BN BG BF BI CL CY KM CK CR CW ' +
  'TD CZ DK ZA GS SS KR DM DO DJ EC GQ AE GB EG CI SV ER MP KP EE ET FK BY FO FJ FI TF GF FR PF PH GA GM GH GI GR GD GL GE GP GU GT GG GN GY ' +
  'HT HM NL HN HK HR IN ID IQ IR IE IS IL JM JP YE JE JO KY KH CM CA CX BQ QA KZ TL KE CN KG KI CC CO CD CG XK CF CU KW LA PL LS LV LB LR LY ' +
  'LI LT LU MK MG HU MO MY MW MV ML MT IM MA MH MQ MR MU YT MX MM FM MD MC MN ME MS MZ NA NR DE NP NI NE NG NU NF NO EH IT OM RU AM PK PW PS ' +
  'PA PG PY PE PN PT PR RE RO RW BL KN LC MF PM VC SB SM ST SC SL SX ES SJ LK SR CH SE WS SA SN SH RS SG SY SK SI SO SD SZ TJ TW TZ TH TG TK ' +
  'TO TR TT TN TC TV TM UG NC NZ UA UY UZ VU VA VE VN WF ZM ZW CV'
).split(' '));

/** Unknown sending country in advance bookings (8.1.1, 9.3.1). */
export const UNKNOWN_FOREIGN_COUNTRY = 'EGYEBKULFOLDI';

/**
 * Annex 12.5 postal-code formats, anchored (NTAK validates the whole value).
 * Dummy values such as 0000, 9999 or 1234 are rejected separately.
 */
export const POSTAL_CODE_PATTERNS: Record<string, RegExp> = Object.fromEntries(Object.entries({
  HU: '[1-9]\\d{3}', DE: '\\d{5}', RO: '\\d{6}', CZ: '[1-7][0-9]{2} [0-9]{2}|[1-7][0-9]{4}',
  GB: '[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}', PL: '\\d{2}-\\d{3}', SK: '\\d{3} \\d{2}|\\d{5}', IT: '\\d{5}',
  AT: '[1-9]\\d{3}', US: '\\d{5}(-\\d{4})?', UA: '\\d{5}', ES: '\\d{5}', IL: '\\d{7}', FR: '\\d{5}', KR: '\\d{5}',
  NL: '[1-9]\\d{3} [A-Z]{2}|[1-9]\\d{3}[A-Z]{2}', CN: '\\d{6}', RS: '\\d{5}|\\d{6}', TR: '\\d{5}', GR: '\\d{3} \\d{2}',
  BE: '\\d{4}', DK: '\\d{4}', HR: '[1-9]\\d{4}', CH: '\\d{4}', IN: '\\d{6}', IE: '[A-Z0-9]{3,4}\\s?[A-Z0-9]{4}',
  SE: '\\d{3} \\d{2}', RU: '\\d{6}', AU: '\\d{4}', BG: '\\d{4}', SI: '\\d{4}', CA: '[A-Za-z]\\d[A-Za-z]\\d[A-Za-z]\\d',
  PT: '\\d{4}-\\d{3}', NO: '\\d{4}', BR: '\\d{5}-\\d{3}', JP: '\\d{3}-\\d{4}', MX: '\\d{5}', FI: '\\d{5}',
  SA: '\\d{5}-\\d{4}', TW: '\\d{3}\\d{0,2}', AE: '\\d*', ID: '[1-9]\\d{4}', QA: '\\d*', MY: '(?!00000|99999)\\d{5}', OM: '(\\d{5})?',
}).map(([k, v]) => [k, new RegExp(`^(?:${v})$`)]));

const DUMMY_POSTAL = /^(0+|9+|1234|12345|123456)$/;

/** null when the postal code passes NTAK's format check (or the country has no rule). */
export function postalCodeProblem(country: string | null | undefined, postal: string | null | undefined): string | null {
  const code = String(postal ?? '').trim();
  if (!code) return 'Postal code is missing';
  if (DUMMY_POSTAL.test(code.replace(/[\s-]/g, ''))) return `Postal code ${code} looks like a dummy value`;
  const re = country ? POSTAL_CODE_PATTERNS[country] : undefined;
  if (re && !re.test(code)) return `Postal code ${code} does not match the ${country} format`;
  return null;
}

/** Accommodation classes used by the extreme-value tables (annex 12.4). */
export const ACCOMMODATION_CLASSES = [
  'hotel_5', 'hotel_4', 'hotel_3', 'hotel_2', 'hotel_1', 'hotel_unrated', 'guesthouse', 'camping',
  'community', 'holiday_home', 'other', 'private', 'holiday_boat',
] as const;
export type AccommodationClass = typeof ACCOMMODATION_CLASSES[number];
export type Region = 'budapest' | 'countryside';

type Pair = [number, number]; // [Budapest, countryside]
const k = (n: number) => n * 1000;
const M = (n: number) => n * 1_000_000;
const same = (n: number): Pair => [n, n];

/** Shared value of the attraction-style main categories per class (12.4.1). */
const ATTRACTION: Record<AccommodationClass, number> = {
  hotel_5: M(2), hotel_4: M(1), hotel_3: k(500), hotel_2: k(200), hotel_1: k(200), hotel_unrated: M(2),
  guesthouse: k(200), camping: k(200), community: k(200), holiday_home: k(200), other: k(200), private: k(200), holiday_boat: k(200),
};
const ATTRACTION_MAINS = ['TERMESZETES_FURDO', 'MUZEUM_VAR_KASTELY', 'TURISZTIKAI_KOZLEKEDES', 'KALANDPARK', 'ALLATKERT', 'VIDAMPARK', 'VEDETT_TERMESZETI_TERULET', 'ZENES_TANCOS_RENDEZVENY'];

/** Primary limits for charges on accommodation revenue (nights, check-out day, post-departure). */
const STAY_LIMITS: Record<AccommodationClass, Record<string, Pair>> = {
  hotel_5: { SZALLASDIJ: [M(4), M(1)], ETEL: [M(1), k(500)], KOZFURDO: same(k(700)), ALKMENTESITAL_HELYBEN: [M(1), k(500)], ALKMENTESITAL_NEM_HELYBEN: [M(1), k(500)], ALKOHOLOSITAL: [M(1), k(500)], EGYEB: same(M(2)) },
  hotel_4: { SZALLASDIJ: same(M(1)), ETEL: same(k(500)), KOZFURDO: same(k(500)), ALKMENTESITAL_HELYBEN: same(k(500)), ALKMENTESITAL_NEM_HELYBEN: same(k(500)), ALKOHOLOSITAL: same(k(500)), EGYEB: same(M(1)) },
  hotel_3: { SZALLASDIJ: same(k(500)), ETEL: same(k(300)), KOZFURDO: same(k(300)), ALKMENTESITAL_HELYBEN: same(k(300)), ALKMENTESITAL_NEM_HELYBEN: same(k(300)), ALKOHOLOSITAL: same(k(300)), EGYEB: same(k(500)) },
  hotel_2: { SZALLASDIJ: same(k(100)), ETEL: same(k(50)), KOZFURDO: same(k(50)), ALKMENTESITAL_HELYBEN: same(k(50)), ALKMENTESITAL_NEM_HELYBEN: same(k(50)), ALKOHOLOSITAL: same(k(50)), EGYEB: same(k(200)) },
  hotel_1: { SZALLASDIJ: same(k(100)), ETEL: same(k(50)), KOZFURDO: same(k(50)), ALKMENTESITAL_HELYBEN: same(k(50)), ALKMENTESITAL_NEM_HELYBEN: same(k(50)), ALKOHOLOSITAL: same(k(50)), EGYEB: same(k(200)) },
  hotel_unrated: { SZALLASDIJ: [M(4), M(1)], ETEL: [M(1), k(500)], KOZFURDO: [k(500), k(700)], ALKMENTESITAL_HELYBEN: [M(1), k(500)], ALKMENTESITAL_NEM_HELYBEN: [M(1), k(500)], ALKOHOLOSITAL: [M(1), k(500)], EGYEB: same(M(2)) },
  guesthouse: { SZALLASDIJ: same(k(300)), ETEL: [k(50), k(200)], KOZFURDO: same(k(50)), ALKMENTESITAL_HELYBEN: [k(50), k(200)], ALKMENTESITAL_NEM_HELYBEN: [k(50), k(200)], ALKOHOLOSITAL: [k(50), k(200)], EGYEB: same(k(200)) },
  camping: { SZALLASDIJ: same(k(300)), ETEL: same(k(50)), KOZFURDO: same(k(50)), ALKMENTESITAL_HELYBEN: same(k(50)), ALKMENTESITAL_NEM_HELYBEN: same(k(50)), ALKOHOLOSITAL: same(k(50)), EGYEB: same(k(200)) },
  community: { SZALLASDIJ: same(k(300)), ETEL: same(k(50)), KOZFURDO: same(k(50)), ALKMENTESITAL_HELYBEN: same(k(50)), ALKMENTESITAL_NEM_HELYBEN: same(k(50)), ALKOHOLOSITAL: same(k(50)), EGYEB: same(k(200)) },
  holiday_home: { SZALLASDIJ: [k(300), k(500)], ETEL: [k(50), k(100)], KOZFURDO: same(k(50)), ALKMENTESITAL_HELYBEN: [k(50), k(100)], ALKMENTESITAL_NEM_HELYBEN: [k(50), k(100)], ALKOHOLOSITAL: [k(50), k(100)], EGYEB: same(k(200)) },
  other: { SZALLASDIJ: same(k(500)), ETEL: [k(50), k(100)], KOZFURDO: same(k(50)), ALKMENTESITAL_HELYBEN: [k(50), k(100)], ALKMENTESITAL_NEM_HELYBEN: [k(50), k(100)], ALKOHOLOSITAL: [k(50), k(100)], EGYEB: same(k(200)) },
  private: { SZALLASDIJ: [k(500), k(300)], ETEL: same(k(50)), KOZFURDO: same(k(50)), ALKMENTESITAL_HELYBEN: same(k(50)), ALKMENTESITAL_NEM_HELYBEN: same(k(50)), ALKOHOLOSITAL: same(k(50)), EGYEB: same(k(200)) },
  holiday_boat: { SZALLASDIJ: same(k(300)), ETEL: same(k(50)), KOZFURDO: same(k(50)), ALKMENTESITAL_HELYBEN: same(k(50)), ALKMENTESITAL_NEM_HELYBEN: same(k(50)), ALKOHOLOSITAL: same(k(50)), EGYEB: same(k(200)) },
};

/** Primary limits for other (non-accommodation) revenue (12.4.1, second table set). */
const OTHER_LIMITS: Record<AccommodationClass, { EGYEB: Pair; ETEL: number; KOZFURDO: Pair; DRINKS: number; ALKOHOLOSITAL: number; ATTR: number; ZENES: number }> = {
  hotel_5: { EGYEB: [M(100), M(50)], ETEL: M(20), KOZFURDO: [M(2), M(5)], DRINKS: M(20), ALKOHOLOSITAL: M(20), ATTR: M(2), ZENES: M(2) },
  hotel_4: { EGYEB: same(M(20)), ETEL: M(20), KOZFURDO: [M(2), M(5)], DRINKS: M(20), ALKOHOLOSITAL: M(20), ATTR: M(1), ZENES: M(1) },
  hotel_3: { EGYEB: same(M(5)), ETEL: M(20), KOZFURDO: [M(1), M(5)], DRINKS: M(20), ALKOHOLOSITAL: M(20), ATTR: k(500), ZENES: k(500) },
  hotel_2: { EGYEB: same(M(2)), ETEL: M(2), KOZFURDO: same(k(500)), DRINKS: M(2), ALKOHOLOSITAL: M(2), ATTR: k(200), ZENES: k(500) },
  hotel_1: { EGYEB: same(M(2)), ETEL: M(1), KOZFURDO: same(k(500)), DRINKS: M(1), ALKOHOLOSITAL: M(1), ATTR: k(200), ZENES: k(500) },
  hotel_unrated: { EGYEB: [M(100), M(50)], ETEL: M(20), KOZFURDO: [M(2), M(5)], DRINKS: M(20), ALKOHOLOSITAL: M(20), ATTR: M(2), ZENES: M(2) },
  guesthouse: { EGYEB: same(M(1)), ETEL: M(5), KOZFURDO: same(k(500)), DRINKS: M(5), ALKOHOLOSITAL: M(5), ATTR: k(200), ZENES: k(500) },
  camping: { EGYEB: same(M(1)), ETEL: M(1), KOZFURDO: same(k(500)), DRINKS: M(1), ALKOHOLOSITAL: M(1), ATTR: k(200), ZENES: k(500) },
  community: { EGYEB: same(M(2)), ETEL: M(1), KOZFURDO: same(k(500)), DRINKS: M(1), ALKOHOLOSITAL: M(1), ATTR: k(200), ZENES: k(500) },
  holiday_home: { EGYEB: same(M(1)), ETEL: M(1), KOZFURDO: same(k(500)), DRINKS: M(1), ALKOHOLOSITAL: M(1), ATTR: k(200), ZENES: k(500) },
  other: { EGYEB: same(M(1)), ETEL: M(1), KOZFURDO: same(k(500)), DRINKS: M(1), ALKOHOLOSITAL: M(1), ATTR: k(200), ZENES: k(500) },
  private: { EGYEB: same(M(1)), ETEL: M(1), KOZFURDO: same(k(500)), DRINKS: M(1), ALKOHOLOSITAL: M(1), ATTR: k(200), ZENES: k(500) },
  holiday_boat: { EGYEB: same(M(1)), ETEL: M(1), KOZFURDO: same(k(500)), DRINKS: M(1), ALKOHOLOSITAL: M(1), ATTR: k(200), ZENES: k(500) },
};

/** Primary limit for a single spending (payment) item (12.4.1, last table). */
export function primarySpendingLimit(cls: AccommodationClass): number {
  if (['hotel_5', 'hotel_4', 'hotel_3', 'hotel_unrated'].includes(cls)) return M(100);
  if (['hotel_2', 'hotel_1', 'guesthouse', 'community'].includes(cls)) return M(30);
  return M(10);
}

/** Primary limit for one charge item; the secondary limit is 10x (9.1.5). */
export function primaryChargeLimit(cls: AccommodationClass, region: Region, slot: ChargeSlot, main: string): number | null {
  const i = region === 'budapest' ? 0 : 1;
  if (main === 'IFA') return null; // IFA is checked arithmetically, not by limits
  if (slot === 'other') {
    const o = OTHER_LIMITS[cls];
    if (main === 'EGYEB') return o.EGYEB[i];
    if (main === 'ETEL') return o.ETEL;
    if (main === 'KOZFURDO') return o.KOZFURDO[i];
    if (main === 'ALKMENTESITAL_HELYBEN' || main === 'ALKMENTESITAL_NEM_HELYBEN') return o.DRINKS;
    if (main === 'ALKOHOLOSITAL') return o.ALKOHOLOSITAL;
    if (main === 'ZENES_TANCOS_RENDEZVENY') return o.ZENES;
    return ATTRACTION_MAINS.includes(main) ? o.ATTR : null;
  }
  const row = STAY_LIMITS[cls];
  if (row[main]) return row[main][i];
  return ATTRACTION_MAINS.includes(main) ? ATTRACTION[cls] : null;
}

/** Advance-booking gross amount limits (9.3.7). */
export const BOOKING_AMOUNT_PRIMARY = 100_000_000;
export const BOOKING_AMOUNT_SECONDARY = 1_000_000_000;

/** NTAK error keys (9.5, 7.3.3) with a short English explanation for the UI. */
export const ERROR_KEYS: Record<string, string> = {
  NemUres: 'The field cannot be empty.',
  KotelezoMezo: 'The field cannot be null.',
  Formatum: 'The value does not meet the formal requirements.',
  TipusElteres: 'The value does not meet the formal requirements.',
  ElsodlegesMax: 'Above the primary extreme value limit (suspicious, accepted with a warning).',
  ElsodlegesMin: 'Below the primary extreme value limit (suspicious, accepted with a warning).',
  MasodlagosMax: 'Above the secondary extreme value limit: correct the data and resend.',
  MasodlagosMin: 'Below the secondary extreme value limit: correct the data and resend.',
  HibasErtek: 'The field contains an incorrect value.',
  Negativ: 'The value cannot be negative.',
  NegativTerhelesHiba: 'Charges cannot be negative.',
  EgyedisegKorlatozas: 'This value was already sent (duplicate). Send corrections as a modified version.',
  IsmetlodoAzonosito: 'The same guest ID appears more than once in the message.',
  JovobeliDatum: 'The date cannot be in the future.',
  JovobeniErkezes: 'Arrival cannot be more than 2 years in the future.',
  MultbeliTavozas: 'Departure cannot be earlier than arrival.',
  MultbeliDatum: 'The date cannot be in the past.',
  NemTalalhato: 'Not found in the NTAK database.',
  MagasEletkor: 'Guest age is over 100 years: please double-check.',
  HibasSzuletesiEv: 'Year of birth cannot be more than 110 years ago.',
  ErvenytelenIfa: 'Tourism tax amount does not match the accommodation fee x rate (or guests x rate).',
  TargynaponErvenyesIfa: 'Check that the tourism tax rate matches the municipal rate valid on that day.',
  KotelezoSzallasdij: 'An accommodation fee charge is mandatory when guests stay in the unit.',
  HibasOrszagKod: 'Country code is not a valid ISO code.',
  FoglalasOrszagKod: 'Booking country must be ISO-2, or EGYEBKULFOLDI when unknown.',
  IrszHiba: "Postal code does not match the country's format.",
  NappaliHasznalatHiba: 'A unit can appear only once per day with nappaliHasznalat=false.',
  ElteresRegisztraltAdatokban: 'Differs from the NTAK registration data (room or bed counts).',
  SzerverHiba: 'NTAK server error: resend the message.',
  AdatszolgaltatasTiltva: 'NTAK suspended data transfer for this accommodation: contact NTAK support.',
  JavithatosagIdokorlat: 'Corrections are only accepted for 15 months back.',
  HibasKitoltes: 'Spending subtype must be empty unless the payment is SZÉP card.',
  HibasKategoria: 'Main/subcategory not allowed for this message unit.',
  nemUzemeloSzobak: 'When closed, all rooms must be reported as out-of-order.',
  FeldolgozasHiba: 'Partially processed by NTAK: resend as a corrected version.',
  UresMezo: 'This field must be left blank.',
  NemKuldendoElem: 'This item should not be sent.',
  ifaTipusHiba: 'Tourism tax type differs from the municipal setting valid that day.',
  lemondasFrissites: 'A cancelled booking was cancelled again: not accepted.',
  MarLetezoUjZaras: "An accepted 'UJ' closure already exists for this day: send 'MODOSITO'.",
  ErvenytelenModositoZaras: "No accepted closure yet for this day: the first one must be 'UJ'.",
  OsszesSzobaszamEllentmondas: 'All rooms must equal available + out-of-order + out-of-service.',
  KiadottDarabszamElteres: 'Sold units listed (excluding day use) must equal rooms rented out.',
  TobbKiadott: 'Rooms rented out cannot exceed rooms available.',
  FerohelyekEllentmondasa: 'Total capacity must equal available + out-of-order + out-of-service capacity.',
  HibasFerohelyOsszeg: 'Total rooms cannot exceed total bed capacity.',
  UzemenKivuliSzobakSzama: 'Listed out-of-service units must equal OOO + OOS rooms.',
  HibasKiadhatoHelySzam: 'Available rooms cannot exceed available capacity.',
  HibasKiadottHelySzam: 'Rented rooms cannot exceed the capacity of rented rooms.',
  HibasOosOsszeg: 'OOS rooms cannot exceed OOS capacity.',
  HibasOooOsszeg: 'OOO rooms cannot exceed OOO capacity.',
  HianyzoIfaMertek: 'The municipality has not set a tourism tax rate in NTAK.',
  FoglalasSzintuIfa: 'Booking-level tourism tax total does not match the expected amount.',
  IfaTerhelesHianya: 'Tourism tax charge missing for a taxable guest.',
  AdatszolgaltatasIdokorlat: 'The day is outside the valid reporting period.',
  NemHatalyosIfaMentesseg: 'Tourism tax exemption code not valid on that day for this municipality.',
  HianyzoSzolgaltatoAdatokAdoszam: 'Service provider tax number not found in NTAK.',
  NemTalalhatoPms: 'PMS software ID not found in NTAK.',
  ElteroKuldorendszer: 'The PMS software is not registered for this accommodation.',
  NemTalalhatoSzolgaltatasiHely: 'Accommodation (service location) not found in NTAK.',
  HianyzoAlairas: 'The request has no digital signature.',
  HibasAlgoritmus: 'Signature algorithm not accepted.',
  UresTanusitvany: 'No certificate in the request.',
  TanusitvanyTipusHiba: 'Certificate type is not valid.',
  ElteresCNadatok: 'Certificate CN does not match the registration number / software ID.',
  ElteresCnAdatok: 'Certificate CN does not match the registration number / software ID.',
  ElteresOUadatok: 'Certificate OU (data reporting ID) not found.',
  ElteresOIDadatok: 'Certificate tax number does not match the provider tax number.',
  NemMegbizhatoTanusitvany: 'The certificate is not trusted.',
  ErvenytelenIdobelyeg: 'Timestamp invalid: the message must arrive within 300 s of creation.',
  FAILED_CHECK: 'Signature check failed.',
};

/** Error keys meaning "do not retry automatically": certificate/registration problems. */
export const STOP_SENDING_KEYS = new Set([
  'AdatszolgaltatasTiltva', 'UresTanusitvany', 'TanusitvanyTipusHiba', 'ElteresCNadatok', 'ElteresCnAdatok',
  'ElteresOUadatok', 'ElteresOIDadatok', 'NemMegbizhatoTanusitvany', 'NemTalalhatoPms', 'ElteroKuldorendszer',
  'NemTalalhatoSzolgaltatasiHely', 'HianyzoSzolgaltatoAdatokAdoszam',
]);
