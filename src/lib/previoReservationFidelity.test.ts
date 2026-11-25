import { describe, expect, it } from 'vitest';
import {
  bookingsMissingFromPrevio, buildReservationTermXml, cleanChannelName, groupGuestNames, isPrevioBusyResponse, mapPrevioPaymentStatus, mapPrevioStatus, paymentFromPrevioAccount,
  mergePrevioFinancials, mergePrevioStatus, parsePrevioReservations, pmsFieldsEqual, resolveImportTarget,
} from '../../supabase/functions/_shared/previoReservations';

// Current Previo searchReservations shape: nested <status>, firstName/lastName,
// a <guestCategory><name> inside <guest>, structured <partner>, comId, voucher, cpsId.
const reservation = (overrides: Partial<Record<string, string>> = {}) => {
  const f = {
    comId: '72896165', resId: '54855023', statusId: '2', cpsId: '1', objId: '1894741', room: '202',
    guest: `<guest><gueId>2886012</gueId><firstName>Istvan</firstName><lastName>Holbach</lastName>
      <email>guest@example.com</email><phone>+3611234567</phone><note>guest-level note</note>
      <guestCategory><guaId>167238</guaId><name>Felnőtt</name></guestCategory></guest>`,
    note: '<note/>', ...overrides,
  };
  return `<reservation>
    <comId>${f.comId}</comId><resId>${f.resId}</resId><lanId>2</lanId><voucher>5462609756</voucher>
    <term><from>2026-11-08 15:00:00</from><to>2026-11-15 10:00:00</to></term>
    <created>2026-11-07 23:28:00</created>
    <currency><curId>2</curId><code>EUR</code></currency><price>675.24</price>
    <cpsId>${f.cpsId}</cpsId><editationLocked>0</editationLocked><prlId>84855</prlId>
    <status><statusId>${f.statusId}</statusId><optionExpiration>2026-11-09 12:00:00</optionExpiration></status>
    ${f.guest}
    <contactPerson><name>Istvan Holbach</name><phone>+36201234567</phone><email>booker@example.com</email></contactPerson>
    <object><objId>${f.objId}</objId><name>${f.room}</name></object>
    <objectKind><obkId>580906</obkId><name>DB/TW</name></objectKind>
    ${f.note}<gNote>breakfast In</gNote>
    <partner><prpId>5</prpId><name>Booking.com</name></partner>
  </reservation>`;
};
const xml = (...items: string[]) => `<?xml version="1.0"?><reservations>${items.join('')}</reservations>`;

describe('Previo reservation parser — current response shape', () => {
  const [row] = parsePrevioReservations(xml(reservation()));

  it('reads the guest name from firstName/lastName, never from the guest category', () => {
    expect(row.guestName).toBe('Istvan Holbach');
    expect(row.guestNames).toEqual(['Istvan Holbach']);
    expect(row.guestEmail).toBe('guest@example.com');
    expect(row.guestPhone).toBe('+3611234567');
  });

  it('reads the fields reception needs: room item id, voucher, payment, channel, contact', () => {
    expect(row).toMatchObject({
      resId: '54855023', comId: '72896165', voucher: '5462609756', statusId: 2, paymentStatus: 'paid',
      channel: 'Booking.com', channelId: '5', ratePlanId: '84855', locked: false,
      arrivalDate: '2026-11-08', departureDate: '2026-11-15', nights: 7, totalPrice: 675.24, currency: 'EUR',
      objId: '1894741', obkId: '580906', roomName: '202',
      contactName: 'Istvan Holbach', contactEmail: 'booker@example.com', contactPhone: '+36201234567',
      groupNote: 'breakfast In',
    });
    expect(row.optionExpiresAtIso).toBe('2026-11-09T11:00:00.000Z'); // Budapest winter time
  });

  it('does not mistake a guest-level note for the reservation note', () => {
    expect(row.note).toBeNull();
    const [withNote] = parsePrevioReservations(xml(reservation({ note: '<note>Late arrival</note>' })));
    expect(withNote.note).toBe('Late arrival');
  });

  it('keeps unknown payment ids and malformed ids as null instead of guessing', () => {
    const [odd] = parsePrevioReservations(xml(reservation({ cpsId: '9', comId: 'abc' })));
    expect(odd.paymentStatus).toBeNull();
    expect(odd.comId).toBeNull();
  });

  it('gives sibling rooms of a group booking the group guest name', () => {
    const rows = parsePrevioReservations(xml(
      reservation({ comId: '1', objId: '801' }),
      reservation({ comId: '2', objId: '802', guest: '' }),
    ));
    expect(rows.map((r) => r.sourceRef)).toEqual(['54855023:801', '54855023:802']);
    expect(rows[1].guestName).toBeNull();
    expect(groupGuestNames(rows).get('54855023')).toBe('Istvan Holbach');
  });
});

describe('Previo reservation parser — legacy response shape stays supported', () => {
  const legacy = xml(`<reservation><resId>123456</resId><statusId>3</statusId>
    <term><from>2026-09-04</from><to>2026-09-07</to></term><price>450.00</price>
    <currency><currId>2</currId><code>EUR</code></currency>
    <object><objId>782</objId><name>Double Deluxe 204</name></object>
    <guest><name>Anna</name><surname>Kovacs</surname><email>anna@example.com</email></guest>
    <guest><name>Peter</name><surname>Kovacs</surname></guest>
    <note>Late arrival after 22:00</note><sourceName>Booking.com</sourceName></reservation>`);

  it('parses name/surname guests, flat status and sourceName channel', () => {
    const [row] = parsePrevioReservations(legacy);
    expect(row).toMatchObject({
      guestName: 'Anna Kovacs', guestsCount: 2, statusId: 3, channel: 'Booking.com', note: 'Late arrival after 22:00',
      comId: null, voucher: null, paymentStatus: null, channelId: null,
    });
    expect(row.guestNames).toEqual(['Anna Kovacs', 'Peter Kovacs']);
  });
});

describe('Previo status mapping', () => {
  it('maps every documented Previo status', () => {
    expect([1, 2, 3, 6, 7, 8, 9, 10].map(mapPrevioStatus)).toEqual(
      ['pending', 'confirmed', 'checked_in', 'pending', 'cancelled', 'no_show', 'checked_out', 'confirmed']);
    expect(mapPrevioStatus(0)).toBe('confirmed'); // unknown id: unchanged behaviour
  });

  it('follows Previo before arrival', () => {
    expect(mergePrevioStatus(null, 2)).toBe('confirmed');
    expect(mergePrevioStatus('confirmed', 1)).toBe('pending');
    expect(mergePrevioStatus('confirmed', 3)).toBe('checked_in');
    expect(mergePrevioStatus('confirmed', 9)).toBe('checked_out');
    expect(mergePrevioStatus('confirmed', 7)).toBe('cancelled');
    expect(mergePrevioStatus('cancelled', 2)).toBe('confirmed');
  });

  it('never changes a check-in or check-out done in HotelCare', () => {
    expect(mergePrevioStatus('checked_in', 2, true)).toBe('checked_in');
    expect(mergePrevioStatus('checked_in', 7, true)).toBe('checked_in');
    // Reception must check out in HotelCare so the room is released for housekeeping.
    expect(mergePrevioStatus('checked_in', 9, true)).toBe('checked_in');
    expect(mergePrevioStatus('checked_out', 3)).toBe('checked_out');
    expect(mergePrevioStatus('checked_out', 2)).toBe('checked_out');
  });

  it('lets a stay that was only checked in by Previo follow Previo to checked out', () => {
    expect(mergePrevioStatus('checked_in', 9)).toBe('checked_out');
    expect(mergePrevioStatus('checked_in', 2)).toBe('checked_in');
  });

  it('maps payment ids', () => {
    expect([1, 2, 3, 4, null].map(mapPrevioPaymentStatus)).toEqual(['paid', 'unpaid', 'partial', null, null]);
  });
});

describe('Previo payment merge', () => {
  it('a booking Previo reports as paid has nothing due (prepaid OTA booking)', () => {
    expect(mergePrevioFinancials({ total: 675.24, paymentStatus: 'paid' })).toEqual({ balance: 0, paymentStatus: 'paid' });
    expect(mergePrevioFinancials({ total: 675.24, paymentStatus: 'paid', existingTotal: 675.24, existingBalance: 675.24 }))
      .toEqual({ balance: 0, paymentStatus: 'paid' });
  });

  it('an unpaid new booking owes the full amount', () => {
    expect(mergePrevioFinancials({ total: 300, paymentStatus: 'unpaid' })).toEqual({ balance: 300, paymentStatus: 'unpaid' });
    expect(mergePrevioFinancials({ total: 300, paymentStatus: null })).toEqual({ balance: 300, paymentStatus: 'unpaid' });
  });

  it('keeps a payment recorded in HotelCare when Previo does not report paid', () => {
    expect(mergePrevioFinancials({ total: 300, paymentStatus: 'unpaid', existingTotal: 300, existingBalance: 100 }))
      .toEqual({ balance: 100, paymentStatus: 'partial' });
  });

  it('restores the balance when Previo stops reporting paid', () => {
    expect(mergePrevioFinancials({ total: 300, paymentStatus: 'unpaid', existingTotal: 300, existingBalance: 0, existingPmsPaymentStatus: 'paid' }))
      .toEqual({ balance: 300, paymentStatus: 'unpaid' });
  });

  it('labels a partially paid booking without inventing the paid amount', () => {
    expect(mergePrevioFinancials({ total: 300, paymentStatus: 'partial' })).toEqual({ balance: 300, paymentStatus: 'partial' });
  });
});

describe('matching a Previo room item to a stored reservation', () => {
  const stored = (id: string, ref: string, comId: string | null) => ({ id, source_reservation_id: ref, pms_room_reservation_id: comId });

  it('matches by legacy reference before room item ids are known', () => {
    const a = stored('a', '500', null);
    expect(resolveImportTarget({ sourceRef: '500', comId: '9001' }, new Map(), new Map([['500', a]])))
      .toEqual({ existing: a, sourceRef: '500' });
  });

  it('follows a room item when two rooms of a group are swapped in Previo', () => {
    const a = stored('a', '500:801', '9001');
    const b = stored('b', '500:802', '9002');
    const byCom = new Map([['9001', a], ['9002', b]]);
    const byRef = new Map([['500:801', a], ['500:802', b]]);
    // After the swap Previo reports item 9001 in room 802 and item 9002 in room 801.
    expect(resolveImportTarget({ sourceRef: '500:802', comId: '9001' }, byCom, byRef)).toEqual({ existing: a, sourceRef: '500:801' });
    expect(resolveImportTarget({ sourceRef: '500:801', comId: '9002' }, byCom, byRef)).toEqual({ existing: b, sourceRef: '500:802' });
  });

  it('never overwrites a row owned by another room item', () => {
    const a = stored('a', '500:801', '9001');
    expect(resolveImportTarget({ sourceRef: '500:801', comId: '9003' }, new Map([['9001', a]]), new Map([['500:801', a]])))
      .toEqual({ existing: null, sourceRef: '500:801~9003' });
  });

  it('treats an unseen booking as new', () => {
    expect(resolveImportTarget({ sourceRef: '777', comId: '1' }, new Map(), new Map())).toEqual({ existing: null, sourceRef: '777' });
  });
});

describe('change detection and request building', () => {
  const record = {
    pms_reservation_id: '54855023', pms_room_reservation_id: '72896165', pms_voucher: '5462609756', pms_status_id: 2,
    pms_payment_status: 'paid', pms_channel: 'Booking.com', pms_channel_id: '5', pms_rate_plan_id: null,
    pms_option_expires_at: '2026-11-09T11:00:00.000Z', pms_locked: false, pms_group_note: null,
    pms_contact_name: null, pms_contact_email: null, pms_contact_phone: null,
  };

  it('sees a stored row as unchanged across database formatting differences', () => {
    expect(pmsFieldsEqual({ ...record, pms_option_expires_at: '2026-11-09T11:00:00+00:00', pms_status_id: 2 }, record)).toBe(true);
  });

  it('detects a changed or newly filled field', () => {
    expect(pmsFieldsEqual({ ...record, pms_payment_status: 'unpaid' }, record)).toBe(false);
    expect(pmsFieldsEqual({ ...record, pms_voucher: null }, record)).toBe(false);
    expect(pmsFieldsEqual({}, record)).toBe(false);
  });

  it('puts termType inside <term> for the incremental search and validates the window', () => {
    expect(buildReservationTermXml('2026-11-09', '2026-11-12')).toBe('<term><from>2026-11-09</from><to>2026-11-12</to></term>');
    expect(buildReservationTermXml('2026-11-09', '2026-11-12', 'modified'))
      .toBe('<term><from>2026-11-09</from><to>2026-11-12</to><termType>modified</termType></term>');
    expect(() => buildReservationTermXml('2026-11-12', '2026-11-09')).toThrow();
    expect(() => buildReservationTermXml('2026-11-09<x>', '2026-11-12')).toThrow();
  });

  it('recognises the Previo "simultaneous access" answer', () => {
    expect(isPrevioBusyResponse({ errorMessage: '1030 Simultaneous access', text: '' })).toBe(true);
    expect(isPrevioBusyResponse({ errorMessage: null, text: '<error><code>1030</code></error>' })).toBe(true);
    expect(isPrevioBusyResponse({ errorMessage: 'Invalid login', text: '' })).toBe(false);
  });
});

describe('IncomingBookingSet — one odd booking no longer blocks the import', () => {
  const base = parsePrevioReservations(xml(reservation()))[0];
  const make = (over: Partial<typeof base>) => ({ ...base, ...over });

  it('keeps normal bookings and ignores an exact repeat', async () => {
    const { IncomingBookingSet } = await import('../../supabase/functions/_shared/previoReservations');
    const set = new IncomingBookingSet();
    set.add(base, base.sourceRef);
    set.add(base, base.sourceRef);
    expect(set.size).toBe(1);
    expect(set.rejected).toEqual([]);
    expect(set.warnings()).toEqual([]);
  });

  it('sets aside a live day-use booking and silently drops a cancelled one', async () => {
    const { IncomingBookingSet } = await import('../../supabase/functions/_shared/previoReservations');
    const set = new IncomingBookingSet();
    set.add(base, base.sourceRef);
    set.add(make({ resId: '2', sourceRef: '2', departureDate: base.arrivalDate }), '2');
    set.add(make({ resId: '3', sourceRef: '3', departureDate: base.arrivalDate, statusId: 7 }), '3');
    expect(set.size).toBe(1);
    expect(set.rejected.map((r) => r.reason)).toEqual(['day_use']);
    expect(set.tooManyRejected()).toBe(false);
    expect(set.warnings()[0]).toMatch(/1 day-use booking/);
  });

  it('leaves a conflicting duplicate untouched, including any third copy', async () => {
    const { IncomingBookingSet } = await import('../../supabase/functions/_shared/previoReservations');
    const set = new IncomingBookingSet();
    set.add(base, 'X');
    set.add(make({ totalPrice: 999 }), 'X');
    set.add(base, 'X');
    expect(set.size).toBe(0);
    expect(set.rejected).toEqual([{ ref: 'X', reason: 'conflicting_duplicate', arrival: base.arrivalDate }]);
    expect(set.warnings()[0]).toMatch(/twice with different details.*X$/);
  });

  it('still refuses the run when many rows are unusable (format change)', async () => {
    const { IncomingBookingSet } = await import('../../supabase/functions/_shared/previoReservations');
    const set = new IncomingBookingSet();
    for (let i = 0; i < 100; i++) set.add(make({ resId: `${i}`, sourceRef: `${i}` }), `${i}`);
    for (let i = 0; i < 6; i++) set.add(make({ arrivalDate: 'garbage' }), `bad${i}`);
    expect(set.tooManyRejected()).toBe(true);
    // Day-use bookings are a business fact, not a parser failure: they never trip the stop.
    const dayUse = new IncomingBookingSet();
    for (let i = 0; i < 20; i++) dayUse.add(make({ resId: `${i}`, sourceRef: `${i}`, departureDate: base.arrivalDate }), `${i}`);
    expect(dayUse.tooManyRejected()).toBe(false);
  });
});

describe('a room item repeated in one response is one room, not two', () => {
  it('gives repeated comIds the same reference so the importer can compare them', () => {
    const rows = parsePrevioReservations(xml(reservation({ comId: '5' }), reservation({ comId: '5' })));
    expect(rows.map((r) => r.sourceRef)).toEqual(['54855023', '54855023']);
  });

  it('still separates genuinely different rooms of a group booking', () => {
    const rows = parsePrevioReservations(xml(
      reservation({ comId: '1', objId: '801' }), reservation({ comId: '2', objId: '802' }), reservation({ comId: '1', objId: '801' }),
    ));
    expect(rows.map((r) => r.sourceRef)).toEqual(['54855023:801', '54855023:802', '54855023:801']);
  });

  it('keeps the old behaviour when Previo sends no comId', () => {
    const noCom = (obj: string) => reservation({ objId: obj }).replace(/<comId>[^<]*<\/comId>/, '');
    const rows = parsePrevioReservations(xml(noCom('801'), noCom('801')));
    expect(rows.map((r) => r.sourceRef)).toEqual(['54855023:801', '54855023:801#1']);
  });
});

describe('Previo paid amounts (account check)', () => {
  it('reads total and paid from the REST account body', () => {
    expect(paymentFromPrevioAccount({ resId: 1, groupAccount: { total: 300.19, paid: 300.19, curId: 2 } })).toEqual({ total: 300.19, paid: 300.19, status: 'paid' });
    expect(paymentFromPrevioAccount({ groupAccount: { total: 300, paid: 100 } })).toEqual({ total: 300, paid: 100, status: 'partial' });
    expect(paymentFromPrevioAccount({ groupAccount: { total: 300, paid: 0 } })?.status).toBe('unpaid');
    expect(paymentFromPrevioAccount({ total: '300', paid: '299.8' })?.status).toBe('paid');
    expect(paymentFromPrevioAccount({ groupAccount: { total: 'x' } })).toBeNull();
    expect(paymentFromPrevioAccount(null)).toBeNull();
  });

  it('turns a reported paid amount into an exact balance', () => {
    expect(mergePrevioFinancials({ total: 300, paymentStatus: 'partial', previoPaidAmount: 100 })).toEqual({ balance: 200, paymentStatus: 'partial' });
    expect(mergePrevioFinancials({ total: 300, paymentStatus: 'unpaid', previoPaidAmount: 0 })).toEqual({ balance: 300, paymentStatus: 'unpaid' });
  });

  it('does not count a Previo payment twice on the next run', () => {
    // Stored balance 200 came from Previo reporting 100 paid; Previo still reports 100.
    expect(mergePrevioFinancials({ total: 300, paymentStatus: 'partial', previoPaidAmount: 100, existingTotal: 300, existingBalance: 200, existingPmsPaymentStatus: 'partial', existingPmsPaidAmount: 100 }))
      .toEqual({ balance: 200, paymentStatus: 'partial' });
  });

  it('keeps a larger payment recorded in HotelCare', () => {
    expect(mergePrevioFinancials({ total: 300, paymentStatus: 'partial', previoPaidAmount: 100, existingTotal: 300, existingBalance: 50 }))
      .toEqual({ balance: 50, paymentStatus: 'partial' });
  });
});

describe('channel names', () => {
  it('drops Previo technical suffixes', () => {
    expect(cleanChannelName('Booking.com XML')).toBe('Booking.com');
    expect(cleanChannelName('AgodaXML')).toBe('Agoda');
    expect(cleanChannelName('HotelTonightV2XML')).toBe('HotelTonight');
    expect(cleanChannelName('Expedia')).toBe('Expedia');
    expect(cleanChannelName('RESERVATION+')).toBe('RESERVATION+');
    expect(cleanChannelName('  ')).toBeNull();
  });

  it('is applied by the parser', () => {
    const [row] = parsePrevioReservations(xml(reservation()).replace('<name>Booking.com</name>', '<name>Booking.com XML</name>'));
    expect(row.channel).toBe('Booking.com');
  });
});

describe('bookings Previo no longer returns', () => {
  const window = { from: '2026-11-06', to: '2027-11-13' };
  const row = (ref: string, over: Record<string, unknown> = {}) => ({
    id: ref, source_reservation_id: ref, status: 'confirmed', check_in_date: '2026-12-01', check_out_date: '2026-12-03',
    actual_check_in: null, pms_missing_since: null, ...over,
  });

  it('hides live bookings in the searched window that were not returned', () => {
    const stored = [row('a'), row('b'), row('old-room', { check_in_date: '2026-11-20', check_out_date: '2026-11-22' })];
    const missing = bookingsMissingFromPrevio({ stored, returnedRefs: new Set(['a']), setAsideRefs: new Set(), window, incomingCount: 100 });
    expect(missing?.map((r) => r.id)).toEqual(['b', 'old-room']);
  });

  it('leaves alone: outside the window, set aside this run, checked in by HotelCare, finished, already hidden', () => {
    const stored = [
      row('past', { check_in_date: '2026-09-01', check_out_date: '2026-09-03' }),
      row('dup'),
      row('hc', { status: 'checked_in', actual_check_in: '2026-11-12T14:00:00Z' }),
      row('done', { status: 'checked_out' }),
      row('hidden', { pms_missing_since: '2026-11-12T10:00:00Z' }),
    ];
    expect(bookingsMissingFromPrevio({ stored, returnedRefs: new Set(), setAsideRefs: new Set(['dup']), window, incomingCount: 100 })).toEqual([]);
  });

  it('refuses when too many would disappear at once', () => {
    const stored = Array.from({ length: 50 }, (_, i) => row(`r${i}`));
    expect(bookingsMissingFromPrevio({ stored, returnedRefs: new Set(['r0']), setAsideRefs: new Set(), window, incomingCount: 50 })).toBeNull();
  });
});
