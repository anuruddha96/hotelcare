/** Only write a Previo room when a value actually changed.
 * Avoid empty updates: rooms has many triggers and is in the Realtime publication.
 * This compares the exact PMS-owned fields that the sync writes; other
 * housekeeping, manual-override and guest metadata must not be discarded.
 */
export type PrevioRoomSnapshot = {
  status: string | null;
  room_type: string | null;
  pms_metadata: Record<string, unknown> | null;
};

export type PrevioRoomFields = {
  status: string;
  room_type: string;
  pms_metadata: Record<string, unknown>;
};

const PMS_OWNED_FIELDS = [
  'roomId',
  'roomKindId',
  'roomKindName',
  'roomTypeId',
  'roomCleanStatusId',
] as const;

export function isUnchangedPrevioRoom(
  current: PrevioRoomSnapshot,
  incoming: PrevioRoomFields,
): boolean {
  if (current.status !== incoming.status || current.room_type !== incoming.room_type) {
    return false;
  }
  const currentMeta = current.pms_metadata ?? {};
  return PMS_OWNED_FIELDS.every((key) =>
    Object.prototype.hasOwnProperty.call(currentMeta, key)
    && Object.is(currentMeta[key], incoming.pms_metadata[key])
  );
}
