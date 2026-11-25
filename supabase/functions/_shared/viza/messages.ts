/**
 * VIZA / THF message building (PMS–THF–VIZA fejlesztői segédlet v700).
 *
 * Pure functions: guest rows in, SOAP body XML + the accommodation validation
 * string (ellenorzoString) out. No I/O and no crypto here, so everything is
 * unit-tested from vitest; signing and transport live in the edge function.
 *
 * Spec notes implemented here:
 *  - arrival carries the guest's details; departure only references the
 *    arrival's UUID (erkezesAzonosito) plus the departure time;
 *  - data read from the document (okmanybolBeolvasottAdat) is kept separate
 *    from manually entered/corrected data (manualisanRogzitettAdat);
 *  - name fields travel in PAIRS (családnév+utónév, születési pár, anyja pár):
 *    if either half of a pair is entered manually, both halves go into the
 *    manual group even when one is unchanged;
 *  - ellenorzoString = adatszolgaltatasiAzonosito|erkezesAzonosito...|bejelentesIdopontja
 *    joined with '|', then SHA-256 + RSA-signed with the hotel's NTAK cert
 *    (the signing itself is done by the caller).
 */

export interface VizaHotel {
  adatszolgaltatasiAzonosito: string; // 8-char NTAK data-provision id
  szallasNev: string;
  szallashelySzolgaltatoAdoszam: string; // 12345678-1-12
  szallashelySzolgaltatoNev: string;
}

/** Guest fields in VIZA vocabulary. All optional: only what the source held. */
export interface VizaGuestFields {
  csaladnev?: string | null;
  utonev?: string | null;
  szuletesiCsaladnev?: string | null;
  szuletesiUtonev?: string | null;
  szuletesiDatum?: string | null; // YYYY-MM-DD
  szuletesiHely?: string | null;
  anyjaCsaladnev?: string | null;
  anyjaUtonev?: string | null;
  allampolgarsagKod?: string | null; // ISO 3166-1 alpha-2
  nem?: 'NO' | 'FERFI' | 'EGYEB_VAGY_NEM_ISMERT' | null;
  okmanyTipus?: 'SZEM_IG' | 'UTLEVEL' | 'VEZ_ENG' | 'EGYEB' | null;
  okmanyAzonositoSzam?: string | null;
}

export interface VizaArrivalGuest {
  erkezesAzonosito: string; // UUID, reused on departure
  erkezesIdeje: string; // ISO datetime with zone
  tavozasVarhatoDatuma: string; // YYYY-MM-DD
  scanned?: VizaGuestFields | null;
  manual?: VizaGuestFields | null;
  vizumEngedelySzam?: string | null;
  beutazasDatuma?: string | null;
  beutazasHelye?: string | null;
}

export interface VizaDepartureGuest {
  erkezesAzonosito: string;
  tavozasIdeje: string; // ISO datetime with zone
}

const FIELD_ORDER: (keyof VizaGuestFields)[] = [
  'csaladnev', 'utonev', 'szuletesiCsaladnev', 'szuletesiUtonev', 'szuletesiDatum',
  'szuletesiHely', 'anyjaCsaladnev', 'anyjaUtonev', 'allampolgarsagKod', 'nem',
  'okmanyTipus', 'okmanyAzonositoSzam',
];

const NAME_PAIRS: [keyof VizaGuestFields, keyof VizaGuestFields][] = [
  ['csaladnev', 'utonev'],
  ['szuletesiCsaladnev', 'szuletesiUtonev'],
  ['anyjaCsaladnev', 'anyjaUtonev'],
];

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const tag = (name: string, value: string | null | undefined): string =>
  value === null || value === undefined || value === '' ? '' : `<v1:${name}>${escapeXml(String(value))}</v1:${name}>`;

const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '';

/**
 * Apply the name-pair rule: when either half of a name pair appears in the
 * manual group, pull the other half in too (from scanned when needed), so the
 * message never carries half a name manually.
 */
export function applyNamePairRule(scanned: VizaGuestFields | null | undefined, manual: VizaGuestFields | null | undefined): VizaGuestFields | null {
  if (!manual) return manual ?? null;
  const out: VizaGuestFields = { ...manual };
  for (const [a, b] of NAME_PAIRS) {
    const hasA = has(out[a]);
    const hasB = has(out[b]);
    if (hasA !== hasB) {
      const missing = hasA ? b : a;
      const fallback = scanned?.[missing];
      if (has(fallback)) (out as Record<string, unknown>)[missing] = fallback;
    }
  }
  return out;
}

function guestFieldsXml(groupName: 'okmanybolBeolvasottAdat' | 'manualisanRogzitettAdat', fields: VizaGuestFields | null | undefined): string {
  if (!fields) return '';
  const inner = FIELD_ORDER.map((key) => tag(key, fields[key] as string | null | undefined)).join('');
  if (!inner) return '';
  return `<v1:${groupName}>${inner}</v1:${groupName}>`;
}

/** Validation string the hotel signs: id | arrival uuid(s)… | report time. */
export function buildEllenorzoString(adatszolgaltatasiAzonosito: string, erkezesAzonositok: string[], bejelentesIdopontja: string): string {
  return [adatszolgaltatasiAzonosito, ...erkezesAzonositok, bejelentesIdopontja].join('|');
}

function hotelXml(hotel: VizaHotel): string {
  return '<v1:szallashely>'
    + tag('adatszolgaltatasiAzonosito', hotel.adatszolgaltatasiAzonosito)
    + tag('szallasNev', hotel.szallasNev)
    + tag('szallashelySzolgaltatoAdoszam', hotel.szallashelySzolgaltatoAdoszam)
    + tag('szallashelySzolgaltatoNev', hotel.szallashelySzolgaltatoNev)
    + '</v1:szallashely>';
}

function validationXml(ellenorzoString: string, alairas: string, alairoTanusitvany: string): string {
  return '<v1:pmsValidaciosUzenet>'
    + tag('ellenorzoString', ellenorzoString)
    + tag('alairoTanusitvany', alairoTanusitvany)
    + tag('alairas', alairas)
    + '</v1:pmsValidaciosUzenet>';
}

export interface EnvelopeCommon {
  uzenetAzonosito: string; // UUID
  hotel: VizaHotel;
  bejelentesIdopontja: string; // ISO datetime with zone
  alairas: string; // base64 RSA-SHA256 signature of ellenorzoString
  alairoTanusitvany: string; // base64 DER of the hotel's signing certificate
}

/** Arrival request body (spec 4.2; 1–10 guests per message). */
export function buildArrivalBody(common: EnvelopeCommon, guests: VizaArrivalGuest[]): { xml: string; ellenorzoString: string } {
  if (guests.length < 1 || guests.length > 10) throw new Error('Arrival message must carry 1–10 guests');
  const ellenorzoString = buildEllenorzoString(
    common.hotel.adatszolgaltatasiAzonosito,
    guests.map((g) => g.erkezesAzonosito),
    common.bejelentesIdopontja,
  );
  const guestXml = guests.map((g) => {
    const manual = applyNamePairRule(g.scanned, g.manual);
    return '<v1:erkezoVendeg>'
      + tag('erkezesAzonosito', g.erkezesAzonosito)
      + tag('erkezesIdeje', g.erkezesIdeje)
      + tag('tavozasVarhatoDatuma', g.tavozasVarhatoDatuma)
      + guestFieldsXml('manualisanRogzitettAdat', manual)
      + guestFieldsXml('okmanybolBeolvasottAdat', g.scanned)
      + tag('vizumEngedelySzam', g.vizumEngedelySzam)
      + tag('beutazasDatuma', g.beutazasDatuma)
      + tag('beutazasHelye', g.beutazasHelye)
      + '</v1:erkezoVendeg>';
  }).join('');
  const xml = '<v1:erkezesiAdatokBekuldeseRequest xmlns:v1="http://vizainfo.hu/thf/v1"><v1:keresAdat>'
    + tag('uzenetAzonosito', common.uzenetAzonosito)
    + hotelXml(common.hotel)
    + tag('bejelentesIdopontja', common.bejelentesIdopontja)
    + validationXml(ellenorzoString, common.alairas, common.alairoTanusitvany)
    + guestXml
    + '</v1:keresAdat></v1:erkezesiAdatokBekuldeseRequest>';
  return { xml, ellenorzoString };
}

/** Departure request body (spec 4.3). */
export function buildDepartureBody(common: EnvelopeCommon, guests: VizaDepartureGuest[]): { xml: string; ellenorzoString: string } {
  if (guests.length < 1 || guests.length > 10) throw new Error('Departure message must carry 1–10 guests');
  const ellenorzoString = buildEllenorzoString(
    common.hotel.adatszolgaltatasiAzonosito,
    guests.map((g) => g.erkezesAzonosito),
    common.bejelentesIdopontja,
  );
  const guestXml = guests.map((g) =>
    '<v1:tavozoVendeg>'
    + tag('erkezesAzonosito', g.erkezesAzonosito)
    + tag('tavozasIdeje', g.tavozasIdeje)
    + '</v1:tavozoVendeg>').join('');
  const xml = '<v1:tavozasiAdatokBekuldeseRequest xmlns:v1="http://vizainfo.hu/thf/v1"><v1:keresAdat>'
    + tag('uzenetAzonosito', common.uzenetAzonosito)
    + hotelXml(common.hotel)
    + tag('bejelentesIdopontja', common.bejelentesIdopontja)
    + validationXml(ellenorzoString, common.alairas, common.alairoTanusitvany)
    + guestXml
    + '</v1:keresAdat></v1:tavozasiAdatokBekuldeseRequest>';
  return { xml, ellenorzoString };
}

export const buildStatusBody = (): string =>
  '<v1:allapotLekerdezesRequest xmlns:v1="http://vizainfo.hu/thf/v1"></v1:allapotLekerdezesRequest>';

export const buildUnsentListBody = (kind: 'NEMBEKULDOTT' | 'HIBAS'): string =>
  `<v1:bekuldetlenAdatListaRequest xmlns:v1="http://vizainfo.hu/thf/v1"><v1:bekuldetlenAdatTipus>${kind}</v1:bekuldetlenAdatTipus></v1:bekuldetlenAdatListaRequest>`;

/** ISO 8601 with milliseconds and numeric zone, as every spec example shows. */
export function vizaTimestamp(date: Date, timeZone = 'Europe/Budapest'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date).reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour === '24' ? '00' : parts.hour), Number(parts.minute), Number(parts.second),
  );
  const offsetMin = Math.round((asUtc - (date.getTime() - date.getMilliseconds())) / 60000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}.${ms}${offset}`;
}

/** Simple response readers (THF responses are small and namespaced ns2). */
export function readXmlTag(xml: string, tagName: string): string | null {
  const match = xml.match(new RegExp(`<(?:[A-Za-z0-9]+:)?${tagName}[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?${tagName}>`));
  return match ? match[1].trim() : null;
}

export function readXmlTags(xml: string, tagName: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<(?:[A-Za-z0-9]+:)?${tagName}[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?${tagName}>`, 'g');
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(m[1].trim());
  return out;
}

export interface UnsentListResult {
  eredmenyKod: string | null;
  fault: string | null;
  items: Array<Record<string, string>>;
}

/** bekuldetlenAdatListaResponse: result code plus 0..n entries, every child element kept by name. */
export function parseUnsentList(xml: string): UnsentListResult {
  // Exact element name: readXmlTags would also match the bekuldetlenAdatListaResponse root.
  const entries: string[] = [];
  const entryRe = /<(?:[A-Za-z0-9]+:)?bekuldetlenAdat(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?bekuldetlenAdat>/g;
  for (let m = entryRe.exec(xml); m; m = entryRe.exec(xml)) entries.push(m[1]);
  const items = entries.map((entry) => {
    const row: Record<string, string> = {};
    const re = /<(?:[A-Za-z0-9]+:)?([A-Za-z0-9]+)[^>]*>([^<]*)<\/(?:[A-Za-z0-9]+:)?\1>/g;
    for (let m = re.exec(entry); m; m = re.exec(entry)) row[m[1]] = m[2].trim();
    return row;
  });
  return { eredmenyKod: readXmlTag(xml, 'eredmenyKod'), fault: readXmlTag(xml, 'faultstring'), items };
}
