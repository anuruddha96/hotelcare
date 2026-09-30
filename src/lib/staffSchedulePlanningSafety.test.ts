import { describe, expect, it } from "vitest";
import {
  getHousekeepingPlanningEligibility,
  getPlanningVenueIds,
  type HousekeepingScheduleCandidate,
} from "./staffSchedulePlanningSafety";

const publishedHousekeeping: HousekeepingScheduleCandidate = {
  scheduleStatus: "published",
  department: "Housekeeping",
  workStatus: "working",
  shiftStart: "09:00",
  shiftEnd: "17:00",
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

  it("requires an explicit working state before automatic planning", () => {
    for (const workStatus of [undefined, null, "", "off", "leave", "sick", "training"]) {
      expect(
        getHousekeepingPlanningEligibility({
          ...publishedHousekeeping,
          workStatus,
        }),
      ).toEqual({ eligible: false, reason: "not_working" });
    }
  });

  it("does not let non-housekeeping schedules drive housekeeping planning", () => {
    expect(
      getHousekeepingPlanningEligibility({
        ...publishedHousekeeping,
        department: "Reception",
      }),
    ).toEqual({ eligible: false, reason: "not_housekeeping" });
  });

  it("allows staff explicitly mapped to act as a housekeeper without changing their primary department", () => {
    expect(
      getHousekeepingPlanningEligibility({
        ...publishedHousekeeping,
        department: "Management",
        actsAsHousekeeper: true,
      }),
    ).toEqual({ eligible: true, reason: "eligible" });
  });

  it("does not treat an explicitly false mapping as housekeeping capability", () => {
    expect(
      getHousekeepingPlanningEligibility({
        ...publishedHousekeeping,
        department: "Management",
        actsAsHousekeeper: false,
      }),
    ).toEqual({ eligible: false, reason: "not_housekeeping" });
  });

  it("requires complete schedule identity", () => {
    for (const candidate of [
      { ...publishedHousekeeping, userId: "" },
      { ...publishedHousekeeping, hotelId: "" },
      { ...publishedHousekeeping, scheduleDate: "" },
    ]) {
      expect(getHousekeepingPlanningEligibility(candidate)).toEqual({
        eligible: false,
        reason: "missing_identity",
      });
    }
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

  it("drops empty venue identifiers from planning scope", () => {
    expect(
      getPlanningVenueIds({
        ...publishedHousekeeping,
        workingVenueIds: ["", "hotel-b", "hotel-b"],
      }),
    ).toEqual(["hotel-a", "hotel-b"]);
  });
});
