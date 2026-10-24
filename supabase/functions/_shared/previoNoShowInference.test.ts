import { describe, expect, it } from 'vitest';
import { isStaleUnarrivedPrevioReservation } from './previoNoShowInference';
const base = { statusId: 2, departureDate: '2026-10-30', businessDate: '2026-10-24', propertyTracksCheckIns: true, extensionLinked: false };
describe('suspected no-show inference', () => {
  it('does not suspect a guest one night after arrival (room 110)', () => {
    expect(isStaleUnarrivedPrevioReservation({ ...base, arrivalDate: '2026-10-23' })).toBe(false);
  });
  it('suspects from day 2 with no check-in', () => {
    expect(isStaleUnarrivedPrevioReservation({ ...base, arrivalDate: '2026-10-22' })).toBe(true);
  });
  it('never suspects a checked-in status', () => {
    expect(isStaleUnarrivedPrevioReservation({ ...base, statusId: 3, arrivalDate: '2026-10-20' })).toBe(false);
  });
});
