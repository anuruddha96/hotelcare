import { describe, expect, it } from 'vitest';
import { reconcilePrevioReservations, type IncomingReservation, type StoredReservation } from '../../supabase/functions/_shared/previoReservationReconciliation';

const hotel = 'gozsdu-court';
const from = '2026-09-19';
const to = '2026-10-19';
const incoming = (patch: Partial<IncomingReservation> = {}): IncomingReservation => ({
  sourceRef: 'P100', arrivalDate: '2026-09-20', departureDate: '2026-09-22', objId: 'pms-1', statusId: 1, ...patch,
});
const local = (patch: Partial<StoredReservation> = {}): StoredReservation => ({
  hotel_id: hotel, source: 'previo', source_reservation_id: 'P100', check_in_date: '2026-09-20',
  check_out_date: '2026-09-22', room_id: 'hc-1', status: 'checked_in', ...patch,
});
const rooms = new Map([['pms-1', 'hc-1']]);
const run = (remote: IncomingReservation[], stored: StoredReservation[], map = rooms) =>
  reconcilePrevioReservations(hotel, from, to, remote, stored, map);

describe('Previo read-only reservation ID reconciliation', () => {
  it('compares matching source IDs without changing operational checked-in state', () => {
    const result = run([incoming()], [local()]);
    expect(result.comparison).toBe('matched_within_window');
    expect(result.incoming).toBe(1);
    expect(result.dateMismatches).toBe(0);
    expect(result.terminalStatusMismatches).toBe(0);
  });
  it('identifies missing records in either direction without assuming a cancellation', () => {
    const result = run([incoming(), incoming({ sourceRef: 'P200' })], [local(), local({source_reservation_id:'P300'})]);
    expect(result.missingInHotelCare).toBe(1);
    expect(result.missingInPrevioResponse).toBe(1);
    expect(result.comparison).toBe('mismatch_within_window');
  });
  it('flags moved dates and a conflicting physical room using IDs, never a room-number guess', () => {
    const result = run([incoming({arrivalDate:'2026-09-21'})], [local({room_id:'hc-2'})]);
    expect(result.dateMismatches).toBe(1);
    expect(result.roomMismatches).toBe(1);
  });
  it('flags terminal cancellation disagreement but allows confirmed Previo and checked-out local status', () => {
    expect(run([incoming({statusId:7})], [local()]).terminalStatusMismatches).toBe(1);
    expect(run([incoming()], [local({status:'checked_out'})]).terminalStatusMismatches).toBe(0);
  });
  it('detects unmapped rooms and duplicate source IDs without fabricating room allocation', () => {
    const result = run([incoming(), incoming()], [local()], new Map());
    expect(result.unmappedPrevioRooms).toBe(1);
    expect(result.duplicateIncomingIds).toBe(1);
    expect(result.comparison).toBe('mismatch_within_window');
  });
  it('never silently compares a different hotel or a local direct booking', () => {
    expect(() => run([incoming()], [local({hotel_id:'ottofiori'})])).toThrow(/Cross-property/);
    expect(() => run([incoming()], [local({source:'direct'})])).toThrow(/non-Previo/);
  });
  it('rejects bad input and flags suspicious long-stay dates without removing them', () => {
    expect(() => run([incoming({departureDate:'2026-09-20'})], [])).toThrow(/Invalid Previo/);
    const result = run([incoming({departureDate:'2028-09-22'})], [local()]);
    expect(result.unusuallyLongStays).toBe(1);
    expect(result.comparison).toBe('mismatch_within_window');
  });
  it('does not count old bookings outside the requested audit window', () => {
    const result = run([], [local({check_in_date:'2025-01-01',check_out_date:'2025-01-02'})]);
    expect(result.missingInPrevioResponse).toBe(0);
  });
});
