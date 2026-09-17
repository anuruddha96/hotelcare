// A PMS-facing room label is not necessarily the persisted rooms.room_number.
// Prefer the stable room ID supplied by a chip; never infer a room from a
// possibly duplicated numeric suffix. Legacy chips without an ID keep their
// existing room_number lookup behavior.
export function roomOperationsLookup(roomId: string | null | undefined, displayNumber: string): {
  column: 'id' | 'room_number'; value: string;
} {
  return roomId ? { column: 'id', value: roomId } : { column: 'room_number', value: displayNumber };
}
