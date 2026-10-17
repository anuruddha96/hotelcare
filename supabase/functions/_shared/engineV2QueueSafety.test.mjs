import test from "node:test";
import assert from "node:assert/strict";
import {
  publishableEngineV2Intents, incompleteInsertDates,
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
