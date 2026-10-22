import { describe, expect, it } from 'vitest';
import { isPmsArrivalForDate } from './ottofioriArrivalBucket';

const today = '2026-10-22';

describe('PMS arrival bucket uses the actual business date', () => {
  it('keeps Ottofiori Q-403 (21–24 October, night 2/3) in Daily Rooms', () => {
    expect(isPmsArrivalForDate({
      pmsSyncDate: today,
      arrivalToday: true, notArrived: true, occupiedToday: false,
      arrivalDate: '2026-10-21', departureDate: '2026-10-24',
      currentNight: 2, totalNights: 3, reservationStatusId: 3,
      pmsOccupancyStatus: 'stayover',
    }, today)).toBe(false);
  });

  it('shows a genuine expected arrival for today', () => {
    expect(isPmsArrivalForDate({
      pmsSyncDate: today, arrivalDate: today, arrivalToday: true,
      occupiedToday: false, reservationStatusId: 2, pmsOccupancyStatus: 'arrival_pending',
    }, today)).toBe(true);
  });

  it('does not show a newly checked-in guest under Arrivals', () => {
    expect(isPmsArrivalForDate({
      pmsSyncDate: today, arrivalDate: today, arrivalToday: true,
      occupiedToday: false, reservationStatusId: 3,
    }, today)).toBe(false);
  });

  it('rejects yesterday and future arrival dates despite a sticky flag', () => {
    for (const date of ['2026-10-21', '2026-10-23']) {
      expect(isPmsArrivalForDate({
        pmsSyncDate: today, arrivalDate: date, arrivalToday: true,
        reservationStatusId: 2,
      }, today)).toBe(false);
    }
  });

  it('does not use old PMS data to classify today's arrivals', () => {
    expect(isPmsArrivalForDate({
      pmsSyncDate: '2026-10-21', arrivalDate: today, arrivalToday: true,
    }, today)).toBe(false);
  });

  it('respects occupied, cancelled, and no-show indicators', () => {
    for (const flag of ['occupiedToday', 'isCancelled', 'isNoShow'] as const) {
      expect(isPmsArrivalForDate({
        pmsSyncDate: today, arrivalDate: today, arrivalToday: true, [flag]: true,
      }, today)).toBe(false);
    }
  });
});
