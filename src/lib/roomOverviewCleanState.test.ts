import { describe, expect, it } from 'vitest';
import { isRoomCleanForSelectedDate } from './roomOverviewCleanState';

describe('room overview clean state', () => {
  it('trusts a fresh PMS clean confirmation for the selected date', () => {
    expect(isRoomCleanForSelectedDate({
      status: 'clean',
      last_cleaned_at: '2026-09-08T11:00:00Z',
      pms_metadata: { pmsSyncDate: '2026-09-09' },
    }, '2026-09-09')).toBe(true);
  });

  it('does not treat a stale PMS clean state as current-day clean', () => {
    expect(isRoomCleanForSelectedDate({
      status: 'clean',
      last_cleaned_at: '2026-09-08T11:00:00Z',
      pms_metadata: { pmsSyncDate: '2026-09-08' },
    }, '2026-09-09')).toBe(false);
  });

  it('keeps an actual same-day HotelCare cleaning green', () => {
    expect(isRoomCleanForSelectedDate({
      status: 'clean',
      last_cleaned_at: '2026-09-09T09:15:00Z',
      pms_metadata: {},
    }, '2026-09-09')).toBe(true);
  });
});
