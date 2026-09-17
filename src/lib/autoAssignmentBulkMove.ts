import { moveRoom, type AssignmentPreview } from './roomAssignmentAlgorithm';

export interface BulkRoomMoveResult {
  previews: AssignmentPreview[];
  movedRoomIds: string[];
  error: 'invalid_destination' | 'laundryner_destination' | 'missing_room' | 'duplicate_room' | 'restricted_move' | 'nothing_to_move' | null;
}

/**
 * Apply a manager's selected rooms to one existing housekeeper as ONE draft
 * operation. Never write to the database here: the established Auto Assign
 * confirmation flow remains the only persistence boundary.
 *
 * Reuse the exact same moveRoom rules as ordinary drag/drop, including Gozsdu
 * building restrictions and the explicit manager override. If any selected
 * room is stale, ambiguous or blocked, discard the entire proposed transfer.
 */
export function moveSelectedRooms(
  previews: AssignmentPreview[],
  selectedRoomIds: readonly string[],
  destinationStaffId: string,
  options: { allowGozsduManagerOverride?: boolean; destinationIsLaundryner?: boolean } = {},
): BulkRoomMoveResult {
  const fail = (error: NonNullable<BulkRoomMoveResult['error']>): BulkRoomMoveResult => ({
    previews, movedRoomIds: [], error,
  });

  if (!destinationStaffId || !previews.some(person => person.staffId === destinationStaffId)) {
    return fail('invalid_destination');
  }
  if (options.destinationIsLaundryner) return fail('laundryner_destination');

  const uniqueIds = [...new Set(selectedRoomIds)];
  if (!uniqueIds.length) return fail('nothing_to_move');

  const sourceByRoom = new Map<string, string>();
  for (const person of previews) {
    for (const room of person.rooms) {
      if (!uniqueIds.includes(room.id)) continue;
      if (sourceByRoom.has(room.id)) return fail('duplicate_room');
      sourceByRoom.set(room.id, person.staffId);
    }
  }
  if (uniqueIds.some(id => !sourceByRoom.has(id))) return fail('missing_room');

  let next = previews;
  const movedRoomIds: string[] = [];
  for (const roomId of uniqueIds) {
    const sourceStaffId = sourceByRoom.get(roomId)!;
    if (sourceStaffId === destinationStaffId) continue;
    const proposed = moveRoom(
      next, roomId, sourceStaffId, destinationStaffId,
      options.allowGozsduManagerOverride === true,
    );
    if (proposed === next) return fail('restricted_move');
    next = proposed;
    movedRoomIds.push(roomId);
  }
  if (!movedRoomIds.length) return fail('nothing_to_move');
  return { previews: next, movedRoomIds, error: null };
}
