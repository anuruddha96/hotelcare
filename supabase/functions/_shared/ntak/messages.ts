/**
 * NTAK PMS interface v9 request builders (element order follows the v9 WSDL
 * schemas NTAK sent on ticket 150439, see testdata/wsdl). Pure functions:
 * plain objects in, request XML out.
 *
 * Output is shaped like exclusive-c14n output (namespace declared on the root
 * request element, no whitespace between tags, no self-closing tags, text
 * escaped the way c14n escapes it) so the WS-Security digest computed over
 * these bytes matches what NTAK's verifier canonicalizes.
 */
import { NTAK_NS } from './codes.ts';
import type { IfaType, MarketSegment, PaymentType, SalesChannel, Sex, UnitType, VatRate } from './codes.ts';

export interface NtakCommon {
  uzenetId: string;
  sentAt: Date | string;
  softwareVersion: string;
  softwareId: string;
  registrationNumber: string;
  taxNumber: string;
  accommodationName: string;
  providerName: string;
}

export interface NtakUnit {
  building: string;
  roomNumber: string;
  unitType: UnitType;
  singleBeds: number;
  doubleBeds: number;
  extraBeds?: number | null;
}

export interface NtakGuest {
  vendegId: string;
  birthYear: number;
  sex: Sex;
  nationality: string;
  residenceCountry: string;
  postalCode: string;
  ifaStatus: string;
}

export interface NtakCharge { amount: number; main: string; sub?: string | null; vat: VatRate }
export interface NtakPayment { amount: number; type: PaymentType; szepAccommodation?: boolean }

export interface NtakSoldUnit {
  unit?: NtakUnit | null;
  bookingNo: string;
  segment: MarketSegment;
  channel: SalesChannel;
  payments: NtakPayment[];
  inPackage: NtakCharge[];
  outPackage: NtakCharge[];
}

export interface NtakNight { sold?: NtakSoldUnit | null; guests: NtakGuest[]; dayUse: boolean }

export interface NtakRoomCounts { total: number; ooo: number; oos: number; rented: number; available: number }

export interface NtakDailyClosure {
  day: string;
  classification: 'UJ' | 'MODOSITO';
  protocolId?: string | null;
  reason?: string | null;
  closedAt: Date | string;
  closed: boolean;
  rooms: NtakRoomCounts;
  capacity: NtakRoomCounts;
  ifa?: { type: IfaType; rate: number } | null;
  nights: NtakNight[];
  outOfService: NtakUnit[];
  checkoutSales: NtakSoldUnit[];
  otherCharges: NtakCharge[];
  otherPayments: NtakPayment[];
  postStayPayments: { bookingNo: string; date: string; payment: NtakPayment }[];
  postStayCharges: { bookingNo: string; date: string; charge: NtakCharge }[];
}

export interface NtakBooking {
  bookingNo: string;
  eventCreatedAt: Date | string;
  guaranteed: boolean | null;
  cancelled: boolean;
  originCountry: string;
  arrival: string;
  departure: string;
  bookedAt: Date | string;
  channel: SalesChannel;
  grossAmount: number;
  units: { unitType: UnitType; capacity: number }[];
  segment: MarketSegment;
  guestCount?: number | null;
}

export type NtakStayEvent =
  | { kind: 'erkezett' | 'tavozott'; at: Date | string; bookingNo: string; guests: NtakGuest[]; unit: NtakUnit }
  | { kind: 'lakoegysegetCserelt'; at: Date | string; bookingNo: string; guests: NtakGuest[]; from: NtakUnit; to: NtakUnit };

// ---------------------------------------------------------------------------
// c14n-safe XML primitives

// deno-lint-ignore no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** Escape text content exactly like exclusive c14n renders it. */
export function escText(value: string): string {
  return value.replace(INVALID_XML, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
}

/** Collapse whitespace and drop control characters (NTAK rejects them in names). */
export function cleanText(value: unknown): string {
  return String(value ?? '').replace(INVALID_XML, '').replace(/[\t\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const P = 'v9:';
export const el = (name: string, inner: string) => `<${P}${name}>${inner}</${P}${name}>`;
export const txt = (name: string, value: unknown) => el(name, escText(cleanText(value)));
const opt = (name: string, value: unknown) => (value === null || value === undefined || value === '' ? '' : txt(name, value));
const int = (name: string, value: number) => el(name, String(Math.trunc(Number(value) || 0)));
const bool = (name: string, value: boolean) => el(name, value ? 'true' : 'false');

/** xs:double amount, max 2 decimals, never exponent notation. */
export function formatAmount(value: number): string {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(2).replace(/\.?0+$/, '');
}

/** ISO 8601 with second precision and zone (9.1.6), e.g. 2024-03-27T08:04:09Z. */
export function xsDateTime(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date-time: ${value}`);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const root = (name: string, inner: string) => `<${P}${name} xmlns:v9="${NTAK_NS}">${inner}</${P}${name}>`;

/** Max255LengthStringType (whitespace collapsed): longer values are refused before sending. */
function max255(field: string, value: unknown): string {
  const text = cleanText(value);
  if (text.length > 255) throw new Error(`${field} is longer than 255 characters`);
  return text;
}

function header(c: NtakCommon): string {
  return el('uzenetAdatok', txt('uzenetId', c.uzenetId) + el('uzenetKuldesIdeje', xsDateTime(c.sentAt)))
    + el('szoftverAdatok', txt('szoftverVerzio', c.softwareVersion) + txt('szoftverAzonosito', c.softwareId))
    + el('szallashely', txt('szallasRegisztraciosSzam', c.registrationNumber) + txt('szallashelySzolgaltatoAdoszam', c.taxNumber)
      + txt('szallasNev', max255('szallasNev', c.accommodationName)) + txt('szallashelySzolgaltatoNev', max255('szallashelySzolgaltatoNev', c.providerName)));
}

export function unitXml(name: string, u: NtakUnit): string {
  return el(name,
    txt('epulet', u.building) + txt('szobaszam', u.roomNumber) + txt('tipus', u.unitType)
    + int('egyfosAgySzam', u.singleBeds) + int('ketfosAgySzam', u.doubleBeds)
    + (u.extraBeds === null || u.extraBeds === undefined ? '' : int('potAgySzam', u.extraBeds)));
}

export function guestXml(name: string, g: NtakGuest): string {
  return el(name,
    txt('vendegId', g.vendegId) + int('szuletesiEv', g.birthYear) + txt('nem', g.sex)
    + txt('allampolgarsagOrszagKod', g.nationality) + txt('lakohelyOrszagKod', g.residenceCountry)
    + txt('lakohelyIranyitoszam', g.postalCode) + txt('ifaStatusz', g.ifaStatus));
}

function chargeXml(name: string, ch: NtakCharge): string {
  return el(name,
    el('osszeg', formatAmount(ch.amount)) + txt('fokategoria', ch.main) + opt('alkategoria', ch.sub)
    + el('afaKulcs', el('szazalek', String(ch.vat))));
}

function paymentXml(name: string, p: NtakPayment): string {
  return el(name,
    el('osszeg', formatAmount(p.amount)) + txt('koltesTipus', p.type)
    + (p.type === 'SZEP_KARTYA' && p.szepAccommodation !== false ? txt('koltesAlTipus', 'SZALLASHELY') : ''));
}

function soldUnitXml(s: NtakSoldUnit): string {
  const charges = (s.inPackage.length ? el('csomagbeliTerhelesek', s.inPackage.map((c) => chargeXml('csomagbeliTerheles', c)).join('')) : '')
    + (s.outPackage.length ? el('csomagonkivuliTerhelesek', s.outPackage.map((c) => chargeXml('csomagonkivuliTerheles', c)).join('')) : '');
  return el('ertekesitettLakoegyseg',
    (s.unit ? unitXml('lakoegyseg', s.unit) : '')
    + txt('foglalasiSzam', s.bookingNo) + txt('piaciSzegmens', s.segment) + txt('ertekesitesiCsatorna', s.channel)
    + (s.payments.length ? el('koltesek', s.payments.map((p) => paymentXml('koltes', p)).join('')) : '')
    + (charges ? el('terhelesek', charges) : ''));
}

function counts(names: string[], c: NtakRoomCounts): string {
  const v = [c.total, c.ooo, c.oos, c.rented, c.available];
  return names.map((n, i) => int(n, v[i])).join('');
}

// ---------------------------------------------------------------------------
// Requests

export function buildNapiZarasRequest(c: NtakCommon, z: NtakDailyClosure): string {
  const besorolas = txt('besorolas', z.classification)
    // A new (UJ) closure carries no record ID at all: the NTAK test server answers an empty
    // <jegyzokonyvAzonosito/> with NemKuldendoElem ("Az elem nem küldendő!"), 26 Nov 2026.
    + (z.classification === 'MODOSITO' ? opt('jegyzokonyvAzonosito', z.protocolId) + opt('indoklas', z.reason) : '');
  const nights = z.nights.map((n) => el('lakoegysegEjszaka',
    (n.sold ? soldUnitXml(n.sold) : '')
    + el('vendegek', n.guests.map((g) => guestXml('vendeg', g)).join(''))
    + bool('nappaliHasznalat', n.dayUse))).join('');
  const body = txt('lezartNap', z.day)
    + el('napiZarasBesorolas', besorolas)
    + el('lezarasIdopont', xsDateTime(z.closedAt))
    + bool('szallashelyNemUzemel', z.closed)
    + el('szobaAdatok', counts(['osszesSzoba', 'oooSzobak', 'oosSzobak', 'kiadottSzobak', 'kiadhatoSzobak'], z.rooms))
    + el('ferohelyAdatok', counts(['osszesFerohelyKapacitas', 'oooFerohelyKapacitas', 'oosFerohelyKapacitas', 'kiadottFerohelyKapacitas', 'kiadhatoFerohelyKapacitas'], z.capacity))
    // NTAK refuses <ifaAdatok> on a closed day (szallashelyNemUzemel=true) with NemKuldendoElem, 28 Nov 2026.
    + (z.ifa && !z.closed ? el('ifaAdatok', txt('ifaTipusa', z.ifa.type) + el('ifaMertek', formatAmount(z.ifa.rate))) : '')
    + (z.nights.length ? el('lakoegysegEjszakak', nights) : '')
    + (z.outOfService.length ? el('uzemenKivuliSzobak', z.outOfService.map((u) => unitXml('lakoegyseg', u)).join('')) : '')
    + z.checkoutSales.map((s) => el('kijelentkezesNapiErtekesitesek', soldUnitXml(s))).join('')
    + (z.otherCharges.length ? el('egyebTerhelesek', z.otherCharges.map((ch) => chargeXml('egyebTerheles', ch)).join('')) : '')
    + (z.otherPayments.length ? el('egyebKoltesek', z.otherPayments.map((p) => paymentXml('egyebKoltes', p)).join('')) : '')
    + (z.postStayPayments.length ? el('tartozkodastKovetoKoltesek', z.postStayPayments.map((p) => el('tartozkodastKovetoKoltes',
      txt('foglalasiSzam', p.bookingNo) + txt('datum', p.date) + paymentXml('koltes', p.payment))).join('')) : '')
    + (z.postStayCharges.length ? el('tartozkodastKovetoTerhelesek', z.postStayCharges.map((p) => el('tartozkodastKovetoTerheles',
      txt('foglalasiSzam', p.bookingNo) + txt('datum', p.date) + chargeXml('terheles', p.charge))).join('')) : '');
  return root('napiZarasRequest', header(c) + el('napiFeltoltes', body));
}

export function buildFoglalasEsemenyRequest(c: NtakCommon, b: NtakBooking): string {
  const body = txt('foglalasiSzam', b.bookingNo)
    + el('esemenyLetrejotte', xsDateTime(b.eventCreatedAt))
    + (b.guaranteed === null
      ? `<${P}garantaltFoglalas xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="true"></${P}garantaltFoglalas>`
      : bool('garantaltFoglalas', b.guaranteed))
    + bool('lemondva', b.cancelled)
    + txt('vendegKuldoOrszaga', b.originCountry)
    + txt('erkezes', b.arrival) + txt('tavozas', b.departure)
    + el('foglalasIdopont', xsDateTime(b.bookedAt))
    + txt('ertekesitesiCsatorna', b.channel)
    + int('foglalasBruttoOsszege', Math.round(b.grossAmount))
    + el('foglaltLakoegysegek', b.units.map((u) => el('foglaltLakoegyseg', txt('tipus', u.unitType) + int('ferohelyKapacitas', u.capacity))).join(''))
    + txt('piaciSzegmens', b.segment)
    + (b.guestCount === null || b.guestCount === undefined ? '' : int('vendegszam', b.guestCount));
  return root('foglalasEsemenyRequest', header(c) + el('foglalasEsemeny', body));
}

export function buildEsemenyvezereltRequest(c: NtakCommon, events: NtakStayEvent[]): string {
  const part = (kind: NtakStayEvent['kind']) => events.filter((e) => e.kind === kind).map((e) => {
    // One <vendegek> list with a <vendeg> per guest (VendegekType in the WSDL NTAK sent on 26 Nov 2026).
    const head = el('idopont', xsDateTime(e.at)) + txt('foglalasiSzam', e.bookingNo) + el('vendegek', e.guests.map((g) => guestXml('vendeg', g)).join(''));
    return el(kind, e.kind === 'lakoegysegetCserelt'
      ? head + unitXml('elhagyottLakoegyseg', e.from) + unitXml('elfoglaltLakoegyseg', e.to)
      : head + unitXml('lakoegyseg', e.unit));
  }).join('');
  return root('esemenyvezereltAdatkuldesRequest',
    header(c) + el('esemenyek', part('erkezett') + part('tavozott') + part('lakoegysegetCserelt')));
}

export function buildEllenorzesRequest(c: NtakCommon, processingIds: string[]): string {
  if (!processingIds.length) throw new Error('ellenorzes needs at least one processing id');
  return root('ellenorzesRequest',
    header(c) + el('feldolgozasAzonositok', processingIds.map((id) => txt('feldolgozasAzonosito', id)).join('')));
}

export function buildAdatszolgaltatasKezdoDatumRequest(c: NtakCommon): string {
  return root('adatszolgaltatasKezdoDatumRequest', header(c));
}
