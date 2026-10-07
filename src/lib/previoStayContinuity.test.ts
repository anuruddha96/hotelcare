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
    expect(result.effective?.reservationId).toBe('B');
    expect(result.extensionLinked).toBe(false);
    expect(result.currentNight).toBe(1);
    expect(result.totalNights).toBe(3);
    expect(result.reservationIds).toEqual(['B']);
  });

  it('links a three-reservation extension chain', () => {
    const rows = [
      candidate({ reservationId:'A', arrivalDate:'2026-09-30', departureDate:'2026-10-03', statusId:6 }),
      candidate({ reservationId:'B', arrivalDate:'2026-10-03', departureDate:'2026-10-07', statusId:6 }),
      candidate({ reservationId:'C', arrivalDate:'2026-10-07', departureDate:'2026-10-09', statusId:3 }),
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

  it('uses name matching only when strong identity is unavailable', () => {
    const result = resolvePrevioContinuousStay([
      candidate({ reservationId:'A', arrivalDate:'2026-10-02', departureDate:'2026-10-07', statusId:6 }),
      candidate({ reservationId:'B', arrivalDate:'2026-10-07', departureDate:'2026-10-10', statusId:1 }),
    ], '2026-10-07');
    expect(result.extensionLinked).toBe(true);
    expect(result.confidence).toBe('probable');
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
