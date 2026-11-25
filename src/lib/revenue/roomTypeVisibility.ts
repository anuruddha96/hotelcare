/** Previo technical/service room kinds are not sellable guest accommodations. */
export function isTechnicalRoomKind(name: string | null | undefined): boolean {
  return /^(?:technikai(?:\s+szoba)?|technical\s+rooms?)$/i.test(String(name ?? "").trim());
}

/**
 * A room type is an active, physical, sellable accommodation category only
 * when Previo still assigns at least one actual room to it.
 *
 * A sold-out DATE does not affect this list: keep the category visible and
 * render that date as "Sold out" in the inventory row instead.
 * Missing rates do not hide a new room kind; operators must be able to see
 * that its pricing has not yet been configured in Previo.
 */
export function activePricingRoomTypes<T extends {
  pms_room_id: string | null;
  name?: string | null;
  num_rooms: number;
  is_sellable?: boolean;
  counts_toward_inventory?: boolean;
}>(roomTypes: T[]): T[] {
  return roomTypes.filter((room) =>
    Boolean(String(room.pms_room_id ?? "").trim())
    && Number.isFinite(Number(room.num_rooms))
    && Number(room.num_rooms) > 0
    && room.is_sellable !== false
    && room.counts_toward_inventory !== false
    && !isTechnicalRoomKind(room.name)
  );
}
