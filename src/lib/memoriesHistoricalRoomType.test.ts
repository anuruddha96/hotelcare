import { describe, expect, it } from 'vitest';
import { hasMemoriesHistoricalRoomTypeConflict, isMemoriesHistoricalCheckout } from './memoriesHistoricalRoomType';

describe('Hotel Memories historical room category', () => {
  it('keeps room 306 daily when a checkout cleaning task exists but the saved PMS classification is daily', () => {
    const room = {
      is_checkout_room: false,
      pms_metadata: { scheduledDepartureToday: false },
      assignment_type: 'checkout_cleaning',
    };
    expect(isMemoriesHistoricalCheckout(room)).toBe(false);
    expect(hasMemoriesHistoricalRoomTypeConflict(room)).toBe(true);
  });

  it('keeps a saved checkout room in checkout regardless of daily task data', () => {
    const room = { is_checkout_room: true, assignment_type: 'daily_cleaning' };
    expect(isMemoriesHistoricalCheckout(room)).toBe(true);
    expect(hasMemoriesHistoricalRoomTypeConflict(room)).toBe(true);
  });

  it('respects manual extensions before stale checkout metadata', () => {
    expect(isMemoriesHistoricalCheckout({
      is_checkout_room: true,
      pms_metadata: { manual_daily: true, scheduledDepartureToday: true },
      assignment_type: 'checkout_cleaning',
    })).toBe(false);
  });

  it('uses saved classification ahead of conflicting PMS metadata, with a metadata fallback only when missing', () => {
    expect(isMemoriesHistoricalCheckout({
      is_checkout_room: false, pms_metadata: { scheduledDepartureToday: true },
    })).toBe(false);
    expect(isMemoriesHistoricalCheckout({
      is_checkout_room: null, pms_metadata: { scheduledDepartureToday: true },
    })).toBe(true);
  });

  it('never infers checkout from a task alone if room classification is unavailable', () => {
    expect(isMemoriesHistoricalCheckout({
      is_checkout_room: null, assignment_type: 'checkout_cleaning',
    })).toBe(false);
  });

  it('retains correct September 21 room totals when fourteen daily rooms have checkout task records', () => {
    const rows = [
      ...Array.from({ length: 12 }, () => ({ is_checkout_room: true, assignment_type: 'checkout_cleaning' })),
      ...Array.from({ length: 14 }, () => ({ is_checkout_room: false, assignment_type: 'checkout_cleaning' })),
      ...Array.from({ length: 45 }, () => ({ is_checkout_room: false, assignment_type: 'daily_cleaning' })),
    ];
    expect(rows.filter(isMemoriesHistoricalCheckout)).toHaveLength(12);
    expect(rows.filter(row => !isMemoriesHistoricalCheckout(row))).toHaveLength(59);
    expect(rows.filter(hasMemoriesHistoricalRoomTypeConflict)).toHaveLength(14);
  });
});
