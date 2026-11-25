import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  addDays, budapestDate, budapestMidnightUtc, buildDateContext, dateContextPrompt, nextWeekday, previousWeekday, weekStart,
  weekdayName,
} from "./miraDates.ts";

// Thursday 19 November 2026, 14:05 in Budapest (13:05 UTC, winter time).
const NOW = new Date("2026-11-19T13:05:00Z");

Deno.test("a past 'Monday' asked on Thursday 19 November is 16 November, not the 13th", () => {
  const ctx = buildDateContext(NOW);
  assertEquals(ctx.today, "2026-11-19");
  assertEquals(ctx.weekday, "Thursday");
  const monday = ctx.weekdays.find((w) => w.weekday === "Monday")!;
  assertEquals(monday.past, "2026-11-16");
  assertEquals(monday.next, "2026-11-23");
  assertEquals(weekdayName(monday.past), "Monday");
});

Deno.test("the weekday of today maps to last week for the past and next week for the future", () => {
  const ctx = buildDateContext(NOW);
  const thursday = ctx.weekdays.find((w) => w.weekday === "Thursday")!;
  assertEquals(thursday.past, "2026-11-12");
  assertEquals(thursday.next, "2026-11-26");
});

Deno.test("weeks start on Monday and months have the right last day", () => {
  const ctx = buildDateContext(NOW);
  assertEquals(ctx.thisWeek, { from: "2026-11-16", to: "2026-11-22" });
  assertEquals(ctx.lastWeek, { from: "2026-11-09", to: "2026-11-15" });
  assertEquals(ctx.thisMonth, { from: "2026-11-01", to: "2026-11-30" });
  assertEquals(ctx.lastMonth, { from: "2026-10-01", to: "2026-10-31" });
  assertEquals(buildDateContext(new Date("2027-03-03T10:00:00Z")).lastMonth, { from: "2027-02-01", to: "2027-02-28" });
  assertEquals(weekStart("2026-11-22"), "2026-11-16");
});

Deno.test("weekends: on a Sunday this weekend is the one in progress", () => {
  const sunday = buildDateContext(new Date("2026-11-22T09:00:00Z"));
  assertEquals(sunday.thisWeekend, { from: "2026-11-21", to: "2026-11-22" });
  assertEquals(sunday.lastWeekend, { from: "2026-11-14", to: "2026-11-15" });
  const thursday = buildDateContext(NOW);
  assertEquals(thursday.thisWeekend, { from: "2026-11-21", to: "2026-11-22" });
});

Deno.test("the Budapest date changes at local midnight, not UTC midnight", () => {
  // 23:30 UTC on 19 Nov is already 00:30 on 20 Nov in Budapest.
  assertEquals(budapestDate(new Date("2026-11-19T23:30:00Z")), "2026-11-20");
  // Summer time: 22:30 UTC on 30 Jun is 00:30 on 1 Jul.
  assertEquals(budapestDate(new Date("2026-06-30T22:30:00Z")), "2026-07-01");
});

Deno.test("calendar arithmetic crosses months, years and daylight-saving days", () => {
  assertEquals(addDays("2026-10-25", 1), "2026-10-26");
  assertEquals(addDays("2026-12-31", 1), "2027-01-01");
  assertEquals(addDays("2026-03-01", -1), "2026-02-28");
  assertEquals(previousWeekday("2026-11-16", 1), "2026-11-09");
  assertEquals(nextWeekday("2026-11-16", 1), "2026-11-23");
});

Deno.test("a Budapest day starts at 23:00 UTC in winter and 22:00 UTC in summer", () => {
  assertEquals(budapestMidnightUtc("2026-11-19").toISOString(), "2026-11-18T23:00:00.000Z");
  assertEquals(budapestMidnightUtc("2026-07-01").toISOString(), "2026-06-30T22:00:00.000Z");
  // The day clocks go back (25 Oct 2026) still starts at summer-time midnight.
  assertEquals(budapestMidnightUtc("2026-10-25").toISOString(), "2026-10-24T22:00:00.000Z");
});

Deno.test("the prompt block spells out the dates the model must use", () => {
  const text = dateContextPrompt(buildDateContext(NOW));
  assertMatch(text, /Today is Thursday 2026-11-19, 14:05/);
  assertMatch(text, /Mon: past 2026-11-16, next 2026-11-23/);
  assertMatch(text, /PAST date/);
});
