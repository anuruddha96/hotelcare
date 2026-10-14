/** One physical pool marketed under two Previo room types.
 * A confirmed room night occupies one real room, regardless of how many
 * virtual categories advertise it. This calculates the upper limit, not an
 * atomic online-booking guarantee.
 */
export function permittedSharedAvailability(
  initialSharedUnits: number,
  physicalCapacity: number,
  confirmedRoomNights: number,
): number | null {
  if (![initialSharedUnits, physicalCapacity, confirmedRoomNights].every(Number.isInteger) ||
      initialSharedUnits < 1 || initialSharedUnits > 20 ||
      physicalCapacity < initialSharedUnits || confirmedRoomNights < 0)
    return null;
  return Math.max(0, Math.min(initialSharedUnits, physicalCapacity - confirmedRoomNights));
}

export function sharedPoolRequiresClosing(
  currentAvailable: number,
  maximumPermitted: number,
): boolean {
  return Number.isInteger(currentAvailable) && Number.isInteger(maximumPermitted) &&
    currentAvailable > maximumPermitted;
}

// Preserve room-night multiplicity while ignoring a changed Previo room
// assignment. The reservation ID itself must stay the same.
export function unchangedReservationIds(baselineKeys:string[], currentIds:string[]):boolean {
 if(baselineKeys.length!==currentIds.length)return false;
 const counts=new Map<string,number>();
 for(const key of baselineKeys){
  const id=String(key).split("|")[0];
  if(!id)return false;
  counts.set(id,(counts.get(id)??0)+1);
 }
 for(const raw of currentIds){
  const id=String(raw);
  const n=counts.get(id)??0;
  if(n===0)return false;
  if(n===1)counts.delete(id);else counts.set(id,n-1);
 }
 return counts.size===0;
}


/** Capacity-neutral cross-category pool: count NEW room-nights in the linked
 * categories against their activation baseline, not every unrelated booking
 * in the property. A Twin booking must not consume a Quad/Queen shared unit.
 *
 * Compare the number of room items per reservation so a second room added
 * under an existing Previo reservation ID is still counted. Room assignment
 * swaps and changed room IDs do not invent new bookings.
 */
export function permittedLinkedPoolAvailability(
  initialSharedUnits: number,
  physicalCapacity: number,
  baselineRefs: string[],
  current: Array<{ resId: string; obkId: string | null }>,
  firstObkId: string,
  secondObkId: string,
): number | null {
  const hotelLimit = permittedSharedAvailability(initialSharedUnits, physicalCapacity, current.length);
  if (hotelLimit === null || !Array.isArray(baselineRefs) ||
      !firstObkId || !secondObkId || firstObkId === secondObkId) return null;
  const linked = new Set([firstObkId, secondObkId]);
  const previouslyLinked = new Map<string, number>();
  for (const ref of baselineRefs) {
    const parts = String(ref).split("|");
    if (!parts[0]) return null;
    if (linked.has(parts[2] ?? "")) {
      previouslyLinked.set(parts[0], (previouslyLinked.get(parts[0]) ?? 0) + 1);
    }
  }
  const currentlyLinked = new Map<string, number>();
  for (const room of current) {
    if (!room.resId) return null;
    if (room.obkId && linked.has(room.obkId)) {
      currentlyLinked.set(room.resId, (currentlyLinked.get(room.resId) ?? 0) + 1);
    }
  }
  let linkedPickup = 0;
  for (const [reservationId, currentCount] of currentlyLinked) {
    linkedPickup += Math.max(0, currentCount - (previouslyLinked.get(reservationId) ?? 0));
  }
  return Math.min(hotelLimit, Math.max(0, initialSharedUnits - linkedPickup));
}
