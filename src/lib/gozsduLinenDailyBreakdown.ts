import { readGozsduRoomOverride } from './gozsduRoomBucketOverride';

export type CollectionRoom = {
  id: string;
  room_number: string;
  is_checkout_room: boolean | null;
  pms_metadata?: Record<string, any> | null;
};
export type CollectionCount = {
  room_id: string;
  housekeeper_id: string;
  linen_item_id: string;
  count: number;
};
export type CollectionAssignment = {
  room_id: string;
  assigned_to: string | null;
  assignment_type: string;
  status: string;
};
export type UnallocatedDailyBatch = {
  user_id: string;
  item_counts: Record<string, number>;
};
export type LinenCategory = 'checkout' | 'daily';
export type CollectionDetail = {
  roomId: string;
  room: string;
  userId: string;
  category: LinenCategory;
  total: number;
  byItem: Record<string, number>;
};

/** This report is only for Gozsdu. Never attribute an unknown daily trolley to a made-up room. */
export function collectionCategory(room: CollectionRoom, assignments: CollectionAssignment[], date: string): LinenCategory {
  const override = readGozsduRoomOverride(room.pms_metadata, date);
  if (override) return override.bucket === 'checkout' ? 'checkout' : 'daily';
  if (room.is_checkout_room === true || room.pms_metadata?.scheduledDepartureToday === true) return 'checkout';
  if (assignments.some(row => row.assignment_type === 'checkout_cleaning' && row.status !== 'cancelled')) return 'checkout';
  return 'daily';
}

export function summarizeGozsduLinen(
  rooms: CollectionRoom[],
  counts: CollectionCount[],
  assignments: CollectionAssignment[],
  batches: UnallocatedDailyBatch[],
  itemIds: string[],
  date: string,
) {
  const allowed = new Set(itemIds);
  const roomMap = new Map(rooms.map(room => [room.id, room]));
  const assignmentMap = new Map<string, CollectionAssignment[]>();
  for (const assignment of assignments) assignmentMap.set(assignment.room_id,
    [...(assignmentMap.get(assignment.room_id) || []), assignment]);
  const details = new Map<string, CollectionDetail>();
  const checkoutItems: Record<string, number> = {};
  const dailyRoomItems: Record<string, number> = {};
  const unallocatedItems: Record<string, number> = {};
  let legacyTotal = 0;
  for (const record of counts) {
    const room = roomMap.get(record.room_id);
    if (!room || !Number.isInteger(record.count) || record.count <= 0) continue;
    if (!allowed.has(record.linen_item_id)) { legacyTotal += record.count; continue; }
    const key = `${record.room_id}:${record.housekeeper_id}`;
    if (!details.has(key)) details.set(key, {
      roomId: room.id, room: room.room_number, userId: record.housekeeper_id,
      category: collectionCategory(room, assignmentMap.get(room.id) || [], date), total: 0, byItem: {},
    });
    const entry = details.get(key)!;
    entry.total += record.count;
    entry.byItem[record.linen_item_id] = (entry.byItem[record.linen_item_id] || 0) + record.count;
    const bucket = entry.category === 'checkout' ? checkoutItems : dailyRoomItems;
    bucket[record.linen_item_id] = (bucket[record.linen_item_id] || 0) + record.count;
  }
  const bulkByUser = batches.map(batch => {
    const byItem: Record<string, number> = {};
    for (const id of itemIds) {
      const quantity = Number(batch.item_counts?.[id] || 0);
      if (Number.isInteger(quantity) && quantity > 0) {
        byItem[id] = quantity;
        unallocatedItems[id] = (unallocatedItems[id] || 0) + quantity;
      }
    }
    return { userId: batch.user_id, byItem, total: Object.values(byItem).reduce((sum, value) => sum + value, 0) };
  }).filter(batch => batch.total > 0);
  const roomDetails = [...details.values()].sort((a, b) =>
    a.category.localeCompare(b.category) || a.room.localeCompare(b.room, undefined, { numeric: true })
      || a.userId.localeCompare(b.userId));
  const checkoutTotal = Object.values(checkoutItems).reduce((sum, value) => sum + value, 0);
  const dailyRoomTotal = Object.values(dailyRoomItems).reduce((sum, value) => sum + value, 0);
  const unallocatedDailyTotal = Object.values(unallocatedItems).reduce((sum, value) => sum + value, 0);
  return {
    roomDetails, bulkByUser, checkoutItems, dailyRoomItems, unallocatedItems,
    checkoutTotal, dailyRoomTotal, unallocatedDailyTotal,
    dailyTotal: dailyRoomTotal + unallocatedDailyTotal,
    grandTotal: checkoutTotal + dailyRoomTotal + unallocatedDailyTotal,
    legacyTotal,
  };
}
