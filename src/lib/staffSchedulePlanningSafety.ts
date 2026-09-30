export type StaffScheduleLifecycleStatus = "draft" | "published";

export interface HousekeepingScheduleCandidate {
  scheduleStatus: StaffScheduleLifecycleStatus | string | null | undefined;
  department: string | null | undefined;
  workStatus?: string | null;
  shiftStart?: string | null;
  shiftEnd?: string | null;
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
    | "invalid_shift_window"
    | "manual_assignment_preserved"
    | "started_assignment_preserved"
    | "completed_assignment_preserved";
}

/**
 * Safety gate for later automatic housekeeping planning.
 *
 * Master Staff Schedule remains the source of truth for who is working. Only
 * published housekeeping schedules with an explicit working state and usable
 * shift window may feed automatic planning. Existing room work always wins:
 * manual edits and started/completed assignments must never be overwritten by
 * schedule-driven automation.
 */
const isValidShiftTime = (value: string | null | undefined): boolean => {
  if (!value) return false;
  const match = value.trim().match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
};

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
  // become eligible for future automatic room assignment.
  if ((candidate.workStatus ?? "").trim().toLowerCase() !== "working") {
    return { eligible: false, reason: "not_working" };
  }

  if (!candidate.userId || !candidate.hotelId || !candidate.scheduleDate) {
    return { eligible: false, reason: "missing_identity" };
  }

  // Equal start/end is rejected, while overnight shifts remain valid.
  if (
    !isValidShiftTime(candidate.shiftStart) ||
    !isValidShiftTime(candidate.shiftEnd) ||
    candidate.shiftStart?.slice(0, 5) === candidate.shiftEnd?.slice(0, 5)
  ) {
    return { eligible: false, reason: "invalid_shift_window" };
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
