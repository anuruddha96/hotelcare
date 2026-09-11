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

const CURRENT_DAY_CARRYOVER_STATUSES = new Set<NextDayHousekeepingPlanStatus>([
  'draft',
  'approved',
  'releasing',
  'failed',
]);

/**
 * The afternoon launcher normally represents tomorrow's plan. After midnight,
 * however, an unfinished plan prepared yesterday now belongs to today and must
 * stay visible until it either releases or is cancelled. This keeps managers
 * from losing access to the release-time/status controls during the critical
 * pre-release morning window.
 */
export function pickHousekeepingLauncherPlan<T extends DatedNextDayHousekeepingPlan>(
  rows: T[],
  today: string,
  tomorrow: string,
  planningWindowOpen: boolean,
): T | null {
  const todayCarryover = rows.find(
    row => row.plan_date === today && CURRENT_DAY_CARRYOVER_STATUSES.has(row.status),
  );
  if (todayCarryover) return todayCarryover;

  if (!planningWindowOpen) return null;
  return rows.find(row => row.plan_date === tomorrow) || null;
}

export function isCurrentDayHousekeepingCarryover(
  plan: DatedNextDayHousekeepingPlan | null,
  today: string,
): boolean {
  return !!plan
    && plan.plan_date === today
    && CURRENT_DAY_CARRYOVER_STATUSES.has(plan.status);
}
