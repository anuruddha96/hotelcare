import { describe, expect, it } from "vitest";
import {
  getHousekeepingPlanningEligibility,
  getPlanningVenueIds,
  type HousekeepingScheduleCandidate,
} from "./staffSchedulePlanningSafety";

const publishedHousekeeping: HousekeepingScheduleCandidate = {
  scheduleStatus: "published",
  department: "Housekeeping",
  scheduleDate: "2026-09-30",
  userId: "staff-1",
  hotelId: "hotel-a",
  workingVenueIds: ["hotel-b", "hotel-a", "hotel-c"],
};

describe("staff schedule planning safety", () => {
  it("allows a published housekeeping schedule with no protected room work", () => {
    expect(getHousekeepingPlanningEligibility(publishedHousekeeping)).toEqual({
      eligible: true,
      reason: "eligible",
    });
  });

  it("does not let draft schedules drive automatic planning", () => {
    expect(
      getHousekeepingPlanningEligibility({
        ...publishedHousekeeping,
        scheduleStatus: "draft",
      }),
    ).toEqual({ eligible: false, reason: "schedule_not_published" });
  });

  it("does not let non-housekeeping schedules drive housekeeping planning", () => {
    expect(
      getHousekeepingPlanningEligibility({
        ...publishedHousekeeping,
        department: "Reception",
      }),
    ).toEqual({ eligible: false, reason: "not_housekeeping" });
  });

  it("preserves manually changed room assignments", () => {
    expect(
      getHousekeepingPlanningEligibility(publishedHousekeeping, {
        manuallyChanged: true,
      }),
    ).toEqual({ eligible: false, reason: "manual_assignment_preserved" });
  });

  it("preserves started room assignments even if they were also manually changed", () => {
    expect(
      getHousekeepingPlanningEligibility(publishedHousekeeping, {
        manuallyChanged: true,
        started: true,
      }),
    ).toEqual({ eligible: false, reason: "started_assignment_preserved" });
  });

  it("preserves completed room assignments", () => {
    expect(
      getHousekeepingPlanningEligibility(publishedHousekeeping, {
        completed: true,
      }),
    ).toEqual({ eligible: false, reason: "completed_assignment_preserved" });
  });

  it("keeps the base property and de-duplicates cross-property working venues", () => {
    expect(getPlanningVenueIds(publishedHousekeeping)).toEqual([
      "hotel-a",
      "hotel-b",
      "hotel-c",
    ]);
  });
});
