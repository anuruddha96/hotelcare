type RateChange = {
  stay_date: string;
  obk_id?: string | null;
  room_type_name: string;
  occupancy: number;
  new_price: number;
};

type MappingRow = {
  previo_room_type_id: string | null;
  previo_rate_plan_id: string | null;
};

type RoomTypeRow = {
  name: string;
  pms_room_id: string | null;
  sort_order: number | null;
  is_sellable: boolean | null;
  counts_toward_inventory: boolean | null;
};

const NON_ROOM_PRODUCT = /brunch|breakfast|coffee|visitor|látogató|conference|konferencia|meeting|terem/i;

const cellKey = (date: string, room: string, occupancy: number) =>
  `${date}|${room}|${occupancy}`;

const mappingKey = (value: unknown) => String(value ?? "").trim();

async function paged<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const rows: T[] = [];
  const size = 1000;
  for (let page = 0; page < 50; page += 1) {
    const { data, error } = await build(page * size, page * size + size - 1);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < size) break;
  }
  return rows;
}

/**
 * Refuse a write unless its exact Previo room type has a usable rate-plan
 * mapping. A default mapping is never a safe substitute: it can overwrite a
 * different room category's occupancy ladder.
 */
export async function assertExactRateMappings(
  admin: any,
  hotelId: string,
  changes: RateChange[],
): Promise<void> {
  const { data, error } = await admin
    .from("previo_rate_plan_mapping")
    .select("previo_room_type_id, previo_rate_plan_id")
    .eq("hotel_id", hotelId);
  if (error) throw error;

  const mapped = new Set(
    ((data ?? []) as MappingRow[])
      .filter((row) => row.previo_room_type_id && row.previo_rate_plan_id)
      .map((row) => mappingKey(row.previo_room_type_id)),
  );
  const missing = new Set<string>();
  for (const change of changes) {
    const obkId = mappingKey(change.obk_id);
    if (!obkId || !mapped.has(obkId)) missing.add(change.room_type_name || obkId || "Unknown room type");
  }
  if (missing.size > 0) {
    throw new Error(
      `Price not sent: no exact Previo rate-plan mapping for ${Array.from(missing).slice(0, 5).join(", ")}. Sync rate plans, then try again.`,
    );
  }
}

/**
 * Protect the configured low-to-high room order for Gozsdu and Memories.
 * Existing external inversions stay visible, but an incoming Hotel Care change
 * may not create or deepen one. Only same-date, same-occupancy cells compare.
 */
export async function assertRoomHierarchy(
  admin: any,
  hotelId: string,
  changes: RateChange[],
): Promise<void> {
  if (!new Set(["gozsdu-court", "memories-budapest"]).has(hotelId) || changes.length === 0) return;

  const { data: roomData, error: roomError } = await admin
    .from("room_types")
    .select("name,pms_room_id,sort_order,is_sellable,counts_toward_inventory")
    .eq("hotel_id", hotelId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (roomError) throw roomError;

  const rooms = ((roomData ?? []) as RoomTypeRow[]).filter((room) =>
    room.is_sellable !== false &&
    room.counts_toward_inventory !== false &&
    !!room.pms_room_id &&
    !NON_ROOM_PRODUCT.test(room.name),
  );
  if (rooms.length < 2) return;

  const roomIndex = new Map(rooms.map((room, index) => [room.name, index]));
  const relevant = changes.filter((change) => roomIndex.has(change.room_type_name));
  if (relevant.length === 0) return;

  const dates = Array.from(new Set(relevant.map((change) => change.stay_date))).sort();
  const current = await paged<{
    stay_date: string;
    room_type_name: string;
    occupancy: number;
    price: number;
    updated_at: string;
  }>((from, to) => admin
    .from("revenue_room_type_rates")
    .select("stay_date,room_type_name,occupancy,price,updated_at")
    .eq("hotel_id", hotelId)
    .gte("stay_date", dates[0])
    .lte("stay_date", dates[dates.length - 1])
    .order("updated_at", { ascending: true })
    .range(from, to));

  const prices = new Map<string, number>();
  for (const row of current) {
    prices.set(cellKey(row.stay_date, row.room_type_name, Number(row.occupancy)), Number(row.price));
  }
  const touched = new Set<string>();
  for (const change of relevant) {
    const key = cellKey(change.stay_date, change.room_type_name, Number(change.occupancy));
    prices.set(key, Number(change.new_price));
    touched.add(key);
  }

  for (const change of relevant) {
    const index = roomIndex.get(change.room_type_name);
    if (index === undefined) continue;
    for (const neighbourIndex of [index - 1, index + 1]) {
      const neighbour = rooms[neighbourIndex];
      if (!neighbour) continue;
      const lower = rooms[Math.min(index, neighbourIndex)];
      const higher = rooms[Math.max(index, neighbourIndex)];
      const lowerKey = cellKey(change.stay_date, lower.name, Number(change.occupancy));
      const higherKey = cellKey(change.stay_date, higher.name, Number(change.occupancy));
      if (!touched.has(lowerKey) && !touched.has(higherKey)) continue;
      const lowerPrice = prices.get(lowerKey);
      const higherPrice = prices.get(higherKey);
      if (lowerPrice !== undefined && higherPrice !== undefined && lowerPrice > higherPrice) {
        throw new Error(
          `Price hierarchy blocked for ${change.stay_date}: ${lower.name} (${lowerPrice}) cannot be higher than ${higher.name} (${higherPrice}) for ${change.occupancy} guest${change.occupancy === 1 ? "" : "s"}.`,
        );
      }
    }
  }
}

export async function assertRateChangesSafe(
  admin: any,
  hotelId: string,
  changes: RateChange[],
): Promise<void> {
  await assertExactRateMappings(admin, hotelId, changes);
  await assertRoomHierarchy(admin, hotelId, changes);
}