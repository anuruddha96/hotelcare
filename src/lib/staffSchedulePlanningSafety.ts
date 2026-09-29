export type StaffScheduleLifecycleStatus = "draft" | "published";

export interface HousekeepingScheduleCandidate {
  scheduleStatus: StaffScheduleLifecycleStatus | string | null | undefined;
  department: string | null | undefined;
  workStatus?: string | null;
  scheduleDate: string;
  userId: string;
  hotelId: string;
  workingVenueIds?: string[] | null;
}

export interface ExistingRoomAssignmentState {
  manuallyChanged?: boolean;
  started?: boolean;
  completed?: boolean;
}

export interface HousekeepingPlanningEligibility {
  eligible: boolean;
  reason:
    | "eligible"
    | "schedule_not_published"
    | "not_housekeeping"
    | "not_working"
    | "missing_identity"
    | "manual_assignment_preserved"
    | "started_assignment_preserved"
    | "completed_assignment_preserved";
}

/**
 * Safety gate for later automatic housekeeping planning.
 *
 * Master Staff Schedule remains the source of truth for who is working. Only
 * published housekeeping schedules with an explicit working state may feed
 * automatic planning. Existing room work always wins: manual edits and
 * started/completed assignments must never be overwritten by schedule-driven
 * automation.
 */
export function getHousekeepingPlanningEligibility(
  candidate: HousekeepingScheduleCandidate,
  existingAssignment?: ExistingRoomAssignmentState | null,
): HousekeepingPlanningEligibility {
  if (candidate.scheduleStatus !== "published") {
    return { eligible: false, reason: "schedule_not_published" };
  }

  if ((candidate.department ?? "").trim().toLowerCase() !== "housekeeping") {
    return { eligible: false, reason: "not_housekeeping" };
  }

  // Fail closed. Legacy/malformed records without work_status must not silently
  // become eligible for future automatic room assignment. The schedule writer
  // should explicitly persist "working" before automation can consume it.
  if ((candidate.workStatus ?? "").trim().toLowerCase() !== "working") {
    return { eligible: false, reason: "not_working" };
  }

  if (!candidate.userId || !candidate.hotelId || !candidate.scheduleDate) {
    return { eligible: false, reason: "missing_identity" };
  }

  if (existingAssignment?.completed) {
    return { eligible: false, reason: "completed_assignment_preserved" };
  }

  if (existingAssignment?.started) {
    return { eligible: false, reason: "started_assignment_preserved" };
  }

  if (existingAssignment?.manuallyChanged) {
    return { eligible: false, reason: "manual_assignment_preserved" };
  }

  return { eligible: true, reason: "eligible" };
}

/**
 * Returns the venues a housekeeping planner may consider for this shift.
 * The base hotel is always included, while cross-property working venues are
 * de-duplicated. This keeps venue expansion explicit instead of silently
 * changing the employee's home property.
 */
export function getPlanningVenueIds(candidate: HousekeepingScheduleCandidate): string[] {
  return Array.from(
    new Set([candidate.hotelId, ...(candidate.workingVenueIds ?? [])].filter(Boolean)),
  );
}
