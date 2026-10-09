import { describe, expect, it } from 'vitest';
import {
  opaquePrevioFingerprint,
  resolvePrevioContinuousStay,
  type PrevioStayCandidate,
} from '../../supabase/functions/_shared/previoStayContinuity';

function candidate(overrides: Partial<PrevioStayCandidate> & Pick<PrevioStayCandidate, 'arrivalDate' | 'departureDate'>): PrevioStayCandidate {
  return {
    objId: 117,
    roomName: '28SYN.DOUBLE-117',
    reservationId: null,
    statusId: 1,
    guestKeys: ['name:anu|guest'],
    guestFingerprint: null,
    guestIdentityStrength: 'name',
    ...overrides,
  };
}

describe('Previo continuous stay resolver', () => {
  it('links an old checkout and same-day same-guest extension', () => {
    const oldStay = candidate({
      reservationId: 'A',
      arrivalDate: '2026-10-02',
      departureDate: '2026-10-07',
      statusId: 6,
      guestKeys: ['strong:guest:123', 'name:anu|guest'],
      guestFingerprint: opaquePrevioFingerprint('strong:guest:123'),
      guestIdentityStrength: 'strong',
    });
    const extension = candidate({
      reservationId: 'B',
      arrivalDate: '2026-10-07',
      departureDate: '2026-10-10',
      statusId: 3,
      guestKeys: ['strong:guest:123', 'name:anu|guest'],
      guestFingerprint: opaquePrevioFingerprint('strong:guest:123'),
      guestIdentityStrength: 'strong',
    });
    const result = resolvePrevioContinuousStay([oldStay, extension], '2026-10-07');
    expect(result.effective?.reservationId).toBe('B');
    expect(result.extensionLinked).toBe(true);
    expect(result.originalArrivalDate).toBe('2026-10-02');
    expect(result.finalDepartureDate).toBe('2026-10-10');
    expect(result.currentNight).toBe(6);
    expect(result.totalNights).toBe(8);
    expect(result.reservationIds).toEqual(['A', 'B']);
    expect(result.confidence).toBe('strong');
  });

  it('keeps a real same-day turnover separate when the strong guest differs', () => {
    const oldStay = candidate({
      reservationId: 'A',
      arrivalDate: '2026-10-02',
      departureDate: '2026-10-07',
      statusId: 6,
      guestKeys: ['strong:guest:old', 'name:old|guest'],
      guestFingerprint: opaquePrevioFingerprint('strong:guest:old'),
      guestIdentityStrength: 'strong',
    });
    const newGuest = candidate({
      reservationId: 'B',
      arrivalDate: '2026-10-07',
      departureDate: '2026-10-10',
      statusId: 3,
      guestKeys: ['strong:guest:new', 'name:new|guest'],
      guestFingerprint: opaquePrevioFingerprint('strong:guest:new'),
      guestIdentityStrength: 'strong',
    });
    const result = resolvePrevioContinuousStay([oldStay, newGuest], '2026-10-07');
    expect(result.effective?.reservationId).toBe('A');
    expect(result.extensionLinked).toBe(false);
    expect(result.sameDayTurnover).toBe(true);
    expect(result.turnoverConfidence).toBe('strong');
    expect(result.competingArrival?.reservationId).toBe('B');
    expect(result.currentNight).toBe(5);
    expect(result.totalNights).toBe(5);
    expect(result.reservationIds).toEqual(['A']);
  });

  it('keeps back-to-back room 406 reservations with different guests as a checkout and arrival', () => {
    const oldStay = candidate({
      objId: 406, roomName: 'QRP-406', reservationId: 'old-booking',
      arrivalDate: '2026-10-07', departureDate: '2026-10-08', statusId: 6,
      guestKeys: ['strong:guest:old'], guestIdentityStrength: 'strong',
      guestFingerprint: opaquePrevioFingerprint('strong:guest:old'),
    });
    const newStay = candidate({
      objId: 406, roomName: 'QRP-406', reservationId: 'new-booking',
      arrivalDate: '2026-10-08', departureDate: '2026-10-11', statusId: 3,
      guestKeys: ['strong:guest:new'], guestIdentityStrength: 'strong',
      guestFingerprint: opaquePrevioFingerprint('strong:guest:new'),
    });
    const result = resolvePrevioContinuousStay([oldStay, newStay], '2026-10-08');
    expect(result.effective?.reservationId).toBe('old-booking');
    expect(result.extensionLinked).toBe(false);
    expect(result.sameDayTurnover).toBe(true);
    expect(result.turnoverConfidence).toBe('strong');
    expect(result.reservationIds).toEqual(['old-booking']);
  });

  it('links a three-reservation extension chain with a verified shared guest identity', () => {
    const sharedGuest = {
      guestKeys: ['strong:guest:123'],
      guestFingerprint: opaquePrevioFingerprint('strong:guest:123'),
      guestIdentityStrength: 'strong' as const,
    };
    const rows = [
      candidate({ ...sharedGuest, reservationId:'A', arrivalDate:'2026-09-30', departureDate:'2026-10-03', statusId:6 }),
      candidate({ ...sharedGuest, reservationId:'B', arrivalDate:'2026-10-03', departureDate:'2026-10-07', statusId:6 }),
      candidate({ ...sharedGuest, reservationId:'C', arrivalDate:'2026-10-07', departureDate:'2026-10-09', statusId:3 }),
    ];
    const result = resolvePrevioContinuousStay(rows, '2026-10-07');
    expect(result.reservationIds).toEqual(['A','B','C']);
    expect(result.totalNights).toBe(9);
    expect(result.currentNight).toBe(8);
  });

  it('does not bridge a one-day gap', () => {
    const result = resolvePrevioContinuousStay([
      candidate({ reservationId:'A', arrivalDate:'2026-10-02', departureDate:'2026-10-06', statusId:6 }),
      candidate({ reservationId:'B', arrivalDate:'2026-10-07', departureDate:'2026-10-10', statusId:3 }),
    ], '2026-10-07');
    expect(result.extensionLinked).toBe(false);
    expect(result.reservationIds).toEqual(['B']);
  });

  it('keeps checkout authoritative but exposes an ambiguous same-day arrival for manager confirmation', () => {
    const oldStay = candidate({
      reservationId: 'A',
      arrivalDate: '2026-10-02',
      departureDate: '2026-10-07',
      statusId: 6,
      guestKeys: ['name:anuruddha|dharmasena'],
      guestIdentityStrength: 'name',
    });
    const possibleExtension = candidate({
      reservationId: 'B',
      arrivalDate: '2026-10-07',
      departureDate: '2026-10-10',
      statusId: 1,
      guestKeys: ['name:anuruddha|dharma sena'],
      guestIdentityStrength: 'name',
    });
    const result = resolvePrevioContinuousStay([oldStay, possibleExtension], '2026-10-07');
    expect(result.effective?.reservationId).toBe('A');
    expect(result.extensionLinked).toBe(false);
    expect(result.sameDayTurnover).toBe(true);
    expect(result.turnoverConfidence).toBe('ambiguous');
    expect(result.competingArrival?.reservationId).toBe('B');
  });

  it('does not link bookings merely because names match across a same-day turnover', () => {
    const result = resolvePrevioContinuousStay([
      candidate({ reservationId:'A', arrivalDate:'2026-10-02', departureDate:'2026-10-07', statusId:6 }),
      candidate({ reservationId:'B', arrivalDate:'2026-10-07', departureDate:'2026-10-10', statusId:1 }),
    ], '2026-10-07');
    expect(result.extensionLinked).toBe(false);
    expect(result.reservationIds).toEqual(['A']);
    expect(result.sameDayTurnover).toBe(true);
    expect(result.turnoverConfidence).toBe('ambiguous');
  });

  it('ignores cancelled and no-show segments', () => {
    const result = resolvePrevioContinuousStay([
      candidate({ reservationId:'A', arrivalDate:'2026-10-02', departureDate:'2026-10-07', statusId:6 }),
      candidate({ reservationId:'B', arrivalDate:'2026-10-07', departureDate:'2026-10-10', statusId:8 }),
    ], '2026-10-07');
    expect(result.effective?.reservationId).toBe('A');
    expect(result.extensionLinked).toBe(false);
  });
});
