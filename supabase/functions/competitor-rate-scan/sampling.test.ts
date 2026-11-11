import { assert, assertEquals } from "jsr:@std/assert@1";
import { prioritySampleDates } from "./sampling.ts";

Deno.test("scheduled competitor sample covers 60 priority dates across 120 days", () => {
  const start = new Date("2026-11-11T00:00:00Z");
  const dates = prioritySampleDates(start);

  assertEquals(dates.length, 60);
  assertEquals(dates[0], "2026-11-11");
  assert(dates.every((date, i) => i === 0 || dates[i - 1] < date));
  assert(dates.every((date) => date >= "2026-11-11" && date <= "2027-03-10"));

  for (let i = 0; i < 14; i += 1) {
    assert(dates.includes(new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10)));
  }
  for (let day = 1; day <= 31; day += 1) {
    assert(dates.includes(`2027-01-${String(day).padStart(2, "0")}`));
  }

  assert(dates.some((date) => date.startsWith("2026-12-")));
  assert(dates.some((date) => date.startsWith("2027-02-")));
  assert(dates.some((date) => date.startsWith("2027-03-")));
});

Deno.test("scheduled competitor sample stays bounded for short horizons", () => {
  const dates = prioritySampleDates(new Date("2026-11-11T00:00:00Z"), 10, 60);
  assertEquals(dates.length, 10);
  assertEquals(dates[0], "2026-11-11");
  assertEquals(dates[9], "2026-11-20");
});
