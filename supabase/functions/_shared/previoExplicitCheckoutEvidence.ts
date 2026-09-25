/**
 * Read-only, Gozsdu-specific decoder for Previo's explicit check-out search.
 * A dirty room, scheduled departure or missing REST reservation NEVER releases
 * housekeeping. This decoder is called only with Previo's explicit check-out
 * feed already scoped to the current business date, so status 6/9 is physical
 * departure evidence even when the reservation's original <to> date is later
 * (an early checkout). The physical Previo room ID must still match locally.
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
    // Do not require the reservation's scheduled <to> date to equal today.
    // termType=check-out is itself scoped to businessDate and status 6/9 means
    // the guest actually departed. Requiring <to>===today loses legitimate
    // early checkouts whose original planned departure is still in the future.
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
