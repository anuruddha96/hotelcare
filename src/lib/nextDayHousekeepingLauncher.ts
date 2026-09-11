export type NextDayHousekeepingPlanStatus =
  | 'draft'
  | 'approved'
  | 'releasing'
  | 'released'
  | 'cancelled'
  | 'failed';

export type DatedNextDayHousekeepingPlan = {
  plan_date: string;
  status: NextDayHousekeepingPlanStatus;
};

const CURRENT_DAY_REVIEW_STATUSES = new Set<NextDayHousekeepingPlanStatus>([
  'approved',
  'releasing',
  'released',
  'failed',
]);

/**
 * A plan prepared yesterday becomes today's operational plan after midnight.
 * Keep it independently reviewable through the day, including after release,
 * so managers can still see who was assigned which rooms/public areas.
 */
export function findCurrentDayHousekeepingReviewPlan<T extends DatedNextDayHousekeepingPlan>(
  rows: T[],
  today: string,
): T | null {
  return rows.find(
    row => row.plan_date === today && CURRENT_DAY_REVIEW_STATUSES.has(row.status),
  ) || null;
}

export function findTomorrowHousekeepingPlan<T extends DatedNextDayHousekeepingPlan>(
  rows: T[],
  tomorrow: string,
): T | null {
  return rows.find(row => row.plan_date === tomorrow) || null;
}

export function isCurrentDayHousekeepingReviewPlan(
  plan: DatedNextDayHousekeepingPlan | null,
  today: string,
): boolean {
  return !!plan
    && plan.plan_date === today
    && CURRENT_DAY_REVIEW_STATUSES.has(plan.status);
}

/**
 * Backwards-compatible aliases for older callers. The launcher itself now
 * renders today's review and tomorrow's planning as two independent cards.
 */
export const isCurrentDayHousekeepingCarryover = isCurrentDayHousekeepingReviewPlan;

export function pickHousekeepingLauncherPlan<T extends DatedNextDayHousekeepingPlan>(
  rows: T[],
  today: string,
  tomorrow: string,
  planningWindowOpen: boolean,
): T | null {
  const current = findCurrentDayHousekeepingReviewPlan(rows, today);
  if (!planningWindowOpen) return current;
  return findTomorrowHousekeepingPlan(rows, tomorrow) || current;
}
