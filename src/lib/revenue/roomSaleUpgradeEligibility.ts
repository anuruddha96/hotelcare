/** Pure eligibility checks for borrowing an existing room as a free upgrade.
 * Never infer capacity from the displayed (possibly translated) room name. */
export interface UpgradeRoom {
  pms_room_id: string | null;
  name: string;
  is_sellable?: boolean;
  counts_toward_inventory?: boolean;
  guest_levels?: number[];
}

export function canOfferComplimentaryUpgrade(
  bookedType: UpgradeRoom,
  originalType: UpgradeRoom,
  availableOriginalUnits: number,
  requiredUnits: number,
): boolean {
  if (!bookedType.pms_room_id || !originalType.pms_room_id ||
      bookedType.pms_room_id === originalType.pms_room_id ||
      originalType.is_sellable === false ||
      originalType.counts_toward_inventory === false) return false;
  if (!Number.isInteger(requiredUnits) || requiredUnits <= 0 ||
      !Number.isInteger(availableOriginalUnits) ||
      availableOriginalUnits < requiredUnits) return false;
  const bookedGuests = Math.max(0, ...(bookedType.guest_levels ?? []));
  const originalGuests = Math.max(0, ...(originalType.guest_levels ?? []));
  return bookedGuests > 0 && originalGuests >= bookedGuests;
}

/** Virtual closure must not display a price belonging to an unrelated booking. */
export function showOwnLastSoldPrice(remaining: number, closedForUpgrade: boolean): boolean {
  return remaining === 0 && !closedForUpgrade;
}
