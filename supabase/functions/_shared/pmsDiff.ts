// Shared PMS diff engine.
//
// PURE + side-effect free. Compares a "previous" NormalizedSnapshot (what
// we last applied to housekeeping/room_assignments) with a "next"
// NormalizedSnapshot (freshly normalized from XLSX or Previo API) and
// classifies every per-room change as SAFE (auto-apply) or RISKY
// (requires manager approval).
//
// This module deliberately does NOT touch Supabase, does NOT log, and
// does NOT decide whether to actually mutate anything — it only produces
// a plan. The caller (E2 wiring) is responsible for:
//   1. Persisting `pms_change_events` rows for every non-noop change.
//   2. Calling `pms_apply_change()` (RPC) for each SAFE change.
//   3. Leaving RISKY changes pending until a manager acknowledges them
//      via PmsChangesDrawer.
//
// This is added standalone so it can be reviewed and unit-tested in
// isolation before any live pipeline consumes it.

import type { NormalizedRoom, NormalizedSnapshot, StayKind } from "./pmsNormalizer.ts";

// ---------- Types ---------------------------------------------------------

export type ChangeCategory = "safe" | "risky" | "noop";

export type ChangeKind =
  // safe
  | "new_arrival"
  | "guest_count_changed"
  | "notes_changed"
  | "dates_extended_same_stay"
  | "linen_towel_flags_changed"
  | "first_seen"
  // risky
  | "stay_kind_changed"          // checkout <-> daily <-> arrival transitions
  | "cancellation"               // was occupied, now vacant
  | "guest_swap"                 // different reservation id / arrival date
  | "guest_nights_reset"         // guest_nights_stayed went backwards
  | "room_removed";              // room disappeared from feed entirely

export interface RoomChange {
  previo_room_id: string | null;
  room_number: string;
  category: ChangeCategory;
  kind: ChangeKind | null;
  before: NormalizedRoom | null;
  after: NormalizedRoom | null;
  /** Short human summary for the drawer. */
  summary: string;
}

export interface DiffResult {
  hotel_id: string;
  business_date: string;
  safe: RoomChange[];
  risky: RoomChange[];
  noop_count: number;
  /** Every non-noop change, in room_number order — convenient for the drawer. */
  all_changes: RoomChange[];
}

// ---------- Public API ----------------------------------------------------

export function diffSnapshots(
  prev: NormalizedSnapshot | null,
  next: NormalizedSnapshot,
): DiffResult {
  const prevByRoom = new Map<string, NormalizedRoom>();
  if (prev) {
    for (const r of prev.rooms) {
      const k = keyOf(r);
      if (k) prevByRoom.set(k, r);
    }
  }

  const seenKeys = new Set<string>();
  const changes: RoomChange[] = [];

  for (const after of next.rooms) {
    const k = keyOf(after);
    if (!k) continue;
    seenKeys.add(k);
    const before = prevByRoom.get(k) ?? null;
    changes.push(classify(before, after));
  }

  // Rooms present previously but missing now — treat as risky "room_removed".
  if (prev) {
    for (const [k, before] of prevByRoom) {
      if (seenKeys.has(k)) continue;
      changes.push({
        previo_room_id: before.previo_room_id,
        room_number: before.room_number,
        category: "risky",
        kind: "room_removed",
        before,
        after: null,
        summary: `Room ${before.room_number} disappeared from PMS feed`,
      });
    }
  }

  const safe = changes.filter((c) => c.category === "safe");
  const risky = changes.filter((c) => c.category === "risky");
  const noop_count = changes.filter((c) => c.category === "noop").length;

  const all_changes = changes
    .filter((c) => c.category !== "noop")
    .sort((a, b) =>
      a.room_number.localeCompare(b.room_number, undefined, { numeric: true })
    );

  return {
    hotel_id: next.hotel_id,
    business_date: next.business_date,
    safe,
    risky,
    noop_count,
    all_changes,
  };
}

// ---------- Classification ------------------------------------------------

function classify(
  before: NormalizedRoom | null,
  after: NormalizedRoom,
): RoomChange {
  const base = {
    previo_room_id: after.previo_room_id,
    room_number: after.room_number,
    before,
    after,
  };

  if (!before) {
    // First time we've ever seen this room in a snapshot.
    // "arrival" / "checkout" / "daily" are all safe on first sight —
    // there's no existing assignment to preserve.
    return {
      ...base,
      category: "safe",
      kind: "first_seen",
      summary: `Room ${after.room_number} first seen as ${after.stay_kind}`,
    };
  }

  // Cancellation: was occupied, now vacant.
  const wasOccupied = isOccupied(before.stay_kind);
  const isNowVacant = after.stay_kind === "vacant" || after.stay_kind === "ooo";
  if (wasOccupied && isNowVacant) {
    return {
      ...base,
      category: "risky",
      kind: "cancellation",
      summary: `Room ${after.room_number}: reservation removed (was ${before.stay_kind})`,
    };
  }

  // Stay kind transitions between the three occupied kinds — risky.
  if (before.stay_kind !== after.stay_kind && wasOccupied && isOccupied(after.stay_kind)) {
    return {
      ...base,
      category: "risky",
      kind: "stay_kind_changed",
      summary:
        `Room ${after.room_number}: ${before.stay_kind} → ${after.stay_kind}`,
    };
  }

  // Guest swap heuristic: arrival_date changed while occupied.
  if (
    wasOccupied &&
    isOccupied(after.stay_kind) &&
    before.arrival_date &&
    after.arrival_date &&
    before.arrival_date !== after.arrival_date
  ) {
    return {
      ...base,
      category: "risky",
      kind: "guest_swap",
      summary:
        `Room ${after.room_number}: arrival date changed ${before.arrival_date} → ${after.arrival_date}`,
    };
  }

  // guest_nights_stayed went backwards — likely a new stay or PMS reset.
  if (
    before.guest_nights_stayed > 0 &&
    after.guest_nights_stayed < before.guest_nights_stayed
  ) {
    return {
      ...base,
      category: "risky",
      kind: "guest_nights_reset",
      summary:
        `Room ${after.room_number}: guest nights decreased ${before.guest_nights_stayed} → ${after.guest_nights_stayed}`,
    };
  }

  // Vacant → occupied: new arrival is safe.
  if (!wasOccupied && isOccupied(after.stay_kind)) {
    return {
      ...base,
      category: "safe",
      kind: "new_arrival",
      summary: `Room ${after.room_number}: new ${after.stay_kind}`,
    };
  }

  // Same stay, extended departure date — safe.
  if (
    before.arrival_date === after.arrival_date &&
    before.departure_date !== after.departure_date &&
    after.stay_kind === before.stay_kind
  ) {
    return {
      ...base,
      category: "safe",
      kind: "dates_extended_same_stay",
      summary:
        `Room ${after.room_number}: departure ${before.departure_date} → ${after.departure_date}`,
    };
  }

  if (before.guest_count !== after.guest_count) {
    return {
      ...base,
      category: "safe",
      kind: "guest_count_changed",
      summary:
        `Room ${after.room_number}: guests ${before.guest_count} → ${after.guest_count}`,
    };
  }

  if ((before.notes ?? "") !== (after.notes ?? "")) {
    return {
      ...base,
      category: "safe",
      kind: "notes_changed",
      summary: `Room ${after.room_number}: PMS notes updated`,
    };
  }

  if (
    before.linen_change_required !== after.linen_change_required ||
    before.towel_change_required !== after.towel_change_required
  ) {
    return {
      ...base,
      category: "safe",
      kind: "linen_towel_flags_changed",
      summary: `Room ${after.room_number}: linen/towel flags updated`,
    };
  }

  return {
    ...base,
    category: "noop",
    kind: null,
    summary: `Room ${after.room_number}: no change`,
  };
}

function isOccupied(k: StayKind): boolean {
  return k === "checkout" || k === "daily" || k === "arrival";
}

function keyOf(r: NormalizedRoom): string | null {
  if (r.previo_room_id) return `id:${r.previo_room_id}`;
  if (r.room_number) return `num:${r.room_number}`;
  return null;
}
