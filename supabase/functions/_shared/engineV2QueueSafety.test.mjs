import test from "node:test";
import assert from "node:assert/strict";
import {
  publishableEngineV2Intents, incompleteInsertDates, validEngineV2DateMovement,
} from "./engineV2QueueSafety.ts";
const date = (stay_date, source = "automation_markdown") =>
  Array.from({ length: 13 }, (_, i) => ({
    stay_date, room_type_name: `room-${Math.floor(i / 3)}`,
    occupancy: i % 3 + 1, intent_source: source,
  }));
test("regression: 252 requests with DB-prohibited repairs become 13 valid price cells", () => {
  const valid = date("2027-01-08");
  const repairs = Array.from({length:239}, (_,i)=> ({
    stay_date: "2027-02-01", room_type_name:`other-${i}`, occupancy:1,
    intent_source:"ladder_repair",
  }));
  const selected = publishableEngineV2Intents([...valid,...repairs]);
  assert.deepEqual(selected, valid);
  assert.deepEqual([...incompleteInsertDates(selected, valid)], []);
});
test("a date-only ladder repair never creates a push run", () => {
  assert.deepEqual(publishableEngineV2Intents(date("2026-10-24", "ladder_repair")),[]);
});
test("trigger-suppressed child holds its entire date without affecting a complete neighboring date", () => {
  const a=date("2026-10-23"), b=date("2026-10-24");
  const missing=incompleteInsertDates([...a,...b], [...a.slice(1),...b]);
  assert.deepEqual([...missing],["2026-10-23"]);
});
test("trigger-suppressed all rows are treated as missing and never queued", () => {
  assert.deepEqual([...incompleteInsertDates(date("2026-11-16"), [])], ["2026-11-16"]);
});
test("unexpected duplicate return does not authorize an absent cell", () => {
  const a=date("2026-11-15");
  const incomplete=[a[0],a[0],...a.slice(2)];
  assert.deepEqual([...incompleteInsertDates(a,incomplete)],["2026-11-15"]);
});
test("approved manual edits are outside the V2-only filter and remain unchanged", () => {
  const manual = date("2026-11-06","manual");
  assert.deepEqual(publishableEngineV2Intents(manual),manual);
});

test("Ottofiori 31 October: a 13-cell €3 whole-date uplift is valid", () => {
  const cells = Array.from({ length: 13 }, (_, i) => ({
    stay_date: "2026-10-31", obk_id: String(9000 + Math.floor(i / 3)),
    room_type_name: "room-" + Math.floor(i / 3),
    occupancy: i % 3 + 1, old_price: 130 + i * 5, new_price: 133 + i * 5,
  }));
  assert.equal(validEngineV2DateMovement(cells, { movement: 3, expected_cells: 13 }), true);
  // Reproduce the live incident: a room-hierarchy safety pass lifted one
  // occupancy price by an extra €4, invalidating all 13 Previo writes.
  const rewritten = cells.map(cell => ({ ...cell }));
  rewritten[0].new_price += 4;
  assert.equal(validEngineV2DateMovement(rewritten, { movement: 3, expected_cells: 13 }), false);
  assert.equal(validEngineV2DateMovement(cells.slice(1), { movement: 3, expected_cells: 13 }), false);
  const duplicate = cells.map(cell => ({ ...cell }));
  duplicate[1] = { ...duplicate[0] };
  assert.equal(validEngineV2DateMovement(duplicate, { movement: 3, expected_cells: 13 }), false);
});
test("V2 rejects a fractional or opposite-direction child before queueing", () => {
  const cells = [{ stay_date: "2026-11-01", obk_id: "976815", room_type_name: "Queen",
    occupancy: 2, old_price: 145, new_price: 148 }];
  assert.equal(validEngineV2DateMovement(cells, { movement: -3, expected_cells: 1 }), false);
  assert.equal(validEngineV2DateMovement([{...cells[0],new_price:148.5}], { movement: 3, expected_cells: 1 }), false);
});
