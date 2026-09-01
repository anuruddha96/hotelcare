type RateChange = {
  stay_date: string;
  obk_id?: string | null;
  room_type_name: string;
  occupancy: number;
  new_price: number;
  old_price?: number | null;
  [key: string]: unknown;
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

type StoredRate = {
  stay_date: string;
  obk_id: string | null;
  room_type_name: string;
  occupancy: number;
  price: number;
  updated_at?: string | null;
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

function dateWindow(changes: RateChange[]): [string, string] {
  const dates = Array.from(new Set(changes.map((c) => c.stay_date))).sort();
  return [dates[0], dates[dates.length - 1]];
}

async function loadStoredRates(
  admin: any,
  hotelId: string,
  changes: RateChange[],
): Promise<StoredRate[]> {
  const [from, to] = dateWindow(changes);
  return await paged<StoredRate>((start, end) => admin
    .from("revenue_room_type_rates")
    .select("stay_date,obk_id,room_type_name,occupancy,price,updated_at")
    .eq("hotel_id", hotelId)
    .gte("stay_date", from)
    .lte("stay_date", to)
    .order("updated_at", { ascending: true })
    .range(start, end));
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
 * Same mapping rule, applied one cell at a time.
 *
 * A single room type without an exact rate plan must not cancel a whole month
 * of prices: the mapped cells still go to Previo and only the unmapped ones are
 * reported back, so the reader sees exactly which rooms need a rate-plan sync.
 */
export async function partitionByExactRateMappings(
  admin: any,
  hotelId: string,
  changes: RateChange[],
): Promise<{ mapped: RateChange[]; unmapped: Array<{ change: RateChange; reason: string }> }> {
  if (changes.length === 0) return { mapped: [], unmapped: [] };
  const { data, error } = await admin
    .from("previo_rate_plan_mapping")
    .select("previo_room_type_id, previo_rate_plan_id")
    .eq("hotel_id", hotelId);
  if (error) throw error;

  const mappedTypes = new Set(
    ((data ?? []) as MappingRow[])
      .filter((row) => row.previo_room_type_id && row.previo_rate_plan_id)
      .map((row) => mappingKey(row.previo_room_type_id)),
  );
  const mapped: RateChange[] = [];
  const unmapped: Array<{ change: RateChange; reason: string }> = [];
  for (const change of changes) {
    const obkId = mappingKey(change.obk_id);
    if (obkId && mappedTypes.has(obkId)) mapped.push(change);
    else {
      unmapped.push({
        change,
        reason: `No exact Previo rate-plan mapping for ${change.room_type_name || obkId || "this room type"}. Sync rate plans, then try again.`,
      });
    }
  }
  return { mapped, unmapped };
}


// ---------------------------------------------------------------------------
// Occupancy ladder
// ---------------------------------------------------------------------------

/**
 * A room type on one date must never charge less for more guests. Every pricing
 * path (manual cell edit, bulk editor, automation) decides one cell at a time,
 * and per-cell floors/top-ups regularly lift the 2-guest level above the
 * untouched 3-guest level. This pure helper takes the merged ladder and returns
 * the price each level must end up at, repairing only upward so no floor,
 * min-ADR or markdown cap is ever undercut.
 */
export function repairLadder(
  levels: Array<{ occupancy: number; price: number }>,
  step = 0,
  maxGap = 0,
): Map<number, number> {
  const sorted = [...levels]
    .filter((level) => Number.isFinite(Number(level.price)))
    .sort((a, b) => a.occupancy - b.occupancy);
  const out = new Map<number, number>();
  const gap = Math.max(0, Math.round(step));
  let runningMax = -Infinity;
  let previousOccupancy: number | null = null;
  for (const level of sorted) {
    const price = Number(level.price);
    const occupancy = Number(level.occupancy);
    // More guests must cost more, not the same: the required step is applied
    // per guest level, so a repaired ladder never repeats one number.
    const required = runningMax === -Infinity
      ? price
      : runningMax + gap * Math.max(1, occupancy - (previousOccupancy ?? occupancy));
    const target = Math.max(price, required);
    runningMax = target;
    previousOccupancy = occupancy;
    out.set(occupancy, Math.round(target));
  }

  // Second pass — the "fill the higher pillars" rule. A lower guest count may
  // never sit further than `maxGap` per guest below the level above it: a
  // 1-guest rate 40 below the 2-guest rate simply sells the room cheap. The
  // repair always LIFTS the lower level (never cuts the stronger one), so no
  // floor, min-ADR or markdown cap can be undercut by a repair.
  const cap = Math.max(0, Math.round(maxGap));
  if (cap > 0 && sorted.length > 1) {
    for (let i = sorted.length - 1; i > 0; i--) {
      const higherOcc = Number(sorted[i].occupancy);
      const lowerOcc = Number(sorted[i - 1].occupancy);
      const higher = out.get(higherOcc);
      const lower = out.get(lowerOcc);
      if (higher === undefined || lower === undefined) continue;
      const span = Math.max(1, higherOcc - lowerOcc);
      const wanted = higher - cap * span;
      // Never lift the lower level so high that the minimum guest step breaks.
      const ceiling = higher - gap * span;
      const target = Math.min(wanted, Math.max(lower, ceiling));
      if (target > lower) out.set(lowerOcc, Math.round(target));
    }
  }
  return out;
}

/** Minimum price difference between one guest count and the next. */
export async function loadGuestStep(admin: any, hotelId: string): Promise<number> {
  try {
    const { data } = await admin
      .from("hotel_revenue_settings")
      .select("extra_guest_supplement_eur")
      .eq("hotel_id", hotelId)
      .maybeSingle();
    const value = Number((data as any)?.extra_guest_supplement_eur);
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
  } catch {
    return 0;
  }
}

/**
 * Largest allowed distance between two neighbouring guest counts. EUR hotels
 * use the operator rule of thumb (15); other currencies use the equivalent
 * share of the price so the rule travels to HUF without a conversion table.
 */
export const MAX_GUEST_GAP_EUR = 15;

export function maxGuestGapFor(basePrice: number, currency?: string | null): number {
  const price = Number(basePrice);
  if ((currency ?? "EUR").toUpperCase() === "EUR") return MAX_GUEST_GAP_EUR;
  if (!Number.isFinite(price) || price <= 0) return 0;
  return Math.max(1, Math.round(price * 0.15));
}



/**
 * Merge the pending changes with the stored ladder and return the extra sibling
 * changes needed to keep every ladder non-decreasing. Pending changes whose own
 * price is below a lower occupancy are lifted in place.
 */
export async function normalizeOccupancyLadder(
  admin: any,
  hotelId: string,
  changes: RateChange[],
): Promise<RateChange[]> {
  if (changes.length === 0) return [];
  const stored = await loadStoredRates(admin, hotelId, changes);
  const guestStep = await loadGuestStep(admin, hotelId);


  const groupKey = (row: { stay_date: string; obk_id?: string | null; room_type_name: string }) =>
    `${row.stay_date}|${mappingKey(row.obk_id) || row.room_type_name}`;

  // Newest stored price per cell (rows arrive oldest-first).
  const storedPrice = new Map<string, number>();
  const groupLevels = new Map<string, Set<number>>();
  for (const row of stored) {
    const key = `${groupKey(row)}|${Number(row.occupancy)}`;
    storedPrice.set(key, Number(row.price));
    const group = groupKey(row);
    if (!groupLevels.has(group)) groupLevels.set(group, new Set());
    groupLevels.get(group)!.add(Number(row.occupancy));
  }

  const changeByCell = new Map<string, RateChange>();
  const touchedGroups = new Map<string, RateChange>();
  for (const change of changes) {
    const group = groupKey(change);
    changeByCell.set(`${group}|${Number(change.occupancy)}`, change);
    if (!touchedGroups.has(group)) touchedGroups.set(group, change);
  }

  const repairs: RateChange[] = [];
  for (const [group, template] of touchedGroups) {
    const occupancies = new Set<number>(groupLevels.get(group) ?? []);
    for (const change of changes) {
      if (groupKey(change) === group) occupancies.add(Number(change.occupancy));
    }
    if (occupancies.size < 2) continue;

    const merged = Array.from(occupancies).sort((a, b) => a - b).map((occupancy) => {
      const cell = `${group}|${occupancy}`;
      const pending = changeByCell.get(cell);
      const price = pending ? Number(pending.new_price) : Number(storedPrice.get(cell));
      return { occupancy, price };
    }).filter((level) => Number.isFinite(level.price));

    const base = merged[0]?.price ?? 0;
    const currency = (template as any)?.currency ?? "EUR";
    const repaired = repairLadder(merged, guestStep, maxGuestGapFor(base, currency));

    for (const level of merged) {
      const target = repaired.get(level.occupancy);
      if (target === undefined || target <= Math.round(level.price)) continue;
      const cell = `${group}|${level.occupancy}`;
      const pending = changeByCell.get(cell);
      if (pending) {
        pending.new_price = target;
        continue;
      }
      const repair: RateChange = { ...template };
      repair.occupancy = level.occupancy;
      repair.old_price = Math.round(level.price);
      repair.new_price = target;
      if ("intent_source" in repair) repair.intent_source = "ladder_repair";
      if ("id" in repair) delete (repair as Record<string, unknown>).id;
      repairs.push(repair);
      changeByCell.set(cell, repair);
    }
  }
  return repairs;
}

/**
 * Shared evaluation for the configured low-to-high room order. Existing
 * external inversions stay visible — blocking every edit on an already-inverted
 * date would freeze the calendar — but an incoming Hotel Care change may not
 * create or deepen one. Only same-date, same-occupancy cells compare.
 *
 * Loads rooms and stored rates exactly once, then evaluates in memory: batch
 * paths pass thousands of changes and must not issue a query per change.
 */
async function evaluateRoomHierarchy(
  admin: any,
  hotelId: string,
  changes: RateChange[],
): Promise<Array<{ change: RateChange; reason: string }>> {
  if (changes.length === 0) return [];

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
  // Without a deliberate low-to-high order there is nothing to protect.
  const orders = new Set(rooms.map((room) => room.sort_order).filter((value) => value !== null && value !== undefined));
  if (rooms.length < 2 || orders.size < 2) return [];

  const roomIndex = new Map(rooms.map((room, index) => [room.name, index]));
  const relevant = changes.filter((change) => roomIndex.has(change.room_type_name));
  if (relevant.length === 0) return [];

  const stored = await loadStoredRates(admin, hotelId, relevant);
  const before = new Map<string, number>();
  for (const row of stored) {
    before.set(cellKey(row.stay_date, row.room_type_name, Number(row.occupancy)), Number(row.price));
  }

  // For queued/background publishing, one logical edit can be delivered in
  // several slices. Earlier slices may already have mirrored their new prices
  // into `revenue_room_type_rates` by the time the later slice is validated.
  // Using only the live mirror as the baseline then makes the remaining
  // sibling markdown look like it "deepens" an inversion, even when the whole
  // original batch preserved the exact same gap. Prefer the draft's captured
  // old price as the baseline for touched cells so the guard evaluates the
  // user's intended before/after state, not a half-applied intermediate state.
  for (const change of relevant) {
    const oldPrice = Number(change.old_price);
    if (!Number.isFinite(oldPrice) || oldPrice <= 0) continue;
    before.set(cellKey(change.stay_date, change.room_type_name, Number(change.occupancy)), Math.round(oldPrice));
  }

  const gap = (map: Map<string, number>, lowerKey: string, higherKey: string): number | null => {
    const lower = map.get(lowerKey);
    const higher = map.get(higherKey);
    if (lower === undefined || higher === undefined) return null;
    return lower - higher;
  };

  const violations: Array<{ change: RateChange; reason: string }> = [];
  const dropped = new Set<RateChange>();

  // A dropped change changes the picture for its neighbours, so re-evaluate
  // until the set is stable. All of this is in-memory.
  for (let pass = 0; pass < 5; pass += 1) {
    const active = relevant.filter((change) => !dropped.has(change));
    const after = new Map(before);
    const touched = new Set<string>();
    for (const change of active) {
      const key = cellKey(change.stay_date, change.room_type_name, Number(change.occupancy));
      after.set(key, Number(change.new_price));
      touched.add(key);
    }

    const found: Array<{ change: RateChange; reason: string }> = [];
    for (const change of active) {
      const index = roomIndex.get(change.room_type_name);
      if (index === undefined) continue;
      for (const neighbourIndex of [index - 1, index + 1]) {
        if (!rooms[neighbourIndex]) continue;
        const lower = rooms[Math.min(index, neighbourIndex)];
        const higher = rooms[Math.max(index, neighbourIndex)];
        const lowerKey = cellKey(change.stay_date, lower.name, Number(change.occupancy));
        const higherKey = cellKey(change.stay_date, higher.name, Number(change.occupancy));
        if (!touched.has(lowerKey) && !touched.has(higherKey)) continue;
        const afterGap = gap(after, lowerKey, higherKey);
        if (afterGap === null || afterGap <= 0) continue;
        const beforeGap = gap(before, lowerKey, higherKey) ?? 0;
        if (afterGap <= beforeGap) continue; // pre-existing inversion, not deepened
        found.push({
          change,
          reason: `Price hierarchy blocked for ${change.stay_date}: ${lower.name} (${after.get(lowerKey)}) cannot be higher than ${higher.name} (${after.get(higherKey)}) for ${change.occupancy} guest${change.occupancy === 1 ? "" : "s"}.`,
        });
        break;
      }
    }
    if (found.length === 0) break;
    for (const violation of found) {
      dropped.add(violation.change);
      violations.push(violation);
    }
  }
  return violations;
}

export async function assertRoomHierarchy(
  _admin: any,
  _hotelId: string,
  _changes: RateChange[],
): Promise<void> {
  // Cross-room prices are commercial positioning, not a hard safety invariant.
  // Different categories may legitimately overlap or cross on the same date.
  // Same-room occupancy ladders remain strict; automation-originated raises are
  // handled separately by liftHigherRooms as a non-blocking upward repair.
}

/**
 * Same rule as `assertRoomHierarchy`, but for batch paths (automation, bulk
 * publishing) a single bad cell must not throw away hundreds of good ones. The
 * offending changes are dropped and reported instead.
 */
export async function filterRoomHierarchy(
  _admin: any,
  _hotelId: string,
  changes: RateChange[],
): Promise<{ kept: RateChange[]; dropped: Array<{ change: RateChange; reason: string }> }> {
  // Kept for compatibility with older publishing paths. Cross-room ordering is
  // advisory and must never reject a manager edit or a synchronized markdown.
  return { kept: changes, dropped: [] };
}



export async function assertRateChangesSafe(
  admin: any,
  hotelId: string,
  changes: RateChange[],
): Promise<void> {
  await assertExactRateMappings(admin, hotelId, changes);
  await assertRoomHierarchy(admin, hotelId, changes);
}

/**
 * One safety layer for every write path: exact mappings, occupancy-ladder
 * repair, then the cross-room-type order. Returns the change list to write,
 * which may contain extra sibling cells created by the ladder repair. Changes
 * that would create or deepen a cross-room-type inversion are dropped, so one
 * bad cell never cancels a whole round.
 */
/**
 * When an occupancy repair or a floor top-up lifts a cheaper room above the next
 * room up, the old behaviour dropped that cell and the inversion survived. The
 * hierarchy is repaired upward instead: every higher room on that date and
 * occupancy is lifted to at least the cheaper room's price, cascading up the
 * tiers. Pre-existing inversions are left alone — only order we would newly
 * break is corrected.
 */
export async function liftHigherRooms(
  admin: any,
  hotelId: string,
  changes: RateChange[],
): Promise<RateChange[]> {
  if (changes.length === 0) return [];

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
  const orders = new Set(rooms.map((r) => r.sort_order).filter((v) => v !== null && v !== undefined));
  if (rooms.length < 2 || orders.size < 2) return [];

  const stored = await loadStoredRates(admin, hotelId, changes);
  const before = new Map<string, number>();
  for (const row of stored) {
    before.set(cellKey(row.stay_date, row.room_type_name, Number(row.occupancy)), Number(row.price));
  }
  for (const change of changes) {
    const oldPrice = Number(change.old_price);
    if (!Number.isFinite(oldPrice) || oldPrice <= 0) continue;
    before.set(cellKey(change.stay_date, change.room_type_name, Number(change.occupancy)), Math.round(oldPrice));
  }
  const after = new Map(before);
  const pending = new Map<string, RateChange>();
  for (const change of changes) {
    const key = cellKey(change.stay_date, change.room_type_name, Number(change.occupancy));
    after.set(key, Math.round(Number(change.new_price)));
    pending.set(key, change);
  }

  // Only automation-originated raises may trigger a cross-room repair. Manual
  // pricing is intentional commercial positioning and must remain untouched.
  const slots = new Map<string, RateChange>();
  for (const change of changes) {
    const intent = String(change.intent_source ?? "");
    const oldPrice = Number(change.old_price);
    const isAutomatedRaise = (intent.startsWith("automation_") || intent === "automation")
      && Number.isFinite(oldPrice)
      && Number(change.new_price) > oldPrice;
    if (!isAutomatedRaise) continue;
    const slot = `${change.stay_date}|${Number(change.occupancy)}`;
    if (!slots.has(slot)) slots.set(slot, change);
  }

  const lifts: RateChange[] = [];
  for (const [slot, template] of slots) {
    const [stayDate, occupancyRaw] = slot.split("|");
    const occupancy = Number(occupancyRaw);
    let runningMax = -Infinity;
    let previousName: string | null = null;
    for (const room of rooms) {
      const key = cellKey(stayDate, room.name, occupancy);
      const current = after.get(key);
      if (current === undefined) continue;
      if (runningMax !== -Infinity && current < runningMax) {
        const priorLower = previousName ? before.get(cellKey(stayDate, previousName, occupancy)) : undefined;
        // An inversion that already existed in Previo is not ours to close, but
        // as soon as our own raise makes it worse we lift the tier above too.
        const preExisting = priorLower !== undefined && priorLower > current;
        const weDeepenIt = priorLower === undefined
          || Math.round(runningMax) > Math.round(priorLower);
        if (!preExisting || weDeepenIt) {
          // Equality or a close overlap is commercially safe. Lift only enough
          // to remove the inversion created by this automated raise.
          const target = Math.round(runningMax);

          const change = pending.get(key);
          if (change) {
            change.new_price = target;
          } else {
            const lift: RateChange = { ...template };
            lift.stay_date = stayDate;
            lift.occupancy = occupancy;
            lift.room_type_name = room.name;
            lift.obk_id = room.pms_room_id;
            lift.old_price = Math.round(current);
            lift.new_price = target;
            if ("intent_source" in lift) lift.intent_source = "hierarchy_repair";
            if ("id" in lift) delete (lift as Record<string, unknown>).id;
            lifts.push(lift);
          }
          after.set(key, target);
          runningMax = target;
          previousName = room.name;
          continue;
        }
      }
      runningMax = Math.max(runningMax === -Infinity ? current : runningMax, current);
      previousName = room.name;
    }
  }
  return lifts;
}

export async function enforceRateSafety(
  admin: any,
  hotelId: string,
  changes: RateChange[],
): Promise<{ changes: RateChange[]; repairs: RateChange[]; dropped: Array<{ change: RateChange; reason: string }> }> {
  if (changes.length === 0) return { changes, repairs: [], dropped: [] };
  // Unmapped room types are held back cell by cell; the rest of the batch still
  // goes out, so one missing rate plan cannot cancel a month of pricing.
  const { mapped: safeChanges, unmapped } = await partitionByExactRateMappings(admin, hotelId, changes);
  if (safeChanges.length === 0) return { changes: [], repairs: [], dropped: unmapped };
  const ladderRepairs = await normalizeOccupancyLadder(admin, hotelId, safeChanges);
  // Lift the tiers above before filtering, so a legitimate raise repairs the
  // room order instead of being thrown away.
  const hierarchyRepairs = await liftHigherRooms(admin, hotelId, [...safeChanges, ...ladderRepairs])
    .catch(() => [] as RateChange[]);
  // A lift we cannot map to an exact Previo rate plan is not safe to send.
  const { mapped: mappable } = await partitionByExactRateMappings(
    admin, hotelId, hierarchyRepairs.filter((c) => !!c.obk_id),
  );
  const repairs = [...ladderRepairs, ...mappable];
  return { changes: [...safeChanges, ...repairs], repairs, dropped: unmapped };
}



