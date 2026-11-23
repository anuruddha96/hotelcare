/**
 * The per-employee report HR and managers send to payroll and use in reviews:
 * days and hours worked against the norm, nights, weekends, public holidays,
 * absences, and what needs a second look. Pure, unit-tested.
 */
import { WORKING_KINDS, isNightShift, type WorkforceKind } from './cellParser';
import { isPublicHoliday, workingDays } from './holidays';
import { monthDays } from './model';

export interface ReportEntry {
  staff_id: string; work_date: string; kind: WorkforceKind; worked_minutes: number; extra_minutes: number;
  hotel_id: string | null; status: string; start_time?: string | null; end_time?: string | null;
}
export interface ReportStaff {
  id: string; full_name: string; daily_hours: number; employment_type: string;
  start_date: string | null; end_date: string | null; annual_leave_days: number | null;
}
export type ReportFlag = 'overtime' | 'under' | 'long_run' | 'sick' | 'absent' | 'drafts';

export interface EmployeeReportRow {
  staffId: string;
  daysWorked: number; dayShifts: number; nights: number; weekendShifts: number; holidayShifts: number;
  minutes: number; normMinutes: number | null; balanceMinutes: number | null;
  leaveDays: number; sickDays: number; unpaidDays: number; absentDays: number; drafts: number;
  /** Longest stretch of working days in a row. */
  longestRun: number;
  flags: ReportFlag[];
}

export const OVERTIME_FLAG_MINUTES = 12 * 60;
export const LONG_RUN_DAYS = 7;

/** "YYYY-MM" for every month from `from` to `to` (inclusive). */
export function monthsBetween(fromMonth: string, toMonth: string): string[] {
  const out: string[] = [];
  let [y, m] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
    if (out.length > 60) break;
  }
  return out;
}

/** Monthly norm: statutory working days the person was employed × daily hours. Null for hourly and external staff. */
export function normMinutes(staff: ReportStaff, months: string[]): number | null {
  if (staff.employment_type === 'hourly' || staff.employment_type === 'external' || !(staff.daily_hours > 0)) return null;
  let days = 0;
  for (const month of months) {
    const [y, m] = month.split('-').map(Number);
    days += workingDays(monthDays(y, m).filter((d) => (!staff.start_date || d >= staff.start_date) && (!staff.end_date || d <= staff.end_date)));
  }
  return Math.round(days * staff.daily_hours * 60);
}

const nextDay = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);

export function employeeReport(entries: ReportEntry[], staff: ReportStaff[], months: string[]): EmployeeReportRow[] {
  const byStaff = new Map<string, ReportEntry[]>();
  for (const e of entries) { const list = byStaff.get(e.staff_id); if (list) list.push(e); else byStaff.set(e.staff_id, [e]); }
  const out: EmployeeReportRow[] = [];
  for (const s of staff) {
    const mine = (byStaff.get(s.id) ?? []).sort((a, b) => a.work_date.localeCompare(b.work_date));
    if (!mine.length) continue;
    const row: EmployeeReportRow = {
      staffId: s.id, daysWorked: 0, dayShifts: 0, nights: 0, weekendShifts: 0, holidayShifts: 0, minutes: 0,
      normMinutes: normMinutes(s, months), balanceMinutes: null, leaveDays: 0, sickDays: 0, unpaidDays: 0, absentDays: 0,
      drafts: 0, longestRun: 0, flags: [],
    };
    let run = 0, previous = '';
    for (const e of mine) {
      row.minutes += e.worked_minutes ?? 0;
      if (e.status === 'draft') row.drafts++;
      const working = WORKING_KINDS.has(e.kind);
      if (working) {
        row.daysWorked++;
        if (isNightShift({ kind: e.kind, start: e.start_time, end: e.end_time })) row.nights++; else row.dayShifts++;
        const weekday = new Date(`${e.work_date}T12:00:00Z`).getUTCDay();
        if (weekday === 0 || weekday === 6) row.weekendShifts++;
        if (isPublicHoliday(e.work_date)) row.holidayShifts++;
        run = previous && nextDay(previous) === e.work_date ? run + 1 : 1;
        previous = e.work_date;
        row.longestRun = Math.max(row.longestRun, run);
      } else {
        if (e.kind === 'leave') row.leaveDays++;
        else if (e.kind === 'half_leave') { row.leaveDays += 0.5; row.daysWorked += 0.5; }
        else if (e.kind === 'sick') row.sickDays++;
        else if (e.kind === 'unpaid_leave') row.unpaidDays++;
        else if (e.kind === 'absent') row.absentDays++;
        run = 0; previous = '';
      }
    }
    if (row.normMinutes != null) {
      // Paid leave and sick days count as worked, so taking leave never shows as hours owed.
      row.balanceMinutes = Math.round(row.minutes + (row.leaveDays + row.sickDays) * s.daily_hours * 60 - row.normMinutes);
      if (row.balanceMinutes >= OVERTIME_FLAG_MINUTES) row.flags.push('overtime');
      if (row.balanceMinutes <= -OVERTIME_FLAG_MINUTES) row.flags.push('under');
    }
    if (row.longestRun >= LONG_RUN_DAYS) row.flags.push('long_run');
    if (row.sickDays >= 3) row.flags.push('sick');
    if (row.absentDays > 0) row.flags.push('absent');
    if (row.drafts > 0) row.flags.push('drafts');
    out.push(row);
  }
  return out;
}

/** Average number of people working on each weekday (Monday first) in the period. */
export function weekdayCoverage(entries: ReportEntry[]): Array<{ weekday: number; average: number }> {
  const perDay = new Map<string, number>();
  for (const e of entries) if (WORKING_KINDS.has(e.kind)) perDay.set(e.work_date, (perDay.get(e.work_date) ?? 0) + 1);
  const sums = Array.from({ length: 7 }, () => ({ total: 0, days: 0 }));
  for (const [date, count] of perDay) {
    const i = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
    sums[i].total += count; sums[i].days++;
  }
  return sums.map((s, i) => ({ weekday: i, average: s.days ? Math.round((s.total / s.days) * 10) / 10 : 0 }));
}
