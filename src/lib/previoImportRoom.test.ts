import { describe, expect, it } from 'vitest';
import { resolveImportRoom } from '../../supabase/functions/_shared/previoReservations';

describe('resolveImportRoom', () => {
  it('follows Previo when the guest is moved after a check-in done in Previo', () => {
    // Hotel Ottofiori, 15 Nov 2026: Previo moved a checked-in booking from TRP-105 to TRP-204;
    // the plan kept it in 105 and showed a false "room conflict" with the next arrival.
    expect(resolveImportRoom({ mappedRoom: 'room-204', existingRoom: 'room-105', localStatus: 'checked_in', checkedInHere: false })).toBe('room-204');
  });

  it('keeps the room chosen at a check-in done in HotelCare', () => {
    expect(resolveImportRoom({ mappedRoom: 'room-204', existingRoom: 'room-105', localStatus: 'checked_in', checkedInHere: true })).toBe('room-105');
    expect(resolveImportRoom({ mappedRoom: 'room-204', existingRoom: null, localStatus: 'checked_in', checkedInHere: true })).toBe('room-204');
  });

  it('never clears a stored room because Previo names a room HotelCare has no mapping for', () => {
    expect(resolveImportRoom({ mappedRoom: null, existingRoom: 'room-105', localStatus: 'confirmed', checkedInHere: false })).toBe('room-105');
    expect(resolveImportRoom({ mappedRoom: null, existingRoom: null, localStatus: null, checkedInHere: false })).toBeNull();
  });

  it('takes the Previo room for new and upcoming bookings', () => {
    expect(resolveImportRoom({ mappedRoom: 'room-101', existingRoom: null, localStatus: null, checkedInHere: false })).toBe('room-101');
    expect(resolveImportRoom({ mappedRoom: 'room-102', existingRoom: 'room-101', localStatus: 'confirmed', checkedInHere: false })).toBe('room-102');
  });
});
