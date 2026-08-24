import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertRateChangesSafe } from "./rateSafety.ts";

function query(data: unknown[]) {
  const chain: any = Promise.resolve({ data, error: null });
  for (const method of ["select", "eq", "gte", "lte", "order", "range"]) chain[method] = () => chain;
  return chain;
}

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
  const admin = { from: () => query([{ previo_room_type_id: "11", previo_rate_plan_id: "22" }]) };
  await assertRateChangesSafe(admin, "ottofiori", [{
    stay_date: "2026-09-01", obk_id: "11", room_type_name: "Double", occupancy: 2, new_price: 120,
  }]);
  assertEquals(true, true);
});

Deno.test("blocks a new Studio over One-Bedroom inversion", async () => {
  const admin = {
    from: (table: string) => query(
      table === "previo_rate_plan_mapping"
        ? [
            { previo_room_type_id: "studio", previo_rate_plan_id: "rate" },
            { previo_room_type_id: "one", previo_rate_plan_id: "rate" },
          ]
        : table === "room_types"
          ? [
              { name: "Studio", pms_room_id: "studio", sort_order: 1, is_sellable: true, counts_toward_inventory: true },
              { name: "One-Bedroom", pms_room_id: "one", sort_order: 2, is_sellable: true, counts_toward_inventory: true },
            ]
          : [
              { stay_date: "2026-09-01", room_type_name: "Studio", occupancy: 2, price: 100, updated_at: "2026-08-24" },
              { stay_date: "2026-09-01", room_type_name: "One-Bedroom", occupancy: 2, price: 120, updated_at: "2026-08-24" },
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