import { describe, expect, it } from 'vitest';
import {
  buildWritebackRequest, classifyWritebackFailure, readableWritebackError, retryDelayMinutes, writebackBlocker,
} from '../../supabase/functions/_shared/previoWriteback';

const job = (over: Record<string, unknown> = {}) => ({
  action: 'check_in' as const, pms_reservation_id: '54855023', pms_room_reservation_id: '72896165', room_changed: false, ...over,
});

describe('previo write-back requests', () => {
  it('checks in one room through the REST endpoint Previo documents', () => {
    expect(buildWritebackRequest(job())).toEqual({
      kind: 'rest', method: 'POST', path: '/rest/reservations/rooms/check-in', body: { reservationRoomId: 72896165 },
    });
  });

  it('checks out one room only, so a group booking keeps its other rooms', () => {
    const req = buildWritebackRequest(job({ action: 'check_out' }));
    expect(req).toEqual({
      kind: 'xml', method: 'reservation',
      extraXml: '<newReservation><resId>54855023</resId><commissions><commission><comId>72896165</comId><cosId>9</cosId></commission></commissions></newReservation>',
    });
  });

  it('refuses to send without Previo references or after a room change at check-in', () => {
    expect(writebackBlocker(job({ pms_room_reservation_id: null }))).toMatch(/no Previo room reference/);
    expect(writebackBlocker(job({ pms_room_reservation_id: '72896165<x>' }))).toMatch(/no Previo room reference/);
    expect(writebackBlocker(job({ action: 'check_out', pms_reservation_id: null }))).toMatch(/no Previo reservation reference/);
    expect(writebackBlocker(job({ room_changed: true }))).toMatch(/different room/);
    // A room change only matters for check-in: check-out of the room the guest is in is fine.
    expect(writebackBlocker(job({ action: 'check_out', room_changed: true }))).toBeNull();
    expect(() => buildWritebackRequest(job({ room_changed: true }))).toThrow(/different room/);
  });
});

describe('failure handling', () => {
  it('retries only transient failures', () => {
    expect(classifyWritebackFailure(0, null)).toBe('retry');
    expect(classifyWritebackFailure(503, 'Service unavailable')).toBe('retry');
    expect(classifyWritebackFailure(429, null)).toBe('retry');
    expect(classifyWritebackFailure(200, '1030 Simultaneous access')).toBe('retry');
    expect(classifyWritebackFailure(200, 'Error 6000: reservation locked')).toBe('retry');
    expect(classifyWritebackFailure(400, 'Guest profile is incomplete')).toBe('fail');
    expect(classifyWritebackFailure(200, 'Room is not tidy')).toBe('fail');
  });

  it('backs off 1, 2, 4, 8, 16 minutes', () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMinutes)).toEqual([1, 2, 4, 8, 16, 16]);
  });

  it('gives reception a readable reason without markup or JSON dumps', () => {
    expect(readableWritebackError(200, '<b>Guest profile</b> is incomplete')).toBe('Guest profile is incomplete');
    expect(readableWritebackError(400, null, 'Arrival date must be today')).toBe('Arrival date must be today');
    expect(readableWritebackError(400, null, '{"error":"x"}')).toBe('Previo answered HTTP 400');
    expect(readableWritebackError(0, null)).toBe('Previo could not be reached');
  });
});
