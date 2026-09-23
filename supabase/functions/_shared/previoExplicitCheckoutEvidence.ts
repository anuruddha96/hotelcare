/**
 * Read-only, Gozsdu-specific decoder for Previo's explicit check-out search.
 * A dirty room, scheduled departure or missing REST reservation NEVER releases
 * housekeeping. Only today's explicit checked-out reservation matched to a
 * known physical Previo room ID is eligible.
 */
export type VerifiedGozsduCheckout = {
  objId: number;
  roomName: string;
  reservationId: string;
};

export function verifiedGozsduCheckouts(
  xml: string,
  businessDate: string,
  knownPhysicalRooms: ReadonlyMap<number, string>,
  locallyMappedRoomIds: ReadonlySet<number>,
  explicitlyInHouseRoomIds: ReadonlySet<number>,
): VerifiedGozsduCheckout[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return [];
  const verified: VerifiedGozsduCheckout[] = [];
  const seen = new Set<number>();
  for (const block of xml.match(/<reservation>[\s\S]*?<\/reservation>/gi) ?? []) {
    const tag = (name: string) => block.match(new RegExp(`<${name}>([^<]*)<\\/${name}>`, 'i'))?.[1]?.trim() ?? '';
    const status = Number(tag('statusId') || tag('cosId'));
    if (status !== 6 && status !== 9) continue;
    const departure = tag('to').slice(0, 10);
    if (departure !== businessDate) continue;
    const object = block.match(/<object>[\s\S]*?<objId>(\d+)<\/objId>[\s\S]*?<name>([^<]*)<\/name>[\s\S]*?<\/object>/i);
    if (!object) continue;
    const objId = Number(object[1]);
    const roomName = object[2].trim();
    // Neither a coincidentally matching unit suffix nor an unrecognised PMS
    // object may release a real room. The REST roster and DB mapping must agree.
    if (knownPhysicalRooms.get(objId) !== roomName
      || !locallyMappedRoomIds.has(objId)
      || explicitlyInHouseRoomIds.has(objId)
      || seen.has(objId)) continue;
    seen.add(objId);
    verified.push({ objId, roomName, reservationId: tag('resId') || tag('reservationId') || tag('id') });
  }
  return verified;
}
