import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertRateChangesSafe,
  enforceRateSafety,
  repairLadder,
} from "./rateSafety.ts";

function query(data: unknown[]) {
  const chain: any = Promise.resolve({ data, error: null });
  for (const method of ["select", "eq", "gte", "lte", "order", "range"]) chain[method] = () => chain;
  return chain;
}

const mapping = (ids: string[]) =>
  ids.map((id) => ({ previo_room_type_id: id, previo_rate_plan_id: "rate" }));

Deno.test("rejects a missing exact Previo mapping", async () => {
  const admin = { from: (table: string) => query(table === "previo_rate_plan_mapping" ? [] : []) };
  await assertRejects(
    () => assertRateChangesSafe(admin, "ottofiori", [{
      stay_date: "2026-09-01", obk_id: "11", room_type_name: "Double", occupancy: 2, new_price: 120,
    }]),
    Error,
    "no exact Previo rate-plan mapping",
  );
});

Deno.test("allows a mapped non-hierarchy hotel", async () => {
  const admin = { from: () => query(mapping(["11"])) };
  await assertRateChangesSafe(admin, "ottofiori", [{
    stay_date: "2026-09-01", obk_id: "11", room_type_name: "Double", occupancy: 2, new_price: 120,
  }]);
  assertEquals(true, true);
});

Deno.test("blocks a new Studio over One-Bedroom inversion", async () => {
  const admin = {
    from: (table: string) => query(
      table === "previo_rate_plan_mapping"
        ? mapping(["studio", "one"])
        : table === "room_types"
          ? [
              { name: "Studio", pms_room_id: "studio", sort_order: 1, is_sellable: true, counts_toward_inventory: true },
              { name: "One-Bedroom", pms_room_id: "one", sort_order: 2, is_sellable: true, counts_toward_inventory: true },
            ]
          : [
              { stay_date: "2026-09-01", obk_id: "studio", room_type_name: "Studio", occupancy: 2, price: 100, updated_at: "2026-08-24" },
              { stay_date: "2026-09-01", obk_id: "one", room_type_name: "One-Bedroom", occupancy: 2, price: 120, updated_at: "2026-08-24" },
            ],
    ),
  };
  await assertRejects(
    () => assertRateChangesSafe(admin, "gozsdu-court", [{
      stay_date: "2026-09-01", obk_id: "studio", room_type_name: "Studio", occupancy: 2, new_price: 130,
    }]),
    Error,
    "Price hierarchy blocked",
  );
});

// --- occupancy ladder -------------------------------------------------------

Deno.test("repairLadder lifts a lower-priced higher occupancy", () => {
  const out = repairLadder([
    { occupancy: 1, price: 100 },
    { occupancy: 2, price: 407 },
    { occupancy: 3, price: 405 },
  ]);
  assertEquals(out.get(1), 100);
  assertEquals(out.get(2), 407);
  assertEquals(out.get(3), 407);
});

Deno.test("repairLadder keeps equal prices and never lowers a level", () => {
  const out = repairLadder([
    { occupancy: 1, price: 150 },
    { occupancy: 2, price: 150 },
    { occupancy: 3, price: 160 },
  ]);
  assertEquals([out.get(1), out.get(2), out.get(3)], [150, 150, 160]);
});

Deno.test("repairLadder handles gaps in the ladder", () => {
  const out = repairLadder([
    { occupancy: 1, price: 90 },
    { occupancy: 4, price: 80 },
  ]);
  assertEquals(out.get(1), 90);
  assertEquals(out.get(4), 90);
});

function ladderAdmin(stored: Array<Record<string, unknown>>, rooms: Array<Record<string, unknown>> = []) {
  return {
    from: (table: string) => query(
      table === "previo_rate_plan_mapping"
        ? mapping(["11"])
        : table === "room_types"
          ? rooms
          : stored,
    ),
  };
}

Deno.test("enforceRateSafety adds a sibling repair for the untouched level", async () => {
  const admin = ladderAdmin([
    { stay_date: "2026-09-12", obk_id: "11", room_type_name: "Quad", occupancy: 1, price: 394 },
    { stay_date: "2026-09-12", obk_id: "11", room_type_name: "Quad", occupancy: 2, price: 400 },
    { stay_date: "2026-09-12", obk_id: "11", room_type_name: "Quad", occupancy: 3, price: 405 },
  ]);
  const changes = [{
    stay_date: "2026-09-12", obk_id: "11", room_type_name: "Quad", occupancy: 2, new_price: 407,
    old_price: 400, intent_source: "manual",
  }];
  const safe = await enforceRateSafety(admin, "ottofiori", changes);
  assertEquals(safe.repairs.length, 1);
  assertEquals(safe.repairs[0].occupancy, 3);
  assertEquals(safe.repairs[0].new_price, 407);
  assertEquals(safe.repairs[0].old_price, 405);
  assertEquals(safe.repairs[0].intent_source, "ladder_repair");
  assertEquals(safe.changes.length, 2);
});

Deno.test("enforceRateSafety lifts an incoming change that lands under a lower level", async () => {
  const admin = ladderAdmin([
    { stay_date: "2026-09-12", obk_id: "11", room_type_name: "Quad", occupancy: 2, price: 200 },
    { stay_date: "2026-09-12", obk_id: "11", room_type_name: "Quad", occupancy: 3, price: 220 },
  ]);
  const changes = [{
    stay_date: "2026-09-12", obk_id: "11", room_type_name: "Quad", occupancy: 3, new_price: 180, old_price: 220,
  }];
  const safe = await enforceRateSafety(admin, "ottofiori", changes);
  assertEquals(safe.repairs.length, 0);
  assertEquals(safe.changes[0].new_price, 200); // lifted to the 2-guest level, floor-safe
});

Deno.test("enforceRateSafety leaves an already consistent ladder alone", async () => {
  const admin = ladderAdmin([
    { stay_date: "2026-09-12", obk_id: "11", room_type_name: "Quad", occupancy: 1, price: 100 },
    { stay_date: "2026-09-12", obk_id: "11", room_type_name: "Quad", occupancy: 2, price: 120 },
  ]);
  const safe = await enforceRateSafety(admin, "ottofiori", [{
    stay_date: "2026-09-12", obk_id: "11", room_type_name: "Quad", occupancy: 2, new_price: 130,
  }]);
  assertEquals(safe.repairs.length, 0);
  assertEquals(safe.changes.length, 1);
});

Deno.test("a pre-existing cross-room inversion is not blocked when it is not deepened", async () => {
  const admin = {
    from: (table: string) => query(
      table === "previo_rate_plan_mapping"
        ? mapping(["studio", "one"])
        : table === "room_types"
          ? [
              { name: "Studio", pms_room_id: "studio", sort_order: 1, is_sellable: true, counts_toward_inventory: true },
              { name: "One-Bedroom", pms_room_id: "one", sort_order: 2, is_sellable: true, counts_toward_inventory: true },
            ]
          : [
              { stay_date: "2026-09-01", obk_id: "studio", room_type_name: "Studio", occupancy: 2, price: 310 },
              { stay_date: "2026-09-01", obk_id: "one", room_type_name: "One-Bedroom", occupancy: 2, price: 239 },
            ],
    ),
  };
  // Moving the Studio DOWN reduces the existing gap, so it must be allowed.
  const safe = await enforceRateSafety(admin, "gozsdu-court", [{
    stay_date: "2026-09-01", obk_id: "studio", room_type_name: "Studio", occupancy: 2, new_price: 280,
  }]);
  assertEquals(safe.changes.length, 1);
});
