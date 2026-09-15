export interface DailyRevenueSalesGoals {
  targetAdr: number;
  targetRoomNights: number;
  targetValue: number;
  promoBudget: number;
}

export interface PeriodRevenueSalesGoals {
  days: number;
  targetAdr: number;
  targetRoomNights: number;
  targetValue: number;
  promoBudget: number | null;
  targetValueIsDerived: boolean;
}

const DAY_MS = 86_400_000;

/** Inclusive UTC calendar-day count for YYYY-MM-DD ranges. Invalid/reversed ranges fall back to 1 day. */
export function inclusiveCalendarDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.max(1, Math.round((end - start) / DAY_MS) + 1);
}

/**
 * Stored goals are DAILY production goals. A selected multi-day booking-created
 * range must compare its production with the equivalent multi-day target.
 * ADR is a rate, so it never scales with the number of days.
 * Booking value can be configured explicitly; when it is 0/unset we derive it
 * from ADR × room-night target so the revenue goal stays internally consistent.
 */
export function buildPeriodRevenueSalesGoals(
  goals: DailyRevenueSalesGoals,
  from: string,
  to: string,
): PeriodRevenueSalesGoals {
  const days = inclusiveCalendarDays(from, to);
  const dailyRoomNights = Math.max(0, Number(goals.targetRoomNights) || 0);
  const targetAdr = Math.max(0, Number(goals.targetAdr) || 0);
  const configuredDailyValue = Math.max(0, Number(goals.targetValue) || 0);
  const dailyDerivedValue = targetAdr > 0 && dailyRoomNights > 0
    ? targetAdr * dailyRoomNights
    : 0;
  const targetValueIsDerived = configuredDailyValue <= 0 && dailyDerivedValue > 0;
  const dailyValue = configuredDailyValue > 0 ? configuredDailyValue : dailyDerivedValue;
  const dailyPromo = Math.max(0, Number(goals.promoBudget) || 0);

  return {
    days,
    targetAdr,
    targetRoomNights: dailyRoomNights * days,
    targetValue: dailyValue * days,
    promoBudget: dailyPromo > 0 ? dailyPromo * days : null,
    targetValueIsDerived,
  };
}

/** Turn an editable selected-period total back into the persisted daily baseline. */
export function periodTotalToDaily(total: number, days: number): number {
  const safeDays = Number.isFinite(days) && days > 0 ? days : 1;
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
  return safeTotal / safeDays;
}
