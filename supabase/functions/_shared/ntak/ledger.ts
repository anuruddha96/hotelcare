/**
 * HotelCare rows -> NTAK inputs. Pure mapping (unit-tested): reservations,
 * folio lines, payments and room assignments in; per-day stay/check-out
 * records, advance-booking messages and stay events out.
 *
 * Reporting rules applied (spec section in brackets):
 *  - a guest night belongs to the arrival-side calendar day (9.2.16);
 *  - accommodation fee per night from accommodation folio lines, else the
 *    nightly rate, else total / nights; package items are split out (8.4,
 *    9.2.10) and never charged on the check-out day (9.2.18);
 *  - payments: advance payments are reported on the arrival day, payments
 *    during the stay on their day, on the departure day in check-out sales,
 *    after departure as post-departure spending (9.2.1, 9.2.2);
 *  - charges dated after departure are post-departure charges dated with the
 *    departure day (9.2.2); IFA is computed, never taken from folio lines;
 *  - every amount is converted to HUF (9.2.5).
 */
import { COUNTRY_CODES, UNKNOWN_FOREIGN_COUNTRY } from './codes.ts';
import type { MarketSegment, PaymentType, SalesChannel, UnitType, VatRate } from './codes.ts';
import type { NtakBooking, NtakCharge, NtakPayment } from './messages.ts';
import type { CheckoutRecord, StayGuest, StayRecord } from './closure.ts';

export interface PackageComponent {
  label?: string;
  ratePlanIds?: string[] | null; // null/empty = every rate plan
  perGuestPerNight: number;
  main: string;
  sub: string | null;
  vat: VatRate;
}

export interface LedgerConfig {
  categoryMap: Record<string, { main: string; sub: string | null; vat?: VatRate | null }>;
  accommodationKeys: string[];
  ignoredKeys: string[];
  paymentMap: Record<string, PaymentType>;
  channelMap: Record<string, SalesChannel>;
  defaultChannel: SalesChannel;
  defaultSegment: MarketSegment;
  groupRoomThreshold: number;
  packageComponents: PackageComponent[];
  fxRates: Record<string, number>;
  accommodationVat: VatRate;
  defaultVat: VatRate;
  timeZone: string;
}

export const DEFAULT_LEDGER_CONFIG: LedgerConfig = {
  categoryMap: {
    breakfast: { main: 'ETEL', sub: 'REGGELI', vat: 5 },
    restaurant: { main: 'ETEL', sub: 'EGYEB', vat: 5 },
    food: { main: 'ETEL', sub: 'EGYEB', vat: 5 },
    bar: { main: 'ALKOHOLOSITAL', sub: 'ITALCSOMAG', vat: 27 },
    minibar: { main: 'EGYEB', sub: 'EGYEB', vat: 27 },
    spa: { main: 'KOZFURDO', sub: 'WELLNESS_PROGRAM', vat: 27 },
    wellness: { main: 'KOZFURDO', sub: 'WELLNESS_PROGRAM', vat: 27 },
    service: { main: 'EGYEB', sub: 'SZERVIZDIJ', vat: 27 },
    parking: { main: 'EGYEB', sub: 'EGYEB', vat: 27 },
    other: { main: 'EGYEB', sub: 'EGYEB', vat: 27 },
    legacy: { main: 'EGYEB', sub: 'EGYEB', vat: 27 },
  },
  accommodationKeys: ['room', 'accommodation', 'legacy_room', 'room_night', 'szallasdij'],
  ignoredKeys: ['city_tax', 'tourist_tax', 'tourism_tax', 'ifa', 'payment', 'adjustment'],
  paymentMap: {
    cash: 'KESZPENZ', card: 'BANKKARTYA', credit_card: 'BANKKARTYA', debit_card: 'BANKKARTYA', bank_transfer: 'ATUTALAS',
    transfer: 'ATUTALAS', szep_card: 'SZEP_KARTYA', szep: 'SZEP_KARTYA', voucher: 'UTALVANY', ota: 'ATUTALAS', legacy: 'EGYEB',
  },
  channelMap: {
    'booking.com': 'KOZVETITO_ONLINE', expedia: 'KOZVETITO_ONLINE', airbnb: 'KOZVETITO_ONLINE', agoda: 'KOZVETITO_ONLINE',
    booking_engine: 'DIREKT_ONLINE', website: 'DIREKT_ONLINE', web: 'DIREKT_ONLINE', direct: 'DIREKT_HAGYOMANYOS',
    phone: 'DIREKT_HAGYOMANYOS', email: 'DIREKT_HAGYOMANYOS', walk_in: 'DIREKT_HAGYOMANYOS', 'walk-in': 'DIREKT_HAGYOMANYOS',
    travel_agency: 'KOZVETITO_HAGYOMANYOS', tour_operator: 'KOZVETITO_HAGYOMANYOS',
  },
  defaultChannel: 'DIREKT_HAGYOMANYOS',
  defaultSegment: 'SZABADIDOS_EGYENI',
  groupRoomThreshold: 5,
  packageComponents: [],
  fxRates: {},
  accommodationVat: 5,
  defaultVat: 27,
  timeZone: 'Europe/Budapest',
};

export interface RawReservation {
  id: string;
  status: string;
  check_in_date: string;
  check_out_date: string;
  actual_check_in?: string | null;
  actual_check_out?: string | null;
  room_id: string | null;
  room_type_id?: string | null;
  rate_per_night: number | null;
  total_amount: number | null;
  currency: string | null;
  adults: number | null;
  children: number | null;
  source: string | null;
  ota_name: string | null;
  pms_channel?: string | null;
  channex_booking_id: string | null;
  pms_reservation_id: string | null;
  reservation_number: string | null;
  pms_group_note?: string | null;
  pms_rate_plan_id?: string | null;
  created_at: string;
  guest_id?: string | null;
}

export interface RawFolioLine {
  reservation_id: string;
  service_date: string;
  room_id?: string | null;
  gross_total: number;
  vat_rate: number | null;
  currency: string | null;
  status: string;
  category: string | null;
  source_type: string | null;
}

export interface RawPayment { reservation_id: string; amount: number; currency: string | null; method: string | null; status: string; received_at: string }
export interface RawAssignment { reservation_id: string; room_id: string; check_in_date: string; check_out_date: string; status: string | null }

const STAYED = new Set(['checked_in', 'checked_out']);
const PAID = new Set(['recorded', 'captured']);
const VATS = new Set([0, 5, 18, 27]);
const round2 = (n: number) => Math.round(n * 100) / 100;
const key = (v: string | null | undefined) => String(v ?? '').trim().toLowerCase();

export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const nightsBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

export function localDate(iso: string, timeZone = 'Europe/Budapest'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** Same booking number on every NTAK channel (9.1.10): booking-level id first. */
export function bookingNumber(r: Pick<RawReservation, 'id' | 'channex_booking_id' | 'pms_reservation_id' | 'reservation_number'>): string {
  return String(r.channex_booking_id || r.pms_reservation_id || r.reservation_number || r.id).slice(0, 255);
}

export function salesChannel(r: RawReservation, cfg: LedgerConfig): SalesChannel {
  for (const candidate of [r.ota_name, r.pms_channel, r.source]) {
    const hit = cfg.channelMap[key(candidate)];
    if (hit) return hit;
  }
  if (r.ota_name || r.channex_booking_id) return 'KOZVETITO_ONLINE';
  return cfg.defaultChannel;
}

export function marketSegment(r: RawReservation, cfg: LedgerConfig, roomsInBooking: number, isCompany: boolean): MarketSegment {
  const group = roomsInBooking >= cfg.groupRoomThreshold || !!String(r.pms_group_note ?? '').trim();
  if (isCompany) return group ? 'UZLETI_CSOPORTOS' : 'UZLETI_EGYENI';
  if (group) return 'SZABADIDOS_CSOPORTOS';
  return cfg.defaultSegment;
}

/** ISO-2 country from what HotelCare stores (alpha-2, alpha-3 or empty). */
export function toIso2(value: string | null | undefined, iso3: Record<string, string> = {}): string | null {
  const v = String(value ?? '').trim().toUpperCase();
  if (v.length === 2 && COUNTRY_CODES.has(v)) return v;
  if (v.length === 3 && iso3[v] && COUNTRY_CODES.has(iso3[v])) return iso3[v];
  return null;
}

export function toHuf(amount: number, currency: string | null | undefined, cfg: LedgerConfig): { value: number } | { problem: string } {
  const cur = String(currency || 'HUF').toUpperCase();
  if (cur === 'HUF') return { value: round2(Number(amount) || 0) };
  const rate = cfg.fxRates[cur];
  if (!rate || rate <= 0) return { problem: `no ${cur}/HUF exchange rate configured` };
  return { value: Math.round((Number(amount) || 0) * rate) };
}

function vatFor(line: RawFolioLine, mapped: { vat?: VatRate | null }, cfg: LedgerConfig): VatRate {
  const v = line.vat_rate === null || line.vat_rate === undefined ? NaN : Number(line.vat_rate);
  if (VATS.has(v)) return v as VatRate;
  return (mapped.vat ?? cfg.defaultVat) as VatRate;
}

const lineKey = (l: RawFolioLine) => key(l.category) || key(l.source_type);
const isAccommodationLine = (l: RawFolioLine, cfg: LedgerConfig) => cfg.accommodationKeys.includes(key(l.category)) || cfg.accommodationKeys.includes(key(l.source_type));
const isIgnoredLine = (l: RawFolioLine, cfg: LedgerConfig) => cfg.ignoredKeys.includes(key(l.category)) || cfg.ignoredKeys.includes(key(l.source_type));
const live = (l: RawFolioLine) => l.status !== 'reversed' && l.status !== 'voided';

/** Map non-accommodation folio lines to NTAK charges. */
export function mapExtras(lines: RawFolioLine[], cfg: LedgerConfig, problems: string[]): NtakCharge[] {
  const out: NtakCharge[] = [];
  for (const l of lines) {
    if (!live(l) || isAccommodationLine(l, cfg) || isIgnoredLine(l, cfg)) continue;
    const mapped = cfg.categoryMap[lineKey(l)] ?? cfg.categoryMap.other ?? { main: 'EGYEB', sub: 'EGYEB' };
    const huf = toHuf(l.gross_total, l.currency, cfg);
    if ('problem' in huf) { problems.push(huf.problem); continue; }
    out.push({ amount: huf.value, main: mapped.main, sub: mapped.sub, vat: vatFor(l, mapped, cfg) });
  }
  return out;
}

export function mapPayments(payments: RawPayment[], cfg: LedgerConfig, problems: string[]): NtakPayment[] {
  const byType = new Map<PaymentType, number>();
  for (const p of [...payments].sort((a, b) => a.received_at.localeCompare(b.received_at))) {
    if (!PAID.has(p.status)) continue;
    const huf = toHuf(p.amount, p.currency, cfg);
    if ('problem' in huf) { problems.push(huf.problem); continue; }
    const type = cfg.paymentMap[key(p.method)] ?? 'EGYEB';
    byType.set(type, round2((byType.get(type) ?? 0) + huf.value));
  }
  // Sum per means of payment (9.2.1).
  return [...byType.entries()].map(([type, amount]) => ({ amount, type }));
}

/** A recorded actual departure, whether early or late, governs historical closings. */
export function effectiveDeparture(r: RawReservation, tz: string): string {
  if (r.status === 'checked_out' && r.actual_check_out) {
    const actual = localDate(r.actual_check_out, tz);
    const arrival = r.actual_check_in ? localDate(r.actual_check_in, tz) : r.check_in_date;
    if (actual >= arrival) return actual;
  }
  return r.check_out_date;
}

export function roomOnDay(r: RawReservation, assignments: RawAssignment[], day: string): string | null {
  const segments = assignments.filter((x) => x.reservation_id === r.id);
  const a = segments.find((x) => x.status !== 'cancelled' && x.check_in_date <= day && day < x.check_out_date);
  // Never use the current room for a historic day with recorded assignments.
  return a?.room_id ?? (segments.length ? null : r.room_id);
}

export function nightlyFee(r: RawReservation, day: string, lines: RawFolioLine[], cfg: LedgerConfig, problems: string[]): number | null {
  const acc = lines.filter((l) => l.reservation_id === r.id && l.service_date === day && live(l) && isAccommodationLine(l, cfg));
  if (acc.length) {
    let sum = 0;
    for (const l of acc) {
      const huf = toHuf(l.gross_total, l.currency, cfg);
      if ('problem' in huf) { problems.push(huf.problem); return null; }
      sum += huf.value;
    }
    return round2(sum);
  }
  const nights = Math.max(1, nightsBetween(r.check_in_date, r.check_out_date));
  const raw = r.rate_per_night ?? (r.total_amount !== null ? Number(r.total_amount) / nights : null);
  if (raw === null || raw === undefined) return null;
  const huf = toHuf(raw, r.currency, cfg);
  if ('problem' in huf) { problems.push(huf.problem); return null; }
  return huf.value;
}

export function packageItems(r: RawReservation, guestCount: number, cfg: LedgerConfig): NtakCharge[] {
  return cfg.packageComponents
    .filter((c) => !c.ratePlanIds?.length || (r.pms_rate_plan_id && c.ratePlanIds.includes(r.pms_rate_plan_id)))
    .map((c) => ({ amount: round2(c.perGuestPerNight * Math.max(1, guestCount)), main: c.main, sub: c.sub, vat: c.vat }));
}

export interface DayInputs {
  day: string;
  reservations: RawReservation[];
  lines: RawFolioLine[];
  payments: RawPayment[];
  assignments: RawAssignment[];
  guestsFor: (r: RawReservation) => StayGuest[];
  isCompany: (r: RawReservation) => boolean;
  roomsInBooking: (r: RawReservation) => number;
  label: (r: RawReservation) => string;
}

export interface DaySources {
  stays: StayRecord[];
  checkouts: CheckoutRecord[];
  postStayCharges: { bookingNo: string; date: string; charge: NtakCharge }[];
  postStayPayments: { bookingNo: string; date: string; payment: NtakPayment }[];
}

/** Everything one closed day contributes, per reservation. */
export function buildDaySources(input: DayInputs, cfg: LedgerConfig): DaySources {
  const { day } = input;
  const out: DaySources = { stays: [], checkouts: [], postStayCharges: [], postStayPayments: [] };
  for (const r of input.reservations) {
    if (!STAYED.has(r.status)) continue;
    const arrival = r.actual_check_in ? localDate(r.actual_check_in, cfg.timeZone) : r.check_in_date;
    const departure = effectiveDeparture(r, cfg.timeZone);
    const dayUse = arrival === departure;
    const problems: string[] = [];
    const bookingNo = bookingNumber(r);
    const segment = marketSegment(r, cfg, input.roomsInBooking(r), input.isCompany(r));
    const channel = salesChannel(r, cfg);
    const linesToday = input.lines.filter((l) => l.reservation_id === r.id && l.service_date === day);
    const paymentsOf = (pred: (d: string) => boolean) => input.payments.filter((p) => p.reservation_id === r.id && pred(localDate(p.received_at, cfg.timeZone)));

    if ((arrival <= day && day < departure) || (dayUse && day === arrival)) {
      const guests = input.guestsFor(r);
      const expected = Math.max(0, Number(r.adults ?? 0) + Number(r.children ?? 0));
      // Advance payments (received before arrival) are reported on the arrival day.
      const payments = mapPayments(paymentsOf((d) => (day === arrival ? d <= day : d === day)), cfg, problems);
      out.stays.push({
        reservationId: r.id, bookingNo, label: input.label(r), segment, channel,
        roomId: roomOnDay(r, input.assignments, day), dayUse, guests, expectedGuests: expected,
        accommodationFee: nightlyFee(r, day, input.lines, cfg, problems),
        packageItems: packageItems(r, Math.max(guests.length, expected), cfg),
        extras: mapExtras(linesToday, cfg, problems),
        payments, problems,
      });
    } else if (day === departure) {
      const outPackage = mapExtras(linesToday, cfg, problems);
      out.checkouts.push({
        reservationId: r.id, bookingNo, label: input.label(r), segment, channel,
        roomId: roomOnDay(r, input.assignments, addDays(day, -1)),
        inPackage: [], outPackage, payments: mapPayments(paymentsOf((d) => d === day), cfg, problems), problems,
      });
    } else if (day > departure) {
      const charges = mapExtras(linesToday, cfg, problems);
      for (const charge of charges) out.postStayCharges.push({ bookingNo, date: departure, charge });
      for (const payment of mapPayments(paymentsOf((d) => d === day), cfg, problems)) out.postStayPayments.push({ bookingNo, date: day, payment });
      if (problems.length) out.checkouts.push({ reservationId: r.id, bookingNo, label: input.label(r), segment, channel, roomId: null, inPackage: [], outPackage: [], payments: [], problems });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Advance bookings (foglalasEsemeny)

export interface BookingUnitResolver { (r: RawReservation): { unitType: UnitType; capacity: number } | null }

export interface BookingBuild { booking: NtakBooking | null; problems: string[]; skip?: string }

/** One advance-booking message for all HotelCare rows sharing a booking number. */
export function buildBooking(rows: RawReservation[], opts: {
  eventCreatedAt: Date | string;
  today: string;
  originCountry: string | null;
  isCompany: boolean;
  unitFor: BookingUnitResolver;
  unknownCountryCode?: string;
}, cfg: LedgerConfig): BookingBuild {
  const problems: string[] = [];
  if (!rows.length) return { booking: null, problems, skip: 'no rows' };
  const active = rows.filter((r) => !['cancelled', 'no_show'].includes(r.status));
  const cancelled = active.length === 0;
  const scope = cancelled ? rows : active;
  const arrival = scope.map((r) => r.check_in_date).sort()[0];
  const departure = scope.map((r) => r.check_out_date).sort().slice(-1)[0];
  if (arrival < opts.today) return { booking: null, problems, skip: 'arrival is in the past (not accepted by NTAK)' };
  if (departure < arrival) problems.push('departure is before arrival');
  if (nightsBetween(opts.today, arrival) > 730) problems.push('arrival is more than 2 years ahead (JovobeniErkezes)');

  const units: { unitType: UnitType; capacity: number }[] = [];
  for (const r of scope) {
    const u = opts.unitFor(r);
    if (!u) { problems.push(`no NTAK unit type for reservation ${r.reservation_number ?? r.id}`); continue; }
    if (u.capacity < 1 || u.capacity > 99) problems.push(`unit capacity ${u.capacity} must be 1–99`);
    units.push(u);
  }
  let gross = 0;
  for (const r of scope) {
    const huf = toHuf(Number(r.total_amount ?? 0), r.currency, cfg);
    if ('problem' in huf) problems.push(huf.problem); else gross += huf.value;
  }
  if (gross >= 1_000_000_000) problems.push('booking amount is above the secondary limit (1 billion HUF)');
  const guestCount = scope.reduce((a, r) => a + Number(r.adults ?? 0) + Number(r.children ?? 0), 0);
  const capacity = units.reduce((a, u) => a + u.capacity, 0);
  if (guestCount < 1 || guestCount > 99) problems.push(`guest count ${guestCount} must be 1–99`);
  else if (units.length && guestCount > capacity + 2 * units.length) problems.push(`guest count ${guestCount} exceeds capacity + 2 extra beds per unit`);

  const first = [...scope].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  const booking: NtakBooking = {
    bookingNo: bookingNumber(first),
    eventCreatedAt: opts.eventCreatedAt,
    guaranteed: null,
    cancelled,
    originCountry: opts.originCountry ?? opts.unknownCountryCode ?? UNKNOWN_FOREIGN_COUNTRY,
    arrival, departure,
    bookedAt: first.created_at,
    channel: salesChannel(first, cfg),
    grossAmount: Math.round(gross),
    units,
    segment: marketSegment(first, cfg, scope.length, opts.isCompany),
    guestCount: Math.min(99, Math.max(1, guestCount)),
  };
  return { booking: problems.length ? null : booking, problems };
}
