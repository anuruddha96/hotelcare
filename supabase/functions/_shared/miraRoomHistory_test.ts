import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { budapestTime, clampRange, describeAssignment, peopleIds } from "./miraRoomHistory.ts";

// Room 038, Hotel Memories Budapest, Monday 16 November 2026, as stored.
const ROW = {
  assignment_date: "2026-11-16",
  assignment_type: "daily_cleaning",
  status: "completed",
  assigned_to: "sofia",
  assigned_by: "eszter",
  started_at: "2026-11-16T09:15:36.037Z",
  completed_at: "2026-11-16T09:47:48.803Z",
  supervisor_approved: true,
  supervisor_approved_by: "bea",
  supervisor_approved_at: "2026-11-16T09:58:49.639Z",
  supervisor_review_outcome: null,
  supervisor_reviewed_by: null,
  supervisor_reviewed_at: null,
  is_dnd: false,
  total_break_time_minutes: 0,
};
const PEOPLE = new Map<string, any>([
  ["sofia", { full_name: "Sofia", nickname: "Sofia_101", role: "housekeeping" }],
  ["eszter", { full_name: "Eszter Kovács", nickname: "Eszter_0005", role: "manager", access_role: "housekeeping_manager" }],
  ["bea", { full_name: "Bea", nickname: "Bea_007", role: "manager", access_role: "housekeeping_supervisor" }],
]);

Deno.test("the approver is Bea, not the manager who assigned the room", () => {
  const view = describeAssignment(ROW, PEOPLE);
  assertEquals(view.cleanedBy, { name: "Sofia", role: "Housekeeper" });
  assertEquals(view.assignedBy, { name: "Eszter Kovács", role: "Housekeeping manager" });
  assertEquals(view.approvedBy, { name: "Bea", role: "Housekeeping supervisor" });
  assertEquals(view.approved, true);
  assertEquals(view.approvedAt, "10:58");
  assertEquals(view.startedAt, "10:15");
  assertEquals(view.completedAt, "10:47");
  assertEquals(view.durationMinutes, 32);
  assertEquals(view.inspection, null);
});

Deno.test("an unapproved room has no approver, even when someone assigned it", () => {
  const view = describeAssignment({ ...ROW, supervisor_approved: false, supervisor_approved_by: null, supervisor_approved_at: null }, PEOPLE);
  assertEquals(view.approvedBy, null);
  assertEquals(view.assignedBy?.name, "Eszter Kovács");
});

Deno.test("breaks are taken off the cleaning time", () => {
  assertEquals(describeAssignment({ ...ROW, total_break_time_minutes: 10 }, PEOPLE).durationMinutes, 22);
});

Deno.test("every person on an assignment is looked up once", () => {
  assertEquals(peopleIds([ROW, { ...ROW, dnd_marked_by: "sofia" }]).sort(), ["bea", "eszter", "sofia"]);
});

Deno.test("Budapest times follow summer and winter time", () => {
  assertEquals(budapestTime("2026-07-01T08:00:00Z"), "10:00");
  assertEquals(budapestTime("2026-12-01T08:00:00Z"), "09:00");
  assertEquals(budapestTime(null), null);
});

Deno.test("history ranges are limited to a month, keeping the newest days", () => {
  assertEquals(clampRange("2026-01-01", "2026-11-16"), { from: "2026-10-17", to: "2026-11-16", clamped: true });
  assertEquals(clampRange("2026-11-16", "2026-11-09"), { from: "2026-11-09", to: "2026-11-16", clamped: false });
});
