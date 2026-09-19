import { describe, expect, it } from 'vitest';
import { collectionCategory, summarizeGozsduLinen, type CollectionRoom, type CollectionCount } from './gozsduLinenDailyBreakdown';

const date = '2026-09-19';
const rooms: CollectionRoom[] = [
  { id: 'c', room_number: '410', is_checkout_room: true },
  { id: 'd', room_number: '2B-1/T/2', is_checkout_room: false },
];
const counts: CollectionCount[] = [
  { room_id: 'c', housekeeper_id: 'collector', linen_item_id: 'towel', count: 200 },
  { room_id: 'c', housekeeper_id: 'collector', linen_item_id: 'sheet', count: 59 },
  { room_id: 'd', housekeeper_id: 'collector', linen_item_id: 'towel', count: 18 },
];

describe('Gozsdu daily collection breakdown', () => {
  it('reconciles room-attributed checkout + daily + clearly unallocated daily quantities', () => {
    const result = summarizeGozsduLinen(rooms, counts, [], [
      { user_id: 'collector', item_counts: { towel: 60 } },
    ], ['towel', 'sheet'], date);
    expect(result.checkoutTotal).toBe(259);
    expect(result.dailyRoomTotal).toBe(18);
    expect(result.unallocatedDailyTotal).toBe(60);
    expect(result.dailyTotal).toBe(78);
    expect(result.grandTotal).toBe(337);
    expect(result.roomDetails.map(row => [row.room, row.total])).toEqual([['410', 259], ['2B-1/T/2', 18]]);
    expect(result.bulkByUser[0].total).toBe(60);
    expect(result.roomDetails.find(row => row.room === 'Unknown room')).toBeUndefined();
    expect(result.checkoutItems.towel).toBe(200);
    expect(result.dailyRoomItems.towel).toBe(18);
    expect(result.unallocatedItems.towel).toBe(60);
  });

  it('respects manager override before present-day room classification', () => {
    const overridden = { ...rooms[0], pms_metadata: { hotelcareHousekeepingOverrides: { [date]: {
      date, bucket: 'service', service: 'towel_change', reason: 'manager', changedBy: 'manager', changedAt: 'now',
    } } } };
    expect(collectionCategory(overridden, [], date)).toBe('daily');
    expect(collectionCategory(rooms[1], [{ room_id: 'd', assigned_to: 'hk', assignment_type: 'checkout_cleaning', status: 'assigned' }], date)).toBe('checkout');
  });

  it('excludes unknown rooms, excludes old catalogue items without deleting records, and does not double count zeros', () => {
    const result = summarizeGozsduLinen(rooms, [
      ...counts,
      { room_id: 'not-in-property', housekeeper_id: 'x', linen_item_id: 'towel', count: 900 },
      { room_id: 'c', housekeeper_id: 'collector', linen_item_id: 'legacy', count: 12 },
      { room_id: 'd', housekeeper_id: 'collector', linen_item_id: 'sheet', count: 0 },
    ], [], [{ user_id: 'collector', item_counts: { towel: 0, unknown: 500 } }], ['towel', 'sheet'], date);
    expect(result.grandTotal).toBe(277);
    expect(result.legacyTotal).toBe(12);
    expect(result.unallocatedDailyTotal).toBe(0);
  });

  it('keeps two collectors of the same room as separate attribution while totaling both', () => {
    const result = summarizeGozsduLinen(rooms, [...counts,
      { room_id: 'c', housekeeper_id: 'other', linen_item_id: 'sheet', count: 2 },
    ], [], [], ['towel', 'sheet'], date);
    expect(result.checkoutTotal).toBe(261);
    expect(result.roomDetails.filter(row => row.roomId === 'c')).toHaveLength(2);
  });
});
