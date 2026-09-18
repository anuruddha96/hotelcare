import type { WorkbookShift } from './workScheduleWorkbook';

export type ExistingScheduleShift = {
  staff_id: string;
  shift_date: string;
  slot: number;
  kind: string;
  start_local: string | null;
  end_local: string | null;
  end_day_offset: number;
  unpaid_break_minutes: number;
  state: string;
  version: number;
};

/** Supabase `time` values may include seconds; canonical Excel times do not.
 * Null represents a nonworking day on BOTH sides; optional chaining alone
 * returns undefined and incorrectly declares an identical day off a conflict. */
export function sameScheduleShift(before: ExistingScheduleShift, after: WorkbookShift): boolean {
  return before.kind === after.kind
    && (before.start_local?.slice(0, 5) ?? null) === after.start_local
    && (before.end_local?.slice(0, 5) ?? null) === after.end_local
    && before.end_day_offset === after.end_day_offset
    && before.unpaid_break_minutes === after.unpaid_break_minutes;
}
