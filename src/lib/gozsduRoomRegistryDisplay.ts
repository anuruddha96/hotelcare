export type GozsduRoomRegistryEntry = {
  room_id: string;
  pms_room_name: string;
  service_status: string;
};

/**
 * Local `rooms.room_number` may contain only the numeric suffix. The manager's
 * authoritative 82-room Previo registry identifies a unit by stable room ID.
 * Never infer its physical building from a PMS prefix: for example, 1B-C13
 * belongs to Kazinczy C, not Building I.
 */
export function buildGozsduRoomRegistryIndex(
  rooms: readonly { id: string }[],
  entries: readonly GozsduRoomRegistryEntry[],
): Map<string, GozsduRoomRegistryEntry> {
  const ids = new Set(rooms.map(room => room.id));
  const index = new Map<string, GozsduRoomRegistryEntry>();
  const names = new Set<string>();
  if (ids.size !== rooms.length || entries.length !== rooms.length) {
    throw new Error('Gozsdu PMS room names cannot be verified for every displayed room.');
  }
  for (const entry of entries) {
    const name = String(entry.pms_room_name || '').normalize('NFKC').trim();
    const key = name.toLowerCase();
    if (!ids.has(entry.room_id) || index.has(entry.room_id) || !key || names.has(key)) {
      throw new Error('Gozsdu PMS room names contain a missing, duplicate or unknown mapping.');
    }
    index.set(entry.room_id, { ...entry, pms_room_name: name });
    names.add(key);
  }
  return index;
}
