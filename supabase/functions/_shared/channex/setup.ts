/**
 * Pure planning for Channex content sync (room types + rate plans). No I/O.
 *
 * Idempotency rules (so a retry never creates duplicate remote objects):
 *   1. A stored mapping wins, but only if the remote object still exists under THIS property
 *      (readback). A mapping pointing elsewhere is an error, never silently recreated.
 *   2. No mapping: adopt an existing remote object with the same title (case/space-insensitive)
 *      that is not already mapped to another HotelCare room type.
 *   3. Otherwise create.
 *
 * Model: one Channex room type per sellable HotelCare room type, and one per-room "Standard"
 * rate plan on it priced at the hotel's primary occupancy (matches the revenue engine output).
 */

export type LocalRoomType = { id: string; name: string; num_rooms: number; is_sellable: boolean };
export type RemoteEntity = { id: string; attributes?: Record<string, any> };
export type Mapping = { kind: "room_type" | "rate_plan"; local_id: string; channex_id: string };
export type RoomSettings = Record<string, { max_adults?: number; max_children?: number }>;

export type Step<A> =
  | { kind: "keep"; channexId: string }
  | { kind: "update"; channexId: string; attrs: A }
  | { kind: "adopt"; channexId: string }
  | { kind: "create"; attrs: A }
  | { kind: "error"; message: string };

export type ContentPlanItem = {
  local: LocalRoomType;
  roomType: Step<Record<string, unknown>>;
  /** Rate plan attrs need the final room type id, so "create" here carries a builder. */
  ratePlan: Step<Record<string, unknown>> | { kind: "create_after_room"; build: (roomTypeId: string) => Record<string, unknown> };
};

const norm = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const title = (e: RemoteEntity) => e.attributes?.title;

export function ratePlanTitle(roomName: string): string {
  return `${roomName.trim()} – Standard`;
}

export function roomTypeAttrs(propertyId: string, local: LocalRoomType, primaryOccupancy: number, settings?: { max_adults?: number; max_children?: number }) {
  const adults = Math.max(primaryOccupancy, Math.floor(settings?.max_adults ?? primaryOccupancy), 1);
  return {
    property_id: propertyId,
    title: local.name.trim(),
    count_of_rooms: Math.max(0, Math.floor(local.num_rooms)),
    occ_adults: adults,
    occ_children: Math.max(0, Math.floor(settings?.max_children ?? 0)),
    occ_infants: 0,
    default_occupancy: Math.min(primaryOccupancy, adults),
    room_kind: "room",
  };
}

export function ratePlanAttrs(propertyId: string, roomTypeId: string, local: LocalRoomType, currency: string, primaryOccupancy: number) {
  return {
    property_id: propertyId,
    room_type_id: roomTypeId,
    title: ratePlanTitle(local.name),
    currency: currency.toUpperCase(),
    sell_mode: "per_room",
    rate_mode: "manual",
    // Rate 0 until the first ARI push; minor units on write.
    options: [{ occupancy: primaryOccupancy, is_primary: true, rate: 0 }],
  };
}

export function planContentSync(input: {
  propertyId: string;
  currency: string;
  primaryOccupancy: number;
  locals: LocalRoomType[];
  mappings: Mapping[];
  remoteRoomTypes: RemoteEntity[];
  remoteRatePlans: RemoteEntity[];
  settings?: RoomSettings;
}): { items: ContentPlanItem[]; skipped: { local: LocalRoomType; reason: string }[] } {
  const { propertyId, currency, primaryOccupancy } = input;
  const roomMap = new Map(input.mappings.filter((m) => m.kind === "room_type").map((m) => [m.local_id, m.channex_id]));
  const rateMap = new Map(input.mappings.filter((m) => m.kind === "rate_plan").map((m) => [m.local_id, m.channex_id]));
  const takenRooms = new Set(roomMap.values());
  const takenRates = new Set(rateMap.values());
  const remoteRooms = new Map(input.remoteRoomTypes.map((r) => [String(r.id), r]));
  const remoteRates = new Map(input.remoteRatePlans.map((r) => [String(r.id), r]));

  const items: ContentPlanItem[] = [];
  const skipped: { local: LocalRoomType; reason: string }[] = [];

  for (const local of input.locals) {
    if (!local.is_sellable) { skipped.push({ local, reason: "not sellable" }); continue; }
    if (!(local.num_rooms >= 1)) { skipped.push({ local, reason: "no rooms of this type" }); continue; }
    const attrs = roomTypeAttrs(propertyId, local, primaryOccupancy, input.settings?.[local.id]);

    // --- room type
    let roomType: Step<Record<string, unknown>>;
    let roomTypeId: string | null = null;
    const mappedRoom = roomMap.get(local.id);
    if (mappedRoom) {
      const remote = remoteRooms.get(mappedRoom);
      if (!remote) {
        roomType = { kind: "error", message: `Mapped Channex room type ${mappedRoom} was not found under this property` };
      } else {
        roomTypeId = mappedRoom;
        const a = remote.attributes ?? {};
        const changed = norm(a.title) !== norm(attrs.title) || Number(a.count_of_rooms) !== attrs.count_of_rooms;
        roomType = changed
          ? { kind: "update", channexId: mappedRoom, attrs: { title: attrs.title, count_of_rooms: attrs.count_of_rooms } }
          : { kind: "keep", channexId: mappedRoom };
      }
    } else {
      const match = input.remoteRoomTypes.find((r) => norm(title(r)) === norm(local.name) && !takenRooms.has(String(r.id)));
      if (match) {
        roomTypeId = String(match.id);
        takenRooms.add(roomTypeId);
        roomType = { kind: "adopt", channexId: roomTypeId };
      } else {
        roomType = { kind: "create", attrs };
      }
    }

    // --- rate plan
    let ratePlan: ContentPlanItem["ratePlan"];
    const mappedRate = rateMap.get(local.id);
    if (roomType.kind === "error") {
      ratePlan = { kind: "error", message: "Room type must be fixed first" };
    } else if (mappedRate) {
      const remote = remoteRates.get(mappedRate);
      if (!remote) ratePlan = { kind: "error", message: `Mapped Channex rate plan ${mappedRate} was not found under this property` };
      else if (roomTypeId && String(remote.attributes?.room_type_id ?? roomTypeId) !== roomTypeId)
        ratePlan = { kind: "error", message: "Mapped rate plan belongs to a different Channex room type" };
      else ratePlan = { kind: "keep", channexId: mappedRate };
    } else if (roomTypeId) {
      const rtId = roomTypeId;
      const match = input.remoteRatePlans.find((r) =>
        norm(title(r)) === norm(ratePlanTitle(local.name)) &&
        String(r.attributes?.room_type_id ?? "") === rtId &&
        !takenRates.has(String(r.id)));
      if (match) { takenRates.add(String(match.id)); ratePlan = { kind: "adopt", channexId: String(match.id) }; }
      else ratePlan = { kind: "create", attrs: ratePlanAttrs(propertyId, rtId, local, currency, primaryOccupancy) };
    } else {
      ratePlan = { kind: "create_after_room", build: (id: string) => ratePlanAttrs(propertyId, id, local, currency, primaryOccupancy) };
    }

    items.push({ local, roomType, ratePlan });
  }
  return { items, skipped };
}

/** Compare HotelCare availability with Channex readback. */
export function compareAvailability(
  expected: { channex_room_type_id: string; stay_date: string; availability: number }[],
  remote: Record<string, Record<string, number>> | null | undefined,
): { checked: number; mismatches: { room_type_id: string; date: string; hotelcare: number; channex: number | null }[] } {
  const mismatches: { room_type_id: string; date: string; hotelcare: number; channex: number | null }[] = [];
  for (const row of expected) {
    const got = remote?.[row.channex_room_type_id]?.[row.stay_date];
    const value = typeof got === "number" ? got : got == null ? null : Number(got);
    if (value !== row.availability) mismatches.push({ room_type_id: row.channex_room_type_id, date: row.stay_date, hotelcare: row.availability, channex: value });
  }
  return { checked: expected.length, mismatches };
}
