import { describe, expect, it } from 'vitest';
import { isReservationOwnedByImportChunk } from '../../supabase/functions/_shared/previoReservations';

describe('Previo reservation import ownership across overlapping search windows', () => {
  const firstFrom = '2026-10-27';
  const boundary = '2027-01-28';
  const after = '2027-05-01';

  it('retains already-in-house bookings in the first window', () => {
    expect(isReservationOwnedByImportChunk('2026-10-25', firstFrom, boundary, true)).toBe(true);
  });

  it('accepts arrivals inside their own search chunk', () => {
    expect(isReservationOwnedByImportChunk('2026-11-04', firstFrom, boundary, true)).toBe(true);
    expect(isReservationOwnedByImportChunk('2027-02-01', boundary, after, false)).toBe(true);
  });

  it('avoids re-importing an extended stay in a later overlapping chunk', () => {
    const arrival = '2026-11-04';
    const departure = '2027-02-04'; // Spans both Previo search windows.
    expect(departure > boundary).toBe(true);
    expect(isReservationOwnedByImportChunk(arrival, firstFrom, boundary, true)).toBe(true);
    expect(isReservationOwnedByImportChunk(arrival, boundary, after, false)).toBe(false);
  });

  it('excludes future arrivals returned early by a broad Previo range', () => {
    expect(isReservationOwnedByImportChunk('2027-02-01', firstFrom, boundary, true)).toBe(false);
    expect(isReservationOwnedByImportChunk('2027-05-02', boundary, after, false)).toBe(false);
  });

  it('rejects malformed arrivals rather than treating them as in-window', () => {
    expect(isReservationOwnedByImportChunk('', firstFrom, boundary, true)).toBe(false);
    expect(isReservationOwnedByImportChunk('2026-11-04T00:00:00', firstFrom, boundary, true)).toBe(false);
  });
});
