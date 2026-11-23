/**
 * NTAK PMS v9 library tests.
 *   deno test --allow-read --allow-write --allow-run --allow-env supabase/functions/_shared/ntak/ntak_test.ts
 * Needs xmllint (libxml2-utils), openssl and python3 with lxml + cryptography.
 */
import { strict as assert } from 'node:assert';
import bcrypt from 'npm:bcryptjs@2.4.3';
import { categoryProblem, postalCodeProblem, primaryChargeLimit } from './codes.ts';
import { assembleClosure, hasBlockingErrors, type ClosureSource, type ClosureSettings, type StayGuest, type UnitInfo } from './closure.ts';
import { computeVendegId, generateSalt, guestHashInput, isValidSalt, missingIdentityFields } from './guestId.ts';
import { autoIfaStatus, ifaPerGuest } from './ifa.ts';
import { buildBooking, buildDaySources, DEFAULT_LEDGER_CONFIG, type RawReservation } from './ledger.ts';
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
  assert.ok(codes.includes('correction'), 'MODOSITO needs record id + reason');

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
  src.classification = 'MODOSITO'; src.protocolId = 'JK-2026-001'; src.reason = 'Szállásdíj javítása';
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

Deno.test('the published spec example validates against the consolidated schema', async () => {
  const xml = `<v9:foglalasEsemenyRequest xmlns:v9="http://mtu.gov.hu/ntak/v9"><v9:uzenetAdatok><v9:uzenetId>686d1d95-a4b6-45d8-a260-94befe406035</v9:uzenetId><v9:uzenetKuldesIdeje>2025-11-27T12:46:00Z</v9:uzenetKuldesIdeje></v9:uzenetAdatok><v9:szoftverAdatok><v9:szoftverVerzio>v1</v9:szoftverVerzio><v9:szoftverAzonosito>MINTA525252</v9:szoftverAzonosito></v9:szoftverAdatok><v9:szallashely><v9:szallasRegisztraciosSzam>SZ25003491</v9:szallasRegisztraciosSzam><v9:szallashelySzolgaltatoAdoszam>69861195-2-44</v9:szallashelySzolgaltatoAdoszam></v9:szallashely><v9:foglalasEsemeny><v9:foglalasiSzam>11111114</v9:foglalasiSzam><v9:esemenyLetrejotte>2025-11-27T10:58:00Z</v9:esemenyLetrejotte><v9:garantaltFoglalas>false</v9:garantaltFoglalas><v9:lemondva>false</v9:lemondva><v9:vendegKuldoOrszaga>HU</v9:vendegKuldoOrszaga><v9:erkezes>2025-12-05</v9:erkezes><v9:tavozas>2025-12-10</v9:tavozas><v9:foglalasIdopont>2025-11-03T02:36:00Z</v9:foglalasIdopont><v9:ertekesitesiCsatorna>DIREKT_HAGYOMANYOS</v9:ertekesitesiCsatorna><v9:foglalasBruttoOsszege>100000</v9:foglalasBruttoOsszege><v9:foglaltLakoegysegek><v9:foglaltLakoegyseg><v9:tipus>ECONOMY</v9:tipus><v9:ferohelyKapacitas>1</v9:ferohelyKapacitas></v9:foglaltLakoegyseg></v9:foglaltLakoegysegek><v9:piaciSzegmens>UZLETI_EGYENI</v9:piaciSzegmens><v9:vendegszam>1</v9:vendegszam></v9:foglalasEsemeny></v9:foglalasEsemenyRequest>`;
  await assertValid(xml);
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
