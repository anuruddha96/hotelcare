/**
 * Daily closure (napiZaras) assembly + trial-closure checklist (8.3).
 *
 * Input is already normalized per room/stay (see ledger.ts for how HotelCare
 * rows become StayRecords). Output is the NtakDailyClosure for messages.ts
 * and a checklist: `error` items block sending (NTAK would reject them),
 * `warning` items are shown to the user but the closure can still be sent.
 */
import {
  ACCOMMODATION_CLASSES, categoryProblem, COUNTRY_CODES, postalCodeProblem, primaryChargeLimit, primarySpendingLimit,
  type AccommodationClass, type ChargeSlot, type MarketSegment, type Region, type SalesChannel, type Sex, type VatRate,
} from './codes.ts';
import { autoIfaStatus, ifaPerGuest, type IfaSetting } from './ifa.ts';
import type { NtakCharge, NtakDailyClosure, NtakGuest, NtakNight, NtakPayment, NtakSoldUnit, NtakUnit } from './messages.ts';

export interface ClosureSettings {
  accommodationClass: AccommodationClass;
  region: Region;
  registeredRooms: number | null;
  registeredBeds?: number | null;
  ifa: IfaSetting | null;
  accommodationVat: VatRate;
  ifaVat: VatRate;
}

export interface UnitInfo extends NtakUnit { roomId: string; state: 'available' | 'ooo' | 'oos'; label?: string }

export interface StayGuest {
  guestId: string;
  name: string;
  vendegId: string | null;
  missingIdentity: string[];
  birthDate: string | null;
  sex: Sex | null;
  nationality: string | null;
  residenceCountry: string | null;
  postalCode: string | null;
  ifaStatus: string | null; // manual override; null = automatic
  arrivedAt?: string | null;
  departedAt?: string | null;
  roomId?: string | null;
  stayState?: 'expected' | 'in_house' | 'departed' | 'void';
}

export interface StayRecord {
  reservationId: string;
  bookingNo: string;
  label: string;
  segment: MarketSegment;
  channel: SalesChannel;
  roomId: string | null;
  dayUse: boolean;
  guests: StayGuest[];
  expectedGuests: number;
  accommodationFee: number | null; // gross HUF for this night
  packageItems: NtakCharge[];
  /** Separately posted package catalogue lines, not part of the base rate. */
  postedPackageItems?: NtakCharge[];
  extras: NtakCharge[];
  payments: NtakPayment[];
  problems?: string[]; // mapping problems found upstream (e.g. missing FX rate)
}

export interface CheckoutRecord {
  reservationId: string;
  bookingNo: string;
  label: string;
  segment: MarketSegment;
  channel: SalesChannel;
  roomId: string | null;
  inPackage: NtakCharge[];
  outPackage: NtakCharge[];
  payments: NtakPayment[];
  problems?: string[];
}

export interface ClosureSource {
  day: string;
  closedAt: Date | string;
  classification: 'UJ' | 'MODOSITO';
  protocolId?: string | null;
  reason?: string | null;
  closed: boolean;
  units: UnitInfo[];
  stays: StayRecord[];
  checkouts: CheckoutRecord[];
  otherCharges: NtakCharge[];
  otherPayments: NtakPayment[];
  postStayCharges: { bookingNo: string; date: string; charge: NtakCharge }[];
  postStayPayments: { bookingNo: string; date: string; payment: NtakPayment }[];
}

export interface ChecklistItem { level: 'error' | 'warning'; code: string; message: string; ref?: string }

export interface AssembledClosure {
  closure: NtakDailyClosure;
  checklist: ChecklistItem[];
  totals: { roomNights: number; guests: number; accommodationFee: number; ifa: number; charges: number; payments: number };
}

const capacityOf = (u: NtakUnit) => Math.max(0, u.singleBeds) + 2 * Math.max(0, u.doubleBeds);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function assembleClosure(src: ClosureSource, s: ClosureSettings): AssembledClosure {
  const list: ChecklistItem[] = [];
  const err = (code: string, message: string, ref?: string) => list.push({ level: 'error', code, message, ref });
  const warn = (code: string, message: string, ref?: string) => list.push({ level: 'warning', code, message, ref });
  if (!ACCOMMODATION_CLASSES.includes(s.accommodationClass)) err('settings', 'Accommodation class is not set');

  const units = new Map(src.units.map((u) => [u.roomId, u]));
  const year = Number(src.day.slice(0, 4));
  const totals = { roomNights: 0, guests: 0, accommodationFee: 0, ifa: 0, charges: 0, payments: 0 };

  for (const u of src.units) {
    if (!u.building.trim() || !u.roomNumber.trim()) err('unit', `Unit ${u.label ?? u.roomId}: building and room number are mandatory`, u.roomId);
    if (u.singleBeds < 0 || u.singleBeds > 1000 || u.doubleBeds < 0 || u.doubleBeds > 1000) err('unit', `Unit ${u.label ?? u.roomNumber}: bed counts must be 0–1000`, u.roomId);
    if (capacityOf(u) === 0) warn('unit', `Unit ${u.label ?? u.roomNumber} has no beds recorded`, u.roomId);
  }
  if (!src.units.length) err('units', 'No NTAK unit profiles: add the rooms registered in NTAK');

  const checkCharge = (slot: ChargeSlot, ch: NtakCharge, ref: string) => {
    const problem = categoryProblem(slot, ch.main, ch.sub ?? null);
    if (problem) err('category', `${ref}: ${problem}`, ref);
    if (![0, 5, 18, 27].includes(ch.vat)) err('vat', `${ref}: VAT ${ch.vat}% is not one of 0/5/18/27`, ref);
    if (ch.amount < 0 && !(ch.main === 'IFA' && slot === 'checkout_out_package')) err('negative', `${ref}: negative ${ch.main} item (${ch.amount}); correct the original day instead`, ref);
    const limit = primaryChargeLimit(s.accommodationClass, s.region, slot, ch.main);
    if (limit !== null && ch.amount > limit * 10) err('extreme', `${ref}: ${ch.main} ${ch.amount} HUF is above the secondary limit (${limit * 10})`, ref);
    else if (limit !== null && ch.amount > limit) warn('extreme', `${ref}: ${ch.main} ${ch.amount} HUF is above the primary limit (${limit})`, ref);
    totals.charges += ch.amount;
  };
  const checkPayment = (p: NtakPayment, ref: string) => {
    if (p.amount < 0) err('negative', `${ref}: negative payment ${p.amount}`, ref);
    const limit = primarySpendingLimit(s.accommodationClass);
    if (p.amount > limit * 10) err('extreme', `${ref}: payment ${p.amount} HUF is above the secondary limit`, ref);
    else if (p.amount > limit) warn('extreme', `${ref}: payment ${p.amount} HUF is above the primary limit`, ref);
    totals.payments += p.amount;
  };

  // Rooms & capacity -----------------------------------------------------------
  const total = src.units.length;
  const ooo = src.closed ? total : src.units.filter((u) => u.state === 'ooo').length;
  const oos = src.closed ? 0 : src.units.filter((u) => u.state === 'oos').length;
  const cap = (pred: (u: UnitInfo) => boolean) => src.units.filter(pred).reduce((a, u) => a + capacityOf(u), 0);
  const calculatedCapacity = cap(() => true);
  const capTotal = s.registeredBeds ?? calculatedCapacity;
  if (s.registeredBeds != null && s.registeredBeds !== calculatedCapacity) {
    warn('registration', `${calculatedCapacity} beds are profiled but NTAK registration says ${s.registeredBeds} beds (ElteresRegisztraltAdatokban)`);
  }
  if (s.registeredRooms !== null && s.registeredRooms !== total) {
    warn('registration', `${total} units are profiled but NTAK registration says ${s.registeredRooms} rooms (ElteresRegisztraltAdatokban)`);
  }
  if (total < 1 || total > 1000) err('rooms', 'Total rooms must be between 1 and 1000');

  // Nights -----------------------------------------------------------------------
  const nights: NtakNight[] = [];
  const soldUnitIds = new Set<string>();
  const seenGuestIds = new Map<string, string>();
  if (src.closed && src.stays.length) err('closed', 'Accommodation marked closed but guests stayed this night');

  for (const st of src.stays) {
    const ref = st.label;
    for (const p of st.problems ?? []) err('mapping', `${ref}: ${p}`, st.reservationId);
    const unit = st.roomId ? units.get(st.roomId) : undefined;
    if (!unit) { err('unit', `${ref}: the room has no NTAK unit profile`, st.reservationId); continue; }
    if (!st.dayUse) {
      if (soldUnitIds.has(unit.roomId)) err('double', `${ref}: unit ${unit.roomNumber} is already sold for this night (NappaliHasznalatHiba)`, st.reservationId);
      soldUnitIds.add(unit.roomId);
      if (unit.state !== 'available') err('state_conflict', `${ref}: room ${unit.roomNumber} is ${unit.state.toUpperCase()} but occupied on ${src.day}; correct the room period or reservation before reporting`, st.reservationId);
    }

    const guests: NtakGuest[] = [];
    const statuses: string[] = [];
    for (const g of st.guests) {
      const gref = `${ref} / ${g.name}`;
      if (!g.vendegId) { warn('guest', `${gref}: not sent, identity incomplete (${g.missingIdentity.join(', ') || 'no guest id'})`, st.reservationId); continue; }
      const prev = seenGuestIds.get(g.vendegId);
      if (prev) { err('guest', `${gref}: same guest id already in ${prev} (IsmetlodoAzonosito)`, st.reservationId); continue; }
      seenGuestIds.set(g.vendegId, ref);
      const birthYear = g.birthDate ? Number(g.birthDate.slice(0, 4)) : NaN;
      if (!Number.isFinite(birthYear)) { err('guest', `${gref}: year of birth missing`, st.reservationId); continue; }
      if (year - birthYear > 110) err('age', `${gref}: born ${birthYear}, more than 110 years ago (HibasSzuletesiEv)`, st.reservationId);
      else if (year - birthYear > 100) warn('age', `${gref}: older than 100 years, please double-check (MagasEletkor)`, st.reservationId);
      if (birthYear > year) err('age', `${gref}: year of birth is in the future`, st.reservationId);
      const nationality = g.nationality ?? '';
      const residence = g.residenceCountry ?? '';
      if (!COUNTRY_CODES.has(nationality)) err('country', `${gref}: nationality "${nationality}" is not an accepted ISO-2 code`, st.reservationId);
      if (!COUNTRY_CODES.has(residence)) err('country', `${gref}: country of residence "${residence}" is not an accepted ISO-2 code`, st.reservationId);
      const postal = postalCodeProblem(residence, g.postalCode);
      if (postal) warn('postal', `${gref}: ${postal} (IrszHiba)`, st.reservationId);
      const ifaStatus = g.ifaStatus || autoIfaStatus(g.birthDate, src.day);
      if (!/^(KOTELES|im[1-9][0-9]*)$/.test(ifaStatus)) err('ifa', `${gref}: invalid tourism tax status ${ifaStatus}`, st.reservationId);
      statuses.push(ifaStatus);
      guests.push({
        vendegId: g.vendegId, birthYear, sex: g.sex ?? 'EGYEB_VAGY_NEM_ISMERT', nationality, residenceCountry: residence,
        postalCode: String(g.postalCode ?? '').trim(), ifaStatus,
      });
    }
    if (!guests.length) { err('guest', `${ref}: no guest with complete personal data, the room cannot be reported`, st.reservationId); continue; }
    if (guests.length < st.expectedGuests) warn('guest', `${ref}: ${st.expectedGuests} guests expected, ${guests.length} registered`, st.reservationId);

    const inPackage: NtakCharge[] = [];
    const outPackage: NtakCharge[] = [];
    if (st.accommodationFee === null) err('fee', `${ref}: accommodation fee unknown for this night (KotelezoSzallasdij)`, st.reservationId);
    const packageTotal = st.packageItems.reduce((a, c) => a + c.amount, 0);
    const fee = round2((st.accommodationFee ?? 0) - packageTotal);
    if (st.accommodationFee !== null && fee < 0) err('fee', `${ref}: package items exceed the accommodation fee`, st.reservationId);
    inPackage.push({ amount: Math.max(0, fee), main: 'SZALLASDIJ', sub: null, vat: s.accommodationVat }, ...st.packageItems, ...(st.postedPackageItems ?? []));
    for (const amount of st.dayUse ? [] : ifaPerGuest(s.ifa, Math.max(0, fee), s.accommodationVat, statuses)) {
      outPackage.push({ amount, main: 'IFA', sub: null, vat: s.ifaVat });
      totals.ifa += amount;
    }
    outPackage.push(...st.extras);
    inPackage.forEach((c) => checkCharge('night_in_package', c, ref));
    outPackage.forEach((c) => checkCharge('night_out_package', c, ref));
    st.payments.forEach((p) => checkPayment(p, ref));
    totals.accommodationFee += Math.max(0, fee);
    if (!st.dayUse) totals.roomNights += 1;
    totals.guests += guests.length;

    const sold: NtakSoldUnit = {
      unit: stripUnit(unit), bookingNo: st.bookingNo, segment: st.segment, channel: st.channel,
      payments: st.payments, inPackage, outPackage,
    };
    nights.push({ sold, guests, dayUse: st.dayUse });
  }

  // Check-out day sales -------------------------------------------------------------
  const checkoutSales: NtakSoldUnit[] = [];
  for (const co of src.checkouts) {
    for (const p of co.problems ?? []) err('mapping', `${co.label}: ${p}`, co.reservationId);
    if (!co.inPackage.length && !co.outPackage.length && !co.payments.length) continue;
    const unit = co.roomId ? units.get(co.roomId) : undefined;
    co.inPackage.forEach((c) => checkCharge('checkout_in_package', c, `${co.label} (check-out)`));
    co.outPackage.forEach((c) => checkCharge('checkout_out_package', c, `${co.label} (check-out)`));
    co.payments.forEach((p) => checkPayment(p, `${co.label} (check-out)`));
    checkoutSales.push({
      unit: unit ? stripUnit(unit) : null, bookingNo: co.bookingNo, segment: co.segment, channel: co.channel,
      payments: co.payments, inPackage: co.inPackage, outPackage: co.outPackage,
    });
  }

  src.otherCharges.forEach((c, i) => checkCharge('other', c, `Other revenue #${i + 1}`));
  src.otherPayments.forEach((p, i) => checkPayment(p, `Other payment #${i + 1}`));
  src.postStayCharges.forEach((c) => checkCharge('post_departure', c.charge, `Post-departure ${c.bookingNo}`));
  src.postStayPayments.forEach((p) => checkPayment(p.payment, `Post-departure ${p.bookingNo}`));

  // Recommendations ----------------------------------------------------------------
  const allGuests = nights.flatMap((n) => n.guests);
  if (allGuests.length >= 10) {
    const women = allGuests.filter((g) => g.sex === 'NO').length;
    const men = allGuests.filter((g) => g.sex === 'FERFI').length;
    if (Math.max(women, men) / allGuests.length >= 0.9) warn('sex_ratio', `Guest sex ratio is ${women} women / ${men} men: please check the records (8.1.3)`);
  }

  const rented = src.closed ? 0 : soldUnitIds.size;
  // "Available" means sellable and NOT already rented. OOO/OOS and occupied
  // units are disjoint except where a blocking state_conflict was recorded.
  const sellable = total - ooo - oos;
  if (rented > sellable) err('rooms', `Rooms rented (${rented}) exceed sellable rooms (${sellable}) (TobbKiadott)`);
  const available = Math.max(0, sellable - rented);
  const soldCap = src.units.filter((u) => soldUnitIds.has(u.roomId)).reduce((a, u) => a + capacityOf(u), 0);
  const oooCap = src.closed ? capTotal : cap((u) => u.state === 'ooo');
  const oosCap = src.closed ? 0 : cap((u) => u.state === 'oos');

  const closure: NtakDailyClosure = {
    day: src.day,
    classification: src.classification,
    protocolId: src.protocolId ?? null,
    reason: src.reason ?? null,
    closedAt: src.closedAt,
    closed: src.closed,
    rooms: { total, ooo, oos, rented, available: src.closed ? 0 : available },
    capacity: { total: capTotal, ooo: oooCap, oos: oosCap, rented: src.closed ? 0 : soldCap, available: src.closed ? 0 : Math.max(0, capTotal - oooCap - oosCap - soldCap) },
    ifa: s.ifa ? { type: s.ifa.type, rate: s.ifa.type === 'NINCS' ? 0 : s.ifa.rate } : null,
    nights,
    outOfService: src.units.filter((u) => src.closed || u.state !== 'available').map(stripUnit),
    checkoutSales,
    otherCharges: src.otherCharges,
    otherPayments: src.otherPayments,
    postStayCharges: src.postStayCharges,
    postStayPayments: src.postStayPayments,
  };

  if (src.classification === 'MODOSITO') {
    if (!String(src.protocolId ?? '').trim() || String(src.protocolId).length > 25) err('correction', 'A correction needs a record ID (max 25 characters)');
    if (!String(src.reason ?? '').trim() || String(src.reason).length > 100) err('correction', 'A correction needs a reason (max 100 characters)');
  }
  totals.charges = round2(totals.charges);
  totals.payments = round2(totals.payments);
  totals.accommodationFee = round2(totals.accommodationFee);
  return { closure, checklist: list, totals };
}

function stripUnit(u: UnitInfo): NtakUnit {
  return { building: u.building, roomNumber: u.roomNumber, unitType: u.unitType, singleBeds: u.singleBeds, doubleBeds: u.doubleBeds, extraBeds: u.extraBeds ?? 0 };
}

export const hasBlockingErrors = (items: ChecklistItem[]) => items.some((i) => i.level === 'error');
