import { assertEquals, assertMatch, assertNotMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { aggregateUsage, needsALook, reportEmail } from "./miraUsageReport.ts";

const WINDOW = {
  dayStart: "2026-11-18T23:00:00.000Z", // Thursday 19 Nov in Budapest
  dayEnd: "2026-11-19T23:00:00.000Z",
  weekStart: "2026-11-12T23:00:00.000Z",
  monthStart: "2026-10-31T23:00:00.000Z",
};
const people = new Map([
  ["a", { id: "a", full_name: "Petra", role: "manager" }],
  ["b", { id: "b", full_name: "Rita", role: "reception" }],
]);
const describe = (p: any) => ({ role: p?.role === "manager" ? "Manager" : "Reception", tier: p?.role === "manager" ? "Unlimited" : "Standard" });

Deno.test("messages are counted per person for yesterday, the week and the month", () => {
  const rows = aggregateUsage({
    usage: [
      { user_id: "a", created_at: "2026-11-19T08:00:00Z", estimated_cost_usd: 0.02 },
      { user_id: "a", created_at: "2026-11-19T09:00:00Z", estimated_cost_usd: "0.03" },
      { user_id: "a", created_at: "2026-11-14T09:00:00Z", estimated_cost_usd: 0.01 },
      { user_id: "b", created_at: "2026-11-03T09:00:00Z", estimated_cost_usd: 0.01 },
      // Today (after the window) is not counted yet.
      { user_id: "b", created_at: "2026-11-19T23:30:00Z" },
    ],
    refusals: [{ user_id: "b", created_at: "2026-11-19T10:00:00Z" }, { user_id: "b", created_at: "2026-11-19T10:05:00Z" }],
    alerts: [{ user_id: "a", alert_type: "heavy_use", created_at: "2026-11-19T11:00:00Z" }],
    people, window: WINDOW, describe,
  });
  assertEquals(rows.map((r) => [r.name, r.yesterday, r.week, r.month]), [["Petra", 2, 3, 3], ["Rita", 0, 0, 1]]);
  assertEquals(Math.round(rows[0].costMonthUsd * 100), 6);
  assertEquals(rows[0].alerts, ["heavy use"]);
  assertEquals(rows[1].declinedYesterday, 2);
  assertEquals(needsALook(rows[0]), true);
  assertEquals(needsALook(rows[1]), true);
});

Deno.test("the e-mail lists everyone, flags what needs a look and never shows questions", () => {
  const rows = aggregateUsage({
    usage: [{ user_id: "a", created_at: "2026-11-19T08:00:00Z", estimated_cost_usd: 0.5 }],
    refusals: [], alerts: [], people, window: WINDOW, describe,
  });
  const mail = reportEmail({ organization: "rdhotels", day: "2026-11-19", rows });
  assertEquals(mail.subject, "HotelCare · Mira usage 2026-11-19: 1 message from 1 person");
  assertMatch(mail.html, /Petra/);
  assertMatch(mail.html, /Nothing unusual yesterday/);
  assertNotMatch(mail.html, /question:/i);
});
