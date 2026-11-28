/**
 * NTAK PMS v9 library tests.
 *   deno test --allow-read --allow-write --allow-run --allow-env supabase/functions/_shared/ntak/ntak_test.ts
 * Needs xmllint (libxml2-utils), openssl and python3 with lxml + cryptography.
 */
import { strict as assert } from 'node:assert';
import bcrypt from 'npm:bcryptjs@2.4.3';
import { CATEGORIES, CLOSURE_CORRECTION_REASONS, IFA_STATUSES, categoryProblem, postalCodeProblem, primaryChargeLimit } from './codes.ts';
import { assembleClosure, hasBlockingErrors, type ClosureSource, type ClosureSettings, type StayGuest, type UnitInfo } from './closure.ts';
import { computeVendegId, generateSalt, guestHashInput, isValidSalt, missingIdentityFields } from './guestId.ts';
import { autoIfaStatus, effectiveIfaStatus, isVerifiedIfaStatus, ifaPerGuest } from './ifa.ts';
import { buildBooking, buildDaySources, mapExtras, mapPayments, DEFAULT_LEDGER_CONFIG, type RawReservation } from './ledger.ts';
import {
  buildAdatszolgaltatasKezdoDatumRequest, buildEllenorzesRequest, buildEsemenyvezereltRequest, buildFoglalasEsemenyRequest,
  buildNapiZarasRequest, escText, formatAmount, xsDateTime, type NtakCommon,
} from './messages.ts';
import { parseNtakResponse } from './response.ts';
import { importSigningKey, signEnvelope, verifyEnvelope } from './wssec.ts';
import { generateCsr, keyMatchesCertificate, normalizePrivateKeyPem, parseCertificate, effectiveExpiry } from './x509.ts';

const DIR = new URL('./testdata/', import.meta.url).pathname;
const XSD = DIR + 'ntak-v9.xsd';

async function run(cmd: string, args: string[], input?: string): Promise<{ code: number; out: string; err: string }> {
  const p = new Deno.Command(cmd, { args, stdin: input ? 'piped' : 'null', stdout: 'piped', stderr: 'piped' }).spawn();
  if (input) { const w = p.stdin.getWriter(); await w.write(new TextEncoder().encode(input)); await w.close(); }
  const o = await p.output();
  return { code: o.code, out: new TextDecoder().decode(o.stdout), err: new TextDecoder().decode(o.stderr) };
}

async function assertValid(xml: string) {
  const file = await Deno.makeTempFile({ suffix: '.xml' });
  await Deno.writeTextFile(file, xml);
  const r = await run('xmllint', ['--noout', '--schema', XSD, file]);
  assert.equal(r.code, 0, `XSD validation failed:\n${r.err}\n${xml.slice(0, 2000)}`);
}

async function testCertificate(): Promise<{ keyPem: string; certPem: string; dir: string }> {
  const dir = await Deno.makeTempDir();
  const r = await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${dir}/k.pem`, '-out', `${dir}/c.pem`, '-days', '10',
    '-subj', '/CN=SZ25003491/OU=ABCD1234/O=HotelCare Test/organizationIdentifier=VATHU-69861195', '-addext', 'extendedKeyUsage=clientAuth']);
  assert.equal(r.code, 0, r.err);
  return { keyPem: await Deno.readTextFile(`${dir}/k.pem`), certPem: await Deno.readTextFile(`${dir}/c.pem`), dir };
}

const common = (): NtakCommon => ({
  uzenetId: crypto.randomUUID(), sentAt: '2026-11-19T05:10:00Z', softwareVersion: 'v1.0.0', softwareId: 'HOTELCARE01',
  registrationNumber: 'SZ25003491', taxNumber: '69861195-2-44',
  accommodationName: 'Ceylon Business Services Kft', providerName: 'Interface_csatlakozás_szolgáltató_v9',
});

const vid = (n: number) => (`guest${n}`.padEnd(31, 'x')).slice(0, 31);
const guest = (n: number, extra: Partial<StayGuest> = {}): StayGuest => ({
  guestId: `g${n}`, name: `Guest ${n}`, vendegId: vid(n), missingIdentity: [], birthDate: '1985-04-02', sex: n % 2 ? 'NO' : 'FERFI',
  nationality: 'DE', residenceCountry: 'DE', postalCode: '10115', ifaStatus: null, ...extra,
});
const units = (): UnitInfo[] => [
  { roomId: 'r101', building: 'A', roomNumber: '101', unitType: 'STANDARD', singleBeds: 0, doubleBeds: 1, extraBeds: 1, state: 'available' },
  { roomId: 'r102', building: 'A', roomNumber: '102', unitType: 'SUPERIOR', singleBeds: 2, doubleBeds: 0, extraBeds: 0, state: 'ooo' },
  { roomId: 'r103', building: 'A', roomNumber: '103', unitType: 'ECONOMY', singleBeds: 1, doubleBeds: 0, extraBeds: 0, state: 'available' },
];
const settings: ClosureSettings = { accommodationClass: 'hotel_4', region: 'budapest', registeredRooms: 3, ifa: { type: 'SZAZALEKOS', rate: 4 }, accommodationVat: 18, ifaVat: 0 };

function closureSource(): ClosureSource {
  return {
    day: '2026-11-18', closedAt: '2026-11-19T04:30:00Z', classification: 'UJ', closed: false, units: units(),
    stays: [{
      reservationId: 'res1', bookingNo: 'CHX-1', label: 'Room 101 / CHX-1', segment: 'SZABADIDOS_EGYENI', channel: 'KOZVETITO_ONLINE',
      roomId: 'r101', dayUse: false, guests: [guest(1), guest(2)], expectedGuests: 2, accommodationFee: 40000,
      packageItems: [], extras: [{ amount: 2500, main: 'EGYEB', sub: 'EGYEB', vat: 27 }], payments: [{ amount: 40000, type: 'BANKKARTYA' }],
    }],
    checkouts: [{
      reservationId: 'res0', bookingNo: 'BK-0', label: 'Room 103 / BK-0', segment: 'UZLETI_EGYENI', channel: 'DIREKT_ONLINE', roomId: 'r103',
      inPackage: [], outPackage: [{ amount: 3000, main: 'ETEL', sub: 'REGGELI', vat: 5 }], payments: [{ amount: 3000, type: 'KESZPENZ' }],
    }],
    otherCharges: [], otherPayments: [],
    postStayCharges: [{ bookingNo: 'BK-9', date: '2026-11-15', charge: { amount: 1500, main: 'EGYEB', sub: 'EGYEB', vat: 27 } }],
    postStayPayments: [{ bookingNo: 'BK-9', date: '2026-11-18', payment: { amount: 1500, type: 'SZEP_KARTYA' } }],
  };
}

// ---------------------------------------------------------------------------

Deno.test('guest id reproduces the spec example (9.1.1)', async () => {
  const g = { title: 'dr.', lastName: 'Teszt', firstName: 'Edit', birthPlace: 'Budapest', birthDate: '1979-07-12' };
  assert.equal(guestHashInput(g), 'dr. Teszt Edit Budapest 1979.07.12.');
  const id = await computeVendegId(g, 'zDaBMMumxc/1rLNjHHg55O', (d, s) => bcrypt.hashSync(d, s));
  assert.equal(id, '473/rnEtql5aigjoPG33qz1uARVImcW');
  assert.deepEqual(missingIdentityFields({ lastName: 'A', firstName: 'B' }), ['place of birth', 'date of birth']);
  const salt = generateSalt();
  assert.ok(isValidSalt(salt));
  assert.equal((await computeVendegId(g, salt, (d, s) => bcrypt.hashSync(d, s))).length, 31);
});

Deno.test('tourism tax follows the spec examples (9.2.17)', () => {
  assert.deepEqual(ifaPerGuest({ type: 'SZAZALEKOS', rate: 4 }, 100, 5, ['KOTELES', 'KOTELES', 'im1', 'im1']), [1, 1]);
  assert.deepEqual(ifaPerGuest({ type: 'TETELES', rate: 400 }, 0, 18, ['KOTELES', 'im1', 'KOTELES', 'im1']), [400, 400]);
  assert.deepEqual(ifaPerGuest({ type: 'NINCS', rate: 0 }, 1000, 18, ['KOTELES']), []);
  assert.deepEqual(ifaPerGuest({ type: 'SZAZALEKOS', rate: 4 }, 40000, 18, ['KOTELES', 'KOTELES']), [678, 678]);
  assert.equal(autoIfaStatus('2010-11-19', '2026-11-18'), 'im1');
  assert.equal(autoIfaStatus('2008-11-18', '2026-11-18'), 'KOTELES');
});

Deno.test('category, postal-code and extreme-value rules', () => {
  assert.equal(categoryProblem('night_in_package', 'SZALLASDIJ', null), null);
  assert.match(categoryProblem('checkout_in_package', 'SZALLASDIJ', null)!, /not allowed/);
  assert.match(categoryProblem('night_in_package', 'IFA', null)!, /not allowed/);
  assert.equal(categoryProblem('checkout_out_package', 'IFA', null), null);
  assert.match(categoryProblem('night_out_package', 'ETEL', 'BOR')!, /needs one of/);
  assert.match(categoryProblem('other', 'EGYEB', 'EGYEB_VENDEGLATAS') ?? 'ok', /ok/);
  assert.match(categoryProblem('post_departure', 'EGYEB', 'EGYEB_VENDEGLATAS')!, /not allowed/);
  assert.equal(postalCodeProblem('HU', '1051'), null);
  assert.match(postalCodeProblem('HU', '0123')!, /format|dummy/);
  assert.match(postalCodeProblem('DE', '9999')!, /dummy/);
  assert.equal(postalCodeProblem('GB', 'SW1A 1AA'), null);
  assert.equal(postalCodeProblem('XK', 'whatever'), null);
  assert.equal(primaryChargeLimit('hotel_4', 'budapest', 'night_in_package', 'SZALLASDIJ'), 1_000_000);
  assert.equal(primaryChargeLimit('hotel_5', 'budapest', 'other', 'EGYEB'), 100_000_000);
});

Deno.test('daily closure assembles counts, IFA and passes the v9 schema', async () => {
  const { closure, checklist, totals } = assembleClosure(closureSource(), settings);
  assert.deepEqual(closure.rooms, { total: 3, ooo: 1, oos: 0, rented: 1, available: 2 });
  assert.deepEqual(closure.capacity, { total: 5, ooo: 2, oos: 0, rented: 2, available: 3 });
  // NTAK: osszesSzoba = kiadhato + OOO + OOS, and the same for beds (rented units stay "kiadható").
  assert.equal(closure.rooms.total, closure.rooms.available + closure.rooms.ooo + closure.rooms.oos);
  assert.equal(closure.capacity.total, closure.capacity.available + closure.capacity.ooo + closure.capacity.oos);
  assert.equal(closure.outOfService.length, 1);
  assert.equal(totals.ifa, 1356);
  const night = closure.nights[0];
  assert.deepEqual(night.sold!.outPackage.filter((c) => c.main === 'IFA').map((c) => c.amount), [678, 678]);
  assert.equal(night.sold!.inPackage[0].main, 'SZALLASDIJ');
  assert.ok(!hasBlockingErrors(checklist), JSON.stringify(checklist));
  const xml = buildNapiZarasRequest(common(), closure);
  await assertValid(xml);
  assert.match(xml, /<v9:szallasRegisztraciosSzam>SZ25003491<\/v9:szallasRegisztraciosSzam><v9:szallashelySzolgaltatoAdoszam>69861195-2-44<\/v9:szallashelySzolgaltatoAdoszam><v9:szallasNev>Ceylon Business Services Kft<\/v9:szallasNev><v9:szallashelySzolgaltatoNev>Interface_csatlakozás_szolgáltató_v9<\/v9:szallashelySzolgaltatoNev>/);
  assert.ok(xml.includes('<v9:koltesAlTipus>SZALLASHELY</v9:koltesAlTipus>'));
  assert.ok(!/\/>/.test(xml), 'no self-closing tags (c14n form)');
});

Deno.test('NTAK test tax number stays hyphenated and has the required provider header', async () => {
  const c = {
    ...common(), registrationNumber: 'MA26004524',
    taxNumber: '11223355-1-22',
    softwareId: 'HOTELCARE', softwareVersion: '1.0',
  };
  const xml = buildAdatszolgaltatasKezdoDatumRequest(c);
  assert.match(xml, /<v9:szallasRegisztraciosSzam>MA26004524<\/v9:szallasRegisztraciosSzam>/);
  assert.match(xml, /<v9:szallashelySzolgaltatoAdoszam>11223355-1-22<\/v9:szallashelySzolgaltatoAdoszam>/);
  assert.match(xml, /<v9:szallasNev>Ceylon Business Services Kft<\/v9:szallasNev>/);
  await assertValid(xml);
});

Deno.test('NTAK scope count uses four profiles and excludes extra beds; registered bed override is explicit', async () => {
  const four: UnitInfo[] = [
    { roomId: '101', building: '1', roomNumber: '101', unitType: 'STANDARD', singleBeds: 1, doubleBeds: 1, extraBeds: 0, state: 'available' },
    { roomId: '102', building: '1', roomNumber: '102', unitType: 'SUPERIOR', singleBeds: 0, doubleBeds: 1, extraBeds: 0, state: 'available' },
    { roomId: '103', building: '1', roomNumber: '103', unitType: 'ECONOMY', singleBeds: 1, doubleBeds: 1, extraBeds: 0, state: 'available' },
    { roomId: '104', building: '1', roomNumber: '104', unitType: 'APARTMAN', singleBeds: 0, doubleBeds: 1, extraBeds: 1, state: 'available' },
  ];
  const source: ClosureSource = {
    ...closureSource(), units: four, stays: [], checkouts: [],
    postStayCharges: [], postStayPayments: [], otherPayments: [], otherCharges: [],
  };
  const standard = assembleClosure(source, { ...settings, registeredRooms: 4, registeredBeds: null });
  assert.equal(standard.closure.rooms.total, 4);
  assert.equal(standard.closure.capacity.total, 10);
  await assertValid(buildNapiZarasRequest(common(), standard.closure));
  const override = assembleClosure(source, { ...settings, registeredRooms: 5, registeredBeds: 12 });
  assert.equal(override.closure.capacity.total, 12);
  assert.ok(override.checklist.some((c) => c.code === 'registration'));
  await assertValid(buildNapiZarasRequest(common(), override.closure));
});

Deno.test('closure checklist blocks what NTAK would reject', () => {
  const src = closureSource();
  src.stays[0].guests = [guest(1, { vendegId: null, missingIdentity: ['date of birth'] })];
  src.stays[0].accommodationFee = null;
  src.classification = 'MODOSITO';
  const { checklist } = assembleClosure(src, settings);
  const codes = checklist.filter((c) => c.level === 'error').map((c) => c.code);
  assert.ok(codes.includes('guest'), 'room without identifiable guest');
  assert.ok(codes.includes('correction'), 'MODOSITO needs a reason');

  const old = closureSource();
  old.stays[0].guests = [guest(1, { birthDate: '1910-01-01' }), guest(2, { nationality: 'XX' })];
  old.stays[0].extras.push({ amount: -100, main: 'EGYEB', sub: 'EGYEB', vat: 27 }, { amount: 900_000, main: 'ETEL', sub: 'EGYEB', vat: 5 });
  const r2 = assembleClosure(old, settings).checklist;
  assert.ok(r2.some((c) => c.code === 'age' && c.level === 'error'));
  assert.ok(r2.some((c) => c.code === 'country' && c.level === 'error'));
  assert.ok(r2.some((c) => c.code === 'negative'));
  assert.ok(r2.some((c) => c.code === 'extreme' && c.level === 'warning'));
});

Deno.test('closed accommodation reports every room as out of order', async () => {
  const src = closureSource();
  src.closed = true; src.stays = []; src.checkouts = []; src.postStayCharges = []; src.postStayPayments = [];
  const { closure, checklist } = assembleClosure(src, settings);
  assert.deepEqual(closure.rooms, { total: 3, ooo: 3, oos: 0, rented: 0, available: 0 });
  assert.deepEqual(closure.capacity, { total: 5, ooo: 5, oos: 0, rented: 0, available: 0 });
  assert.equal(closure.outOfService.length, 3);
  assert.ok(!hasBlockingErrors(checklist));
  await assertValid(buildNapiZarasRequest(common(), closure));
});

Deno.test('MODOSITO closure carries record id and reason', async () => {
  const src = closureSource();
  src.classification = 'MODOSITO'; src.protocolId = 'JK-2026-001'; src.reason = 'TERHELES_VAGY_KOLTES_JAV';
  const { closure, checklist } = assembleClosure(src, settings);
  assert.ok(!hasBlockingErrors(checklist));
  const xml = buildNapiZarasRequest(common(), closure);
  assert.ok(xml.includes('<v9:besorolas>MODOSITO</v9:besorolas><v9:jegyzokonyvAzonosito>JK-2026-001</v9:jegyzokonyvAzonosito>'));
  await assertValid(xml);
});

const res = (over: Partial<RawReservation>): RawReservation => ({
  id: 'r', status: 'checked_in', check_in_date: '2026-11-17', check_out_date: '2026-11-20', room_id: 'r101', rate_per_night: 40000,
  total_amount: 120000, currency: 'HUF', adults: 2, children: 0, source: null, ota_name: null, channex_booking_id: null,
  pms_reservation_id: null, reservation_number: 'HC-1', created_at: '2026-10-01T10:00:00Z', ...over,
});

Deno.test('ledger attributes nights, payments and post-departure items', () => {
  const reservations = [
    res({ id: 'R1', channex_booking_id: 'CHX-1', ota_name: 'Booking.com' }),
    res({ id: 'R2', status: 'checked_out', check_in_date: '2026-11-15', check_out_date: '2026-11-18', room_id: 'r103', reservation_number: 'HC-2' }),
    res({ id: 'R3', status: 'checked_out', check_in_date: '2026-11-10', check_out_date: '2026-11-12', reservation_number: 'HC-3' }),
    res({ id: 'R4', status: 'cancelled', reservation_number: 'HC-4' }),
    res({ id: 'R5', currency: 'EUR', rate_per_night: 120, reservation_number: 'HC-5', room_id: 'r102' }),
  ];
  const lines = [
    { reservation_id: 'R2', service_date: '2026-11-18', gross_total: 3000, vat_rate: 5, currency: 'HUF', status: 'open', category: 'breakfast', source_type: 'manual' },
    { reservation_id: 'R3', service_date: '2026-11-18', gross_total: 1500, vat_rate: 27, currency: 'HUF', status: 'open', category: 'minibar', source_type: 'manual' },
    { reservation_id: 'R1', service_date: '2026-11-17', gross_total: 999, vat_rate: null, currency: 'HUF', status: 'open', category: 'city_tax', source_type: 'manual' },
  ];
  const payments = [
    { reservation_id: 'R1', amount: 20000, currency: 'HUF', method: 'card', status: 'recorded', received_at: '2026-11-01T09:00:00Z' },
    { reservation_id: 'R1', amount: 5000, currency: 'HUF', method: 'cash', status: 'recorded', received_at: '2026-11-17T15:00:00Z' },
    { reservation_id: 'R1', amount: 7000, currency: 'HUF', method: 'cash', status: 'failed', received_at: '2026-11-17T15:00:00Z' },
    { reservation_id: 'R2', amount: 3000, currency: 'HUF', method: 'cash', status: 'recorded', received_at: '2026-11-18T08:00:00Z' },
    { reservation_id: 'R3', amount: 10000, currency: 'HUF', method: 'transfer', status: 'recorded', received_at: '2026-11-18T10:00:00Z' },
  ];
  const base = { lines, payments, assignments: [], guestsFor: () => [guest(1)], isCompany: () => false, roomsInBooking: () => 1, label: (r: RawReservation) => r.id };

  const arrival = buildDaySources({ ...base, day: '2026-11-17', reservations }, DEFAULT_LEDGER_CONFIG);
  const r1 = arrival.stays.find((s) => s.reservationId === 'R1')!;
  assert.equal(r1.bookingNo, 'CHX-1');
  assert.equal(r1.channel, 'KOZVETITO_ONLINE');
  assert.deepEqual(r1.payments, [{ amount: 20000, type: 'BANKKARTYA' }, { amount: 5000, type: 'KESZPENZ' }]);
  assert.deepEqual(r1.extras, [], 'city tax lines are ignored: IFA is computed');
  assert.equal(r1.accommodationFee, 40000);
  assert.match(arrival.stays.find((s) => s.reservationId === 'R5')!.problems!.join(), /EUR\/HUF/);

  const day = buildDaySources({ ...base, day: '2026-11-18', reservations }, DEFAULT_LEDGER_CONFIG);
  assert.deepEqual(day.stays.find((s) => s.reservationId === 'R1')!.payments, []);
  const co = day.checkouts.find((c) => c.reservationId === 'R2')!;
  assert.deepEqual(co.outPackage, [{ amount: 3000, main: 'ETEL', sub: 'REGGELI', vat: 5 }]);
  assert.deepEqual(co.payments, [{ amount: 3000, type: 'KESZPENZ' }]);
  assert.deepEqual(day.postStayCharges, [{ bookingNo: 'HC-3', date: '2026-11-12', charge: { amount: 1500, main: 'EGYEB', sub: 'EGYEB', vat: 27 } }]);
  assert.deepEqual(day.postStayPayments, [{ bookingNo: 'HC-3', date: '2026-11-18', payment: { amount: 10000, type: 'ATUTALAS' } }]);
  assert.ok(!day.stays.some((s) => s.reservationId === 'R4'));

  // Reception-set NTAK fields win over the inferred segment/channel in the closing.
  const overridden = buildDaySources({ ...base, day: '2026-11-17', reservations: reservations.map((r) => r.id === 'R1'
    ? { ...r, ntak_sales_channel: 'DIREKT_HAGYOMANYOS' as const, ntak_market_segment: 'UZLETI_CSOPORTOS' as const } : r) }, DEFAULT_LEDGER_CONFIG);
  const o1 = overridden.stays.find((s) => s.reservationId === 'R1')!;
  assert.equal(o1.channel, 'DIREKT_HAGYOMANYOS');
  assert.equal(o1.segment, 'UZLETI_CSOPORTOS');

  const withFx = buildDaySources({ ...base, day: '2026-11-18', reservations }, { ...DEFAULT_LEDGER_CONFIG, fxRates: { EUR: 390 } });
  assert.equal(withFx.stays.find((s) => s.reservationId === 'R5')!.accommodationFee, 46800);
});

Deno.test('advance booking build, validation and schema', async () => {
  const rows = [res({ id: 'B1', status: 'confirmed', check_in_date: '2026-12-05', check_out_date: '2026-12-10', channex_booking_id: 'CHX-9', ota_name: 'Expedia' }),
    res({ id: 'B2', status: 'confirmed', check_in_date: '2026-12-05', check_out_date: '2026-12-10', channex_booking_id: 'CHX-9', adults: 1, total_amount: 80000 })];
  const opts = { eventCreatedAt: '2026-11-19T05:00:00Z', today: '2026-11-19', originCountry: 'DE', isCompany: false, unitFor: () => ({ unitType: 'STANDARD' as const, capacity: 2 }) };
  const built = buildBooking(rows, opts, DEFAULT_LEDGER_CONFIG);
  assert.deepEqual(built.problems, []);
  assert.equal(built.booking!.bookingNo, 'CHX-9');
  assert.equal(built.booking!.guestCount, 3);
  assert.equal(built.booking!.grossAmount, 200000);
  assert.equal(built.booking!.units.length, 2);
  await assertValid(buildFoglalasEsemenyRequest(common(), built.booking!));

  const cancelled = buildBooking(rows.map((r) => ({ ...r, status: 'cancelled' })), opts, DEFAULT_LEDGER_CONFIG);
  assert.equal(cancelled.booking!.cancelled, true);
  const unknown = buildBooking(rows, { ...opts, originCountry: null }, DEFAULT_LEDGER_CONFIG);
  assert.equal(unknown.booking!.originCountry, 'EGYEBKULFOLDI');
  await assertValid(buildFoglalasEsemenyRequest(common(), { ...unknown.booking!, guaranteed: null }));
  assert.equal(buildBooking(rows, { ...opts, today: '2026-12-06' }, DEFAULT_LEDGER_CONFIG).skip, 'arrival is in the past (not accepted by NTAK)');
  const tooMany = buildBooking([res({ status: 'confirmed', check_in_date: '2026-12-05', check_out_date: '2026-12-06', adults: 7 })], opts, DEFAULT_LEDGER_CONFIG);
  assert.match(tooMany.problems.join(), /exceeds capacity/);
});

Deno.test('event, verification and start-date requests pass the schema', async () => {
  const unit = { building: 'A', roomNumber: '101', unitType: 'STANDARD' as const, singleBeds: 0, doubleBeds: 1, extraBeds: 0 };
  const g = { vendegId: vid(1), birthYear: 1980, sex: 'NO' as const, nationality: 'HU', residenceCountry: 'HU', postalCode: '2014', ifaStatus: 'KOTELES' };
  await assertValid(buildEsemenyvezereltRequest(common(), [
    { kind: 'erkezett', at: '2026-11-18T14:02:11Z', bookingNo: 'CHX-1', guests: [g], unit },
    { kind: 'lakoegysegetCserelt', at: '2026-11-18T18:00:00Z', bookingNo: 'CHX-1', guests: [g], from: unit, to: { ...unit, roomNumber: '102' } },
    { kind: 'tavozott', at: '2026-11-18T19:00:00Z', bookingNo: 'CHX-2', guests: [g], unit },
  ]));
  await assertValid(buildEllenorzesRequest(common(), [crypto.randomUUID(), crypto.randomUUID()]));
  await assertValid(buildAdatszolgaltatasKezdoDatumRequest(common()));
});

Deno.test('WSDL of 26 Nov 2026: stay events carry one vendegek list with a vendeg per guest', async () => {
  const unit = { building: 'A', roomNumber: '101', unitType: 'STANDARD' as const, singleBeds: 0, doubleBeds: 1, extraBeds: 0 };
  const g = (n: number) => ({ vendegId: vid(n), birthYear: 1980 + n, sex: 'NO' as const, nationality: 'HU', residenceCountry: 'HU', postalCode: '2014', ifaStatus: 'KOTELES' });
  const xml = buildEsemenyvezereltRequest(common(), [
    { kind: 'erkezett', at: '2026-11-18T14:02:11Z', bookingNo: 'CHX-1', guests: [g(1), g(2)], unit },
    { kind: 'lakoegysegetCserelt', at: '2026-11-18T18:00:00Z', bookingNo: 'CHX-1', guests: [g(1), g(2)], from: unit, to: { ...unit, roomNumber: '102' } },
  ]);
  await assertValid(xml);
  assert.equal(xml.split('<v9:vendegek>').length - 1, 2, 'one vendegek list per event');
  assert.equal(xml.split('<v9:vendeg>').length - 1, 4, 'one vendeg per guest');
  assert.ok(xml.includes('<v9:foglalasiSzam>CHX-1</v9:foglalasiSzam><v9:vendegek><v9:vendeg><v9:vendegId>'));
  // The shape of the earlier published schema (repeated vendegek) is refused by the current one.
  const old = xml.replace(/<v9:vendegek>|<\/v9:vendegek>/g, '').replace(/<v9:vendeg>/g, '<v9:vendegek>').replace(/<\/v9:vendeg>/g, '</v9:vendegek>');
  const file = await Deno.makeTempFile({ suffix: '.xml' });
  await Deno.writeTextFile(file, old);
  assert.notEqual((await run('xmllint', ['--noout', '--schema', XSD, file])).code, 0);
});

Deno.test('WSDL of 26 Nov 2026: provider names are limited to 255 characters', async () => {
  await assertValid(buildAdatszolgaltatasKezdoDatumRequest({ ...common(), accommodationName: '  Test   Property  ' }));
  assert.throws(() => buildAdatszolgaltatasKezdoDatumRequest({ ...common(), accommodationName: 'x'.repeat(256) }), /szallasNev is longer than 255/);
  assert.throws(() => buildAdatszolgaltatasKezdoDatumRequest({ ...common(), providerName: 'y'.repeat(300) }), /szallashelySzolgaltatoNev is longer than 255/);
});

Deno.test('WSDL of 26 Nov 2026: start dates come in their own list of the verification answer', async () => {
  const body = (inner: string) => `<ns2:ellenorzesResponse xmlns:ns2="http://mtu.gov.hu/ntak/v9">${inner}</ns2:ellenorzesResponse>`;
  const envelope = (inner: string) => `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body>${body(inner)}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  const start = `<ns2:adatszolgaltatasKezdoDatumok><ns2:feldolgozasAzonosito>56f0b8bc-bac3-4909-ab59-dfb99e3d56b6</ns2:feldolgozasAzonosito><ns2:elvartAdatszolgaltatasKezdoDatuma>2026-12-01</ns2:elvartAdatszolgaltatasKezdoDatuma></ns2:adatszolgaltatasKezdoDatumok>`;
  const status = `<ns2:uzenetValaszok><ns2:feldolgozasAzonosito>56f0b8bc-bac3-4909-ab59-dfb99e3d56b6</ns2:feldolgozasAzonosito><ns2:statusz>TELJESEN_SIKERES</ns2:statusz><ns2:figyelmeztetesLista/><ns2:hibaLista/></ns2:uzenetValaszok>`;
  for (const inner of [start, start + status]) await assertValid(body(inner));

  const onlyDate = parseNtakResponse(envelope(start));
  assert.equal(onlyDate.kind, 'verification');
  if (onlyDate.kind !== 'verification') throw new Error();
  assert.deepEqual(onlyDate.results, [{ processingId: '56f0b8bc-bac3-4909-ab59-dfb99e3d56b6', status: 'TELJESEN_SIKERES', warnings: [], errors: [], expectedStartDate: '2026-12-01' }]);

  const both = parseNtakResponse(envelope(start + status.replace('TELJESEN_SIKERES', 'BEFOGADVA')));
  if (both.kind !== 'verification') throw new Error();
  assert.equal(both.results.length, 1);
  assert.equal(both.results[0].status, 'BEFOGADVA');
  assert.equal(both.results[0].expectedStartDate, '2026-12-01');
});

Deno.test('WSDL of 26 Nov 2026: an error may name the building, room and booking it concerns', () => {
  const hiba = (where: string) => `<ns2:hiba><ns2:mezoNeve>esemenyek.erkezett.lakoegyseg.szobaszam</ns2:mezoNeve><ns2:kuldottErtek>999</ns2:kuldottErtek><ns2:hibaKulcs>ErvenytelenErtek</ns2:hibaKulcs><ns2:hibaUzenet>Hiba</ns2:hibaUzenet>${where}</ns2:hiba>`;
  const answer = (where: string) => parseNtakResponse(`<ns2:esemenyvezereltAdatkuldesResponse xmlns:ns2="http://mtu.gov.hu/ntak/v9"><ns2:hibaLista>${hiba(where)}</ns2:hibaLista><ns2:figyelmeztetesLista/></ns2:esemenyvezereltAdatkuldesResponse>`);
  const located = answer('<ns2:epulet>A</ns2:epulet><ns2:szobaszam>999</ns2:szobaszam><ns2:foglalasiSzam>CHX-1</ns2:foglalasiSzam>');
  if (located.kind !== 'rejected') throw new Error();
  assert.equal(located.errors[0].building, 'A');
  assert.equal(located.errors[0].room, '999');
  assert.equal(located.errors[0].bookingNo, 'CHX-1');
  const nil = answer('<ns2:epulet xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="true"/><ns2:szobaszam/><ns2:foglalasiSzam></ns2:foglalasiSzam>');
  if (nil.kind !== 'rejected') throw new Error();
  assert.equal(nil.errors[0].building, undefined);
  assert.equal(nil.errors[0].room, undefined);
  assert.equal(nil.errors[0].bookingNo, undefined);
});

Deno.test('published spec example needs live-endpoint name fields to validate', async () => {
  const xml = `<v9:foglalasEsemenyRequest xmlns:v9="http://mtu.gov.hu/ntak/v9"><v9:uzenetAdatok><v9:uzenetId>686d1d95-a4b6-45d8-a260-94befe406035</v9:uzenetId><v9:uzenetKuldesIdeje>2025-11-27T12:46:00Z</v9:uzenetKuldesIdeje></v9:uzenetAdatok><v9:szoftverAdatok><v9:szoftverVerzio>v1</v9:szoftverVerzio><v9:szoftverAzonosito>MINTA525252</v9:szoftverAzonosito></v9:szoftverAdatok><v9:szallashely><v9:szallasRegisztraciosSzam>SZ25003491</v9:szallasRegisztraciosSzam><v9:szallashelySzolgaltatoAdoszam>69861195-2-44</v9:szallashelySzolgaltatoAdoszam></v9:szallashely><v9:foglalasEsemeny><v9:foglalasiSzam>11111114</v9:foglalasiSzam><v9:esemenyLetrejotte>2025-11-27T10:58:00Z</v9:esemenyLetrejotte><v9:garantaltFoglalas>false</v9:garantaltFoglalas><v9:lemondva>false</v9:lemondva><v9:vendegKuldoOrszaga>HU</v9:vendegKuldoOrszaga><v9:erkezes>2025-12-05</v9:erkezes><v9:tavozas>2025-12-10</v9:tavozas><v9:foglalasIdopont>2025-11-03T02:36:00Z</v9:foglalasIdopont><v9:ertekesitesiCsatorna>DIREKT_HAGYOMANYOS</v9:ertekesitesiCsatorna><v9:foglalasBruttoOsszege>100000</v9:foglalasBruttoOsszege><v9:foglaltLakoegysegek><v9:foglaltLakoegyseg><v9:tipus>ECONOMY</v9:tipus><v9:ferohelyKapacitas>1</v9:ferohelyKapacitas></v9:foglaltLakoegyseg></v9:foglaltLakoegysegek><v9:piaciSzegmens>UZLETI_EGYENI</v9:piaciSzegmens><v9:vendegszam>1</v9:vendegszam></v9:foglalasEsemeny></v9:foglalasEsemenyRequest>`;
  // The published example omits names; the November 2026 test endpoint requires both.
  const adapted = xml.replace('</v9:szallashely>',
    '<v9:szallasNev>Ceylon Business Services Kft</v9:szallasNev>'
    + '<v9:szallashelySzolgaltatoNev>Interface_csatlakozás_szolgáltató_v9</v9:szallashelySzolgaltatoNev>'
    + '</v9:szallashely>');
  await assertValid(adapted);
});

Deno.test('responses: acceptance, faults and verification statuses (10.6, 11.x)', () => {
  const ok = parseNtakResponse(`<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Header/><SOAP-ENV:Body><ns2:napiZarasResponse xmlns:ns2="http://mtu.gov.hu/ntak/v9"><ns2:feldolgozasAzonosito>460b5dd8-780e-48dd-8cd5-2c6e9091b596</ns2:feldolgozasAzonosito></ns2:napiZarasResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`);
  assert.deepEqual(ok, { kind: 'accepted', processingId: '460b5dd8-780e-48dd-8cd5-2c6e9091b596', warnings: [] });

  const fault = parseNtakResponse(`<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>SOAP-ENV:Server</faultcode><faultstring xml:lang="en">Validation Error</faultstring><detail><error hibaKulcs="JovobeliDatum" hibaUzenet="A mező időpontja nem lehet jövőbeli!" kuldottErtek="2030-01-01T00:00:00Z" mezoNeve="napiFeltoltes.lezarasIdopont"/><error hibaUzenet="cvc-datatype-valid.1.2.1: '' is not a valid value for 'integer'." mezoNeve="GLOBAL"/></detail></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`);
  assert.equal(fault.kind, 'rejected');
  if (fault.kind !== 'rejected') throw new Error();
  assert.equal(fault.faultString, 'Validation Error');
  assert.equal(fault.errors[0].key, 'JovobeliDatum');
  assert.equal(fault.errors[0].field, 'napiFeltoltes.lezarasIdopont');
  assert.match(fault.errors[0].hint!, /future/);
  assert.equal(fault.errors[1].field, 'GLOBAL');

  const verify = parseNtakResponse(`<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><ns2:ellenorzesResponse xmlns:ns2="http://mtu.gov.hu/ntak/v9">`
    + `<ns2:uzenetValaszok><ns2:feldolgozasAzonosito>8289e837-ca2d-4cd6-9c8b-fd19981ebaa7</ns2:feldolgozasAzonosito><ns2:statusz>TELJESEN_HIBAS</ns2:statusz><ns2:figyelmeztetesLista><ns2:hiba><ns2:mezoNeve>napiFeltoltes.szobaAdatok.osszesSzoba</ns2:mezoNeve><ns2:kuldottErtek>11</ns2:kuldottErtek><ns2:hibaKulcs>ElteresRegisztraltAdatokban</ns2:hibaKulcs><ns2:hibaUzenet>Értéke eltér az NTAK regisztrációs adatokban megadott értéktől!</ns2:hibaUzenet></ns2:hiba></ns2:figyelmeztetesLista><ns2:hibaLista><ns2:hiba><ns2:mezoNeve>napiFeltoltes.napiZarasBesorolas.besorolas</ns2:mezoNeve><ns2:kuldottErtek>MODOSITO</ns2:kuldottErtek><ns2:hibaKulcs>ErvenytelenModositoZaras</ns2:hibaKulcs><ns2:hibaUzenet>Hiba</ns2:hibaUzenet></ns2:hiba></ns2:hibaLista></ns2:uzenetValaszok>`
    + `<ns2:uzenetValaszok><ns2:feldolgozasAzonosito>92e1edba-9483-4cc8-8fda-b7e260575199</ns2:feldolgozasAzonosito><ns2:statusz>TELJESEN_SIKERES</ns2:statusz><ns2:figyelmeztetesLista/><ns2:hibaLista/></ns2:uzenetValaszok>`
    + `<ns2:uzenetValaszok><ns2:feldolgozasAzonosito>56f0b8bc-bac3-4909-ab59-dfb99e3d56b6</ns2:feldolgozasAzonosito><ns2:statusz>TELJESEN_SIKERES</ns2:statusz><ns2:figyelmeztetesLista/><ns2:hibaLista/><ns2:elvartAdatszolgaltatasKezdoDatuma>2025-08-01</ns2:elvartAdatszolgaltatasKezdoDatuma></ns2:uzenetValaszok>`
    + `</ns2:ellenorzesResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`);
  assert.equal(verify.kind, 'verification');
  if (verify.kind !== 'verification') throw new Error();
  assert.equal(verify.results[0].status, 'TELJESEN_HIBAS');
  assert.equal(verify.results[0].warnings[0].key, 'ElteresRegisztraltAdatokban');
  assert.equal(verify.results[0].errors[0].key, 'ErvenytelenModositoZaras');
  assert.equal(verify.results[1].errors.length, 0);
  assert.equal(verify.results[2].expectedStartDate, '2025-08-01');
});

Deno.test('signed envelope verifies with our checker and with libxml2 exclusive C14N', async () => {
  const { keyPem, certPem, dir } = await testCertificate();
  const request = buildNapiZarasRequest(common(), assembleClosure(closureSource(), settings).closure)
    // Non-ASCII text, quotes and escaped characters must survive canonicalization unchanged.
    .replace('<v9:epulet>A</v9:epulet>', '<v9:epulet>Nyugati szárny &amp; "B" &gt; C</v9:epulet>');
  for (const profile of ['rsa-sha384', 'rsa-sha256', 'rsa-sha512'] as const) {
    const envelope = await signEnvelope({ requestXml: request, certPem, key: await importSigningKey(keyPem, profile), profile });
    assert.deepEqual(await verifyEnvelope(envelope), { ok: true, problems: [] });
    await Deno.writeTextFile(`${dir}/env.xml`, envelope);
    const r = await run('python3', [DIR + 'verify_envelope.py', `${dir}/env.xml`]);
    assert.equal(r.code, 0, `${profile}: ${r.err || r.out}`);
    assert.match(r.out, /OK \['Body', 'Timestamp'\]/);
    const tampered = envelope.replace('<v9:osszesSzoba>3</v9:osszesSzoba>', '<v9:osszesSzoba>4</v9:osszesSzoba>');
    assert.equal((await verifyEnvelope(tampered)).ok, false);
    await Deno.writeTextFile(`${dir}/bad.xml`, tampered);
    assert.notEqual((await run('python3', [DIR + 'verify_envelope.py', `${dir}/bad.xml`])).code, 0);
  }
});

Deno.test('text escaping matches c14n and amounts/dates are formatted for NTAK', () => {
  assert.equal(escText('a & b < c > d "e" \'f\'\r'), 'a &amp; b &lt; c &gt; d "e" \'f\'&#xD;');
  assert.equal(formatAmount(18000), '18000');
  assert.equal(formatAmount(1.905), '1.91');
  assert.equal(formatAmount(-0.001), '0');
  assert.equal(xsDateTime('2024-03-27T08:04:09.123Z'), '2024-03-27T08:04:09Z');
});

Deno.test('CSR is a valid PKCS#10 RSA-4096/SHA-256 request with clientAuth (6.1.1)', async () => {
  const { csrPem, privateKeyPem, spkiSha256 } = await generateCsr('SZ25003491');
  assert.ok(spkiSha256.length > 40);
  const r = await run('openssl', ['req', '-verify', '-noout', '-text'], csrPem);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out + r.err, /verify OK|Certificate request self-signature verify OK/i);
  assert.match(r.out, /Public-Key: \(4096 bit\)/);
  assert.match(r.out, /sha256WithRSAEncryption/);
  assert.match(r.out, /TLS Web Client Authentication/);
  assert.match(r.out, /Digital Signature, Non Repudiation, Key Encipherment/);
  assert.match(r.out, /CN\s*=\s*SZ25003491/);
  assert.ok(privateKeyPem.startsWith('-----BEGIN PRIVATE KEY-----'));
});

Deno.test('certificate parsing, key matching and PKCS#1 keys', async () => {
  const { keyPem, certPem, dir } = await testCertificate();
  const info = parseCertificate(certPem);
  assert.equal(info.subject.CN, 'SZ25003491');
  assert.equal(info.subject.OU, 'ABCD1234');
  assert.equal(info.subject.organizationIdentifier, 'VATHU-69861195');
  assert.ok(Date.parse(info.notAfter) > Date.now());
  assert.equal(effectiveExpiry(info.notAfter).getTime(), Date.parse(info.notAfter) - 3 * 86400000);
  assert.equal(await keyMatchesCertificate(keyPem, certPem), true);
  const other = await testCertificate();
  assert.equal(await keyMatchesCertificate(other.keyPem, certPem), false);
  assert.equal((await run('openssl', ['genrsa', '-traditional', '-out', `${dir}/k1.pem`, '2048'])).code, 0);
  const pkcs1 = await Deno.readTextFile(`${dir}/k1.pem`);
  assert.ok(pkcs1.includes('BEGIN RSA PRIVATE KEY'));
  const pkcs8 = normalizePrivateKeyPem(pkcs1);
  assert.ok(pkcs8.includes('BEGIN PRIVATE KEY'));
  await importSigningKey(pkcs8);
});


Deno.test('Phase 2 FOGL_01/FOGL_02: T02 arrival, T03 room change and T04 departure preserve idopont and validate XML', async () => {
  // NTAK groups events by kind inside the message. Verify exact moments per
  // booking/kind rather than relying on the order within the XML document.
  const guest = { vendegId: vid(1), birthYear: 1980, sex: 'NO' as const, nationality: 'HU', residenceCountry: 'HU', postalCode: '1051', ifaStatus: 'KOTELES' };
  const room101 = { building: '1', roomNumber: '101', unitType: 'STANDARD' as const, singleBeds: 0, doubleBeds: 1, extraBeds: 0 };
  const room102 = { ...room101, roomNumber: '102' };
  const room103 = { ...room101, roomNumber: '103' };
  const events = [
    { kind: 'erkezett' as const, at: '2026-11-18T13:00:00Z', bookingNo: 'FOGL_01', guests: [guest], unit: room101 },
    { kind: 'erkezett' as const, at: '2026-11-18T13:15:00Z', bookingNo: 'FOGL_02', guests: [guest], unit: room103 },
    { kind: 'lakoegysegetCserelt' as const, at: '2026-11-19T09:30:00Z', bookingNo: 'FOGL_01', guests: [guest], from: room101, to: room102 },
    { kind: 'tavozott' as const, at: '2026-11-20T09:00:00Z', bookingNo: 'FOGL_01', guests: [guest], unit: room102 },
    { kind: 'tavozott' as const, at: '2026-11-20T09:10:00Z', bookingNo: 'FOGL_02', guests: [guest], unit: room103 },
  ];
  const xml = buildEsemenyvezereltRequest(common(), events);
  for (const instant of events.map((event) => event.at)) {
    assert.ok(xml.includes(instant.replace('.000Z', 'Z')), `missing idopont for ${instant}`);
  }
  assert.match(xml, /FOGL_01/);
  assert.match(xml, /FOGL_02/);
  assert.match(xml, /lakoegysegetCserelt/);
  await assertValid(xml);
});

Deno.test('Phase 2 historical closures follow actual arrival/departure and room assignment segments', () => {
  const a = res({
    id: 'FOGL_01', reservation_number: 'FOGL_01', room_id: 'r102',
    status: 'checked_out', check_in_date: '2026-11-17', check_out_date: '2026-11-21',
    actual_check_in: '2026-11-18T13:00:00Z', actual_check_out: '2026-11-20T09:00:00Z',
  });
  const b = res({
    id: 'FOGL_02', reservation_number: 'FOGL_02', room_id: 'r103',
    status: 'checked_out', check_in_date: '2026-11-18', check_out_date: '2026-11-21',
    actual_check_in: '2026-11-18T13:15:00Z', actual_check_out: '2026-11-20T09:10:00Z',
  });
  const assignments = [
    { reservation_id: 'FOGL_01', room_id: 'r101', check_in_date: '2026-11-18', check_out_date: '2026-11-19', status: 'completed' },
    { reservation_id: 'FOGL_01', room_id: 'r102', check_in_date: '2026-11-19', check_out_date: '2026-11-21', status: 'completed' },
    { reservation_id: 'FOGL_02', room_id: 'r103', check_in_date: '2026-11-18', check_out_date: '2026-11-21', status: 'completed' },
  ];
  const base = { reservations: [a, b], assignments, lines: [], payments: [],
    guestsFor: () => [guest(1)], isCompany: () => false, roomsInBooking: () => 1,
    label: (r: RawReservation) => r.id };
  const T01 = buildDaySources({ ...base, day: '2026-11-17' }, DEFAULT_LEDGER_CONFIG);
  assert.ok(!T01.stays.some((x) => x.bookingNo === 'FOGL_01'), 'do not report a night before actual check-in');
  const T02 = buildDaySources({ ...base, day: '2026-11-18' }, DEFAULT_LEDGER_CONFIG);
  assert.equal(T02.stays.find((x) => x.bookingNo === 'FOGL_01')?.roomId, 'r101');
  assert.equal(T02.stays.find((x) => x.bookingNo === 'FOGL_02')?.roomId, 'r103');
  const T03 = buildDaySources({ ...base, day: '2026-11-19' }, DEFAULT_LEDGER_CONFIG);
  assert.equal(T03.stays.find((x) => x.bookingNo === 'FOGL_01')?.roomId, 'r102');
  const T04 = buildDaySources({ ...base, day: '2026-11-20' }, DEFAULT_LEDGER_CONFIG);
  assert.equal(T04.checkouts.find((x) => x.bookingNo === 'FOGL_01')?.roomId, 'r102');
  assert.equal(T04.checkouts.find((x) => x.bookingNo === 'FOGL_02')?.roomId, 'r103');
});


Deno.test('FOGL_03 ES_06A/B: day-use check-in, room change and check-out on T02 produce valid NTAK idopont XML', async () => {
  const T02 = '2026-11-18';
  const dayUse = res({
    id: 'FOGL_03', reservation_number: 'FOGL_03',
    status: 'checked_out', check_in_date: T02, check_out_date: T02,
    actual_check_in: '2026-11-18T08:00:00Z',
    actual_check_out: '2026-11-18T11:00:00Z',
    room_id: 'r102', total_amount: 28000, rate_per_night: 28000, adults: 1,
  });
  // Keep arrival/departure dates equal. The dated assignment extends through
  // the business day so roomOnDay can attribute FOGL_03 to the final room.
  const assignments = [
    { reservation_id: 'FOGL_03', room_id: 'r101', check_in_date: T02, check_out_date: T02, status: 'cancelled' },
    { reservation_id: 'FOGL_03', room_id: 'r102', check_in_date: T02, check_out_date: '2026-11-19', status: 'completed' },
  ];
  const base = {
    reservations: [dayUse], assignments, lines: [], payments: [],
    guestsFor: () => [guest(1)], isCompany: () => false, roomsInBooking: () => 1,
    label: (r: RawReservation) => r.id,
  };
  const NZ_05 = buildDaySources({ ...base, day: T02 }, DEFAULT_LEDGER_CONFIG);
  assert.equal(NZ_05.stays.length, 1, 'day use must appear in its same-day closure');
  assert.equal(NZ_05.stays[0].bookingNo, 'FOGL_03');
  assert.equal(NZ_05.stays[0].roomId, 'r102', 'the final assigned room is reported');
  assert.equal(NZ_05.stays[0].dayUse, true, 'no overnight room-night is sold');
  assert.equal(NZ_05.stays[0].accommodationFee, 28000);
  assert.equal(NZ_05.checkouts.length, 0, 'day use is not a second overnight checkout');
  const prior = buildDaySources({ ...base, day: '2026-11-17' }, DEFAULT_LEDGER_CONFIG);
  assert.equal(prior.stays.length, 0, 'not reported on the previous day');

  const g = { vendegId: vid(1), birthYear: 1980, sex: 'NO' as const, nationality: 'HU', residenceCountry: 'HU', postalCode: '1051', ifaStatus: 'KOTELES' };
  const room101 = { building: '1', roomNumber: '101', unitType: 'STANDARD' as const, singleBeds: 0, doubleBeds: 1, extraBeds: 0 };
  const room102 = { ...room101, roomNumber: '102' };
  const events = [
    { kind: 'erkezett' as const, at: '2026-11-18T08:00:00Z', bookingNo: 'FOGL_03', guests: [g], unit: room101 },
    { kind: 'lakoegysegetCserelt' as const, at: '2026-11-18T09:30:00Z', bookingNo: 'FOGL_03', guests: [g], from: room101, to: room102 },
    { kind: 'tavozott' as const, at: '2026-11-18T11:00:00Z', bookingNo: 'FOGL_03', guests: [g], unit: room102 },
  ];
  const xml = buildEsemenyvezereltRequest(common(), events);
  assert.equal((xml.match(/<v9:idopont>/g) ?? []).length, 3);
  for (const { at } of events) {
    assert.ok(xml.includes('<v9:idopont>' + at + '</v9:idopont>'), 'FOGL_03 missing exact idopont ' + at);
  }
  assert.match(xml, /<v9:lakoegysegetCserelt>/);
  await assertValid(xml);
});

Deno.test('Phase 2 SQL contract: day-use room conflicts, picker range and negative adjustment guard', async () => {
  // Source assertions; actual SQL RPC tests require staging migration.
  const migration = await Deno.readTextFile(new URL('../../../migrations/20261123185000_ntak_phase2_business_moment.sql', import.meta.url));
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.pms_room_has_conflict\(/);
  assert.match(migration, /_to = _from THEN _from \+ 1 ELSE _to/);
  assert.match(migration, /r\.check_in_date = r\.check_out_date AND r\.check_in_date >= _from/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.pms_available_rooms\(/);
  assert.match(migration, /_to < _from THEN/);
  assert.match(migration, /day_use := r\.check_in_date = r\.check_out_date/);
  assert.match(migration, /day_use AND day <> r\.check_in_date/);
  assert.match(migration, /CASE WHEN day_use THEN day \+ 1 ELSE r\.check_out_date END/);
  assert.match(migration, /_amount=0 OR ABS\(_amount\)>100000000/);
  assert.match(migration, /_amount < 0 AND _charge_type <> 'adjustment'/);
  assert.match(migration, /ELSIF _charge_type='adjustment' AND _amount < 0 THEN/);
  assert.match(migration, /INSERT INTO public\.folio_lines/);
  assert.match(migration, /PERFORM public\.pms_finance_recalculate_reservation\(r\.id\)/);
});


Deno.test('Phase 7: NZ_04A/B correcting a guest retains identity, 400 HUF rate and two guest nights', async () => {
  const src = closureSource();
  const fixed: ClosureSettings = { ...settings, ifa: { type: 'TETELES', rate: 400 }, ifaVat: 0 };
  const sergey = guest(1, { name: 'Sergey Cherkasov', birthDate: '1986-01-01', ifaStatus: 'KOTELES' });
  src.stays[0].guests = [sergey, guest(2, { ifaStatus: 'KOTELES' })];
  const before = assembleClosure(src, fixed);
  assert.equal(before.closure.ifa?.rate, 400);
  assert.equal(before.totals.ifa, 800);
  assert.equal(before.totals.guests, 2);
  assert.equal(before.closure.rooms.rented, 1);
  assert.equal(before.closure.nights[0].guests[0].birthYear, 1986);
  await assertValid(buildNapiZarasRequest(common(), before.closure));

  // Verified national im5; keep the originally transmitted guest ID.
  src.classification = 'MODOSITO';
  src.reason = 'VENDEG_VAGY_IFA_JAVITAS';
  src.protocolId = 'NZ-04B-TEST';
  src.stays[0].guests[0] = { ...sergey, birthDate: '1987-02-11', ifaStatus: 'im5' };
  const after = assembleClosure(src, fixed);
  assert.equal(after.closure.ifa?.rate, 400);
  assert.equal(after.totals.ifa, 400);
  assert.equal(after.totals.guests, 2);
  assert.equal(after.closure.rooms.rented, 1);
  assert.equal(after.closure.nights[0].guests[0].birthYear, 1987);
  assert.equal(after.closure.nights[0].guests[0].vendegId, sergey.vendegId);
  assert.equal(after.closure.nights[0].guests[0].ifaStatus, 'im5');
  assert.deepEqual(after.closure.nights[0].sold!.outPackage.filter(c => c.main === 'IFA'), [{ amount: 400, main: 'IFA', sub: null, vat: 0 }]);
  assert.ok(!hasBlockingErrors(after.checklist), JSON.stringify(after.checklist));
  const xml = buildNapiZarasRequest(common(), after.closure);
  assert.ok(xml.includes('VENDEG_VAGY_IFA_JAVITAS'));
  assert.ok(xml.includes('<v9:jegyzokonyvAzonosito>NZ-04B-TEST</v9:jegyzokonyvAzonosito>'));
  await assertValid(xml);
  assert.equal(effectiveIfaStatus('2010-11-19', src.day, 'KOTELES'), 'im1');
});

Deno.test('Phase 8 NZ_03 explicit category coverage and seven payment methods', async () => {
  const day = '2026-11-18';
  const base = { reservation_id: 'r', service_date: day, vat_rate: 27, currency: 'HUF', status: 'open', category: 'other', source_type: 'manual' };
  const lines = Object.entries(CATEGORIES).flatMap(([main, subs]) => subs.filter(sub => !(main === 'EGYEB' && sub === 'EGYEB_VENDEGLATAS')).map(sub => ({ ...base, gross_total: 1, ntak_main: main, ntak_sub: sub, in_package: false })));
  assert.equal(lines.length, 67);
  const problems: string[] = [];
  assert.deepEqual(mapExtras(lines, DEFAULT_LEDGER_CONFIG, problems).map(c => [c.main,c.sub]), lines.map(l=>[l.ntak_main,l.ntak_sub]));
  assert.equal(mapExtras([{...base,gross_total:5,ntak_main:'ETEL',ntak_sub:'SOR'}], DEFAULT_LEDGER_CONFIG, problems).length,0);
  assert.match(problems.pop() ?? '', /Invalid catalogue NTAK category/);
  assert.deepEqual(problems, []);
  const payments = ['cash','card_terminal','bank_transfer','coupon','szep_otp','on_account','other'].map((method, i) => ({ reservation_id: 'r', amount: i < 5 ? 4067 : 4066, currency: 'HUF', method, status: 'recorded', received_at: day + 'T12:00:00Z' }));
  const mapped = mapPayments(payments, DEFAULT_LEDGER_CONFIG, problems);
  assert.equal(mapped.length, 7);
  assert.equal(mapped.reduce((n,p) => n + p.amount, 0), 28467);
  assert.deepEqual(mapped.map(p => p.type), ['KESZPENZ','BANKKARTYA','ATUTALAS','UTALVANY','SZEP_KARTYA','UTOLAGOS','EGYEB']);
  assert.equal(mapped.find(p => p.type === 'SZEP_KARTYA')?.szepAccommodation, true);
  const input = buildDaySources({ day, reservations: [res({ id: 'r', adults: 1, rate_per_night: 28000 })], lines, payments, assignments: [], guestsFor: () => [guest(1)], isCompany: () => false, roomsInBooking: () => 1, label: r => r.id }, DEFAULT_LEDGER_CONFIG);
  const assembled = assembleClosure({ ...closureSource(), ...input, otherCharges: [], otherPayments: [] }, { ...settings, accommodationVat: 5, ifa: { type: 'TETELES', rate: 400 } });
  assert.equal(hasBlockingErrors(assembled.checklist), false, JSON.stringify(assembled.checklist));
  assert.equal(assembled.totals.charges, 28467);
  assert.equal(assembled.totals.payments, 28467);
  await assertValid(buildNapiZarasRequest(common(), assembled.closure));
  const withPackage = buildDaySources({ day, reservations: [res({ id: 'r', adults: 1, rate_per_night: 28000 })], lines: [{...base,gross_total:5,ntak_main:'ETEL',ntak_sub:'REGGELI',in_package:true}], payments: [], assignments: [], guestsFor: () => [guest(1)], isCompany: () => false, roomsInBooking: () => 1, label: r => r.id }, DEFAULT_LEDGER_CONFIG);
  const pkg = assembleClosure({...closureSource(),...withPackage}, {...settings, accommodationVat:5, ifa:{type:'TETELES',rate:400}});
  const sold = pkg.closure.nights[0].sold;
  assert.ok(sold, 'package stay must have a sold unit');
  assert.equal(sold.inPackage.find(c=>c.sub==='REGGELI')?.amount,5);
  assert.equal(sold.inPackage.find(c=>c.main==='SZALLASDIJ')?.amount,28000);
  assert.ok(!sold.outPackage.some(c=>c.sub==='REGGELI'));
});

Deno.test('Phase 8 NZ_05 day-use in 103/104 and FOGL_01 post-departure postings', async () => {
  const day = '2026-11-22';
  const bookings = [res({ id: 'past', status: 'checked_out', check_in_date: '2026-11-19', check_out_date: '2026-11-21', ntak_booking_no: 'FOGL_01' }),
    res({ id: 'a', status: 'checked_out', check_in_date: day, check_out_date: day, room_id: 'r103', ntak_booking_no:'FOGL_03', adults:1, rate_per_night:28000 }),
    res({ id: 'b', status: 'checked_out', check_in_date: day, check_out_date: day, room_id: 'r104', ntak_booking_no:'FOGL_03', adults:1, rate_per_night:34500 })];
  const lines = [{ reservation_id:'past',service_date:day, gross_total:10000,vat_rate:27,currency:'HUF',status:'open',category:'other',source_type:'manual',ntak_main:'EGYEB',ntak_sub:'EGYEB',in_package:false }];
  const payments = [['past',10000,'card'],['a',28000,'cash'],['b',34500,'card']].map(([id,amount,method])=>({reservation_id:String(id),amount:Number(amount),currency:'HUF',method:String(method),status:'recorded',received_at:day+'T12:00:00Z'}));
  const source = buildDaySources({day,reservations:bookings,lines,payments,assignments:[],guestsFor:r=>r.id==='a'?[guest(1)]:r.id==='b'?[guest(2)]:[],isCompany:()=>false,roomsInBooking:()=>1,label:r=>r.id}, DEFAULT_LEDGER_CONFIG);
  const room104 = {...units()[0],roomId:'r104',roomNumber:'104'};
  const assembled = assembleClosure({...closureSource(),day,closedAt:day+'T23:00:00Z',units:[...units(),room104],...source,otherCharges:[],otherPayments:[]}, {...settings, registeredRooms:4, accommodationVat:5,ifa:{type:'TETELES',rate:400}});
  assert.equal(hasBlockingErrors(assembled.checklist),false,JSON.stringify(assembled.checklist));
  assert.equal(assembled.totals.roomNights,0);
  assert.equal(assembled.totals.ifa,0);
  assert.equal(assembled.closure.nights.length,2);
  assert.ok(assembled.closure.nights.every(n=>n.dayUse));
  assert.deepEqual(assembled.closure.nights.map(n=>{ assert.ok(n.sold, 'day-use stay must have a sold unit'); return n.sold.inPackage[0].amount; }),[28000,34500]);
  assert.equal(assembled.totals.charges,72500);
  assert.equal(assembled.totals.payments,72500);
  assert.deepEqual(assembled.closure.postStayCharges,[{bookingNo:'FOGL_01',date:'2026-11-21',charge:{amount:10000,main:'EGYEB',sub:'EGYEB',vat:27}}]);
  assert.deepEqual(assembled.closure.postStayPayments,[{bookingNo:'FOGL_01',date:day,payment:{amount:10000,type:'BANKKARTYA'}}]);
  await assertValid(buildNapiZarasRequest(common(),assembled.closure));
});

Deno.test('Phase 7: EU_02A IFA VAT setting reaches closure lines and XML', () => {
  const src = closureSource();
  src.stays[0].guests = [guest(1, { ifaStatus: 'KOTELES' })];
  const configured: ClosureSettings = { ...settings, ifa: { type: 'TETELES', rate: 400 }, ifaVat: 5 };
  const incorrect = assembleClosure(src, configured);
  const ifaLines = incorrect.closure.nights[0].sold!.outPackage.filter(c => c.main === 'IFA');
  assert.deepEqual(ifaLines, [{ amount: 400, main: 'IFA', sub: null, vat: 5 }]);
  const correct = assembleClosure(src, { ...configured, ifaVat: 0 });
  assert.deepEqual(correct.closure.nights[0].sold!.outPackage.filter(c => c.main === 'IFA'), [{ amount: 400, main: 'IFA', sub: null, vat: 0 }]);
  assert.notEqual(buildNapiZarasRequest(common(), incorrect.closure), buildNapiZarasRequest(common(), correct.closure));
});

Deno.test('MODOSITO requires a nonblank record ID and reason', () => {
  const src = closureSource();
  src.classification = 'MODOSITO';
  src.reason = 'VENDEG_VAGY_IFA_JAVITAS';
  for (const protocolId of [undefined, null, '', '   ', 'X'.repeat(26)]) {
    src.protocolId = protocolId;
    const result = assembleClosure(src, settings);
    assert.ok(result.checklist.some(c => c.level === 'error' && c.code === 'correction' && c.message.includes('record ID')));
  }
  src.protocolId = 'X'.repeat(25);
  assert.ok(!assembleClosure(src, settings).checklist.some(c => c.code === 'correction'));
  src.reason = ' ';
  assert.ok(assembleClosure(src, settings).checklist.some(c => c.code === 'correction' && c.message.includes('reason')));
});

Deno.test('National IFA status set is exact; im7 and municipal codes are refused', () => {
  const expected = ['KOTELES','im1','im2','im3','im4','im5','im6','im8','im9','im10'];
  assert.deepEqual(IFA_STATUSES.map(x => x.code), expected);
  for (const code of expected) assert.equal(isVerifiedIfaStatus(code), true);
  for (const code of ['im7','im11','im100','IM5',' im5','im5 ','','koteles']) assert.equal(isVerifiedIfaStatus(code), false);
  const src = closureSource();
  src.stays[0].guests = [guest(1,{ifaStatus:'im7'})];
  assert.ok(assembleClosure(src, settings).checklist.some(c => c.code === 'ifa_unverified' && c.level === 'error'));
});
Deno.test('EU_02B uses technical correction code, and UJ omits reason and record ID', async () => {
  const src = closureSource();
  const fixed: ClosureSettings = {...settings, ifa:{type:'TETELES',rate:400}, ifaVat:0};
  const newClosure = assembleClosure(src,fixed);
  const newXml = buildNapiZarasRequest(common(),newClosure.closure);
  // NTAK rejects an empty record ID on a new closure (NemKuldendoElem), so the element is left out.
  assert.ok(!newXml.includes('jegyzokonyvAzonosito'));
  assert.ok(newXml.includes('<v9:napiZarasBesorolas><v9:besorolas>UJ</v9:besorolas></v9:napiZarasBesorolas>'));
  assert.ok(!newXml.includes('<v9:indoklas>'));
  await assertValid(newXml);
  src.protocolId = 'invalid-on-UJ'; src.reason = 'EGYEB';
  assert.equal(assembleClosure(src,fixed).checklist.filter(c => c.code === 'correction').length,2);
  src.classification='MODOSITO'; src.protocolId='EU-02B-TEST'; src.reason='TECH_HIBA_ADATJAVITAS';
  const corrected = assembleClosure(src,fixed);
  assert.ok(!hasBlockingErrors(corrected.checklist), JSON.stringify(corrected.checklist));
  const xml = buildNapiZarasRequest(common(),corrected.closure);
  assert.ok(xml.includes('<v9:indoklas>TECH_HIBA_ADATJAVITAS</v9:indoklas>'));
  await assertValid(xml);
  assert.deepEqual(CLOSURE_CORRECTION_REASONS.map(r=>r.code),['VENDEG_VAGY_IFA_JAVITAS','SZOBA_VAGY_FEROHELY_MOD','TERHELES_VAGY_KOLTES_JAV','SZAMLAMODOSITAS','TECH_HIBA_ADATJAVITAS','ELLENORZES_ELTERES_JAV','ELOZO_BEKULDES_NEM_TELJES','EGYEB']);
  for (const r of CLOSURE_CORRECTION_REASONS) { src.reason=r.code; assert.ok(!assembleClosure(src,fixed).checklist.some(c=>c.code==='correction')); }
  for (const reason of ['free text','EGYEB ','egyeb','',null]) { src.reason=reason; assert.ok(assembleClosure(src,fixed).checklist.some(c=>c.code==='correction' && c.level==='error')); }
});
Deno.test('NZ_01 closed day leaves out IFA data (NemKuldendoElem)', async () => {
  const fixed: ClosureSettings = {...settings, ifa:{type:'TETELES',rate:400}, ifaVat:0};
  const open = assembleClosure(closureSource(), fixed).closure;
  assert.ok(buildNapiZarasRequest(common(), open).includes('<v9:ifaAdatok>'));
  const closedXml = buildNapiZarasRequest(common(), {...open, closed: true, nights: [], outOfService: []});
  assert.ok(closedXml.includes('<v9:szallashelyNemUzemel>true</v9:szallashelyNemUzemel>'));
  assert.ok(!closedXml.includes('ifaAdatok'));
  await assertValid(closedXml);
});
