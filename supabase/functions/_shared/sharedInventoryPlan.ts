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
