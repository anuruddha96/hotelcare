/**
 * The employee's own view of the schedule: what one day means in plain words,
 * and the leave balance. Pure, so every wording rule is unit-tested.
 */
import { cellLabel, type WorkforceEntry, type WorkforceKind } from './model';

export type MyDayTone = 'work' | 'night' | 'off' | 'leave' | 'sick' | 'info' | 'unknown';

export interface MyDay {
  date: string;
  tone: MyDayTone;
  /** Translation key of the headline ("Working", "Day off", "Leave" …). */
  labelKey: string;
  /** "08:00 – 17:00" when the shift has times, otherwise the planner's code (e.g. "K"). */
  time: string | null;
  /** Short text for a calendar cell: "08–17", "OFF" is left to the caller's translation → null. */
  short: string | null;
  hours: number | null;
  /** Hotel key when the person works somewhere other than their base hotel. */
  awayHotel: string | null;
  note: string | null;
  isWork: boolean;
}

const KIND_KEY: Record<WorkforceKind, { key: string; tone: MyDayTone }> = {
  work: { key: 'wf.my.working', tone: 'work' },
  extra_day: { key: 'wf.my.working', tone: 'work' },
  night: { key: 'wf.my.night', tone: 'night' },
  training: { key: 'wf.my.training', tone: 'info' },
  home_office: { key: 'wf.my.homeOffice', tone: 'info' },
  leave: { key: 'wf.my.leave', tone: 'leave' },
  half_leave: { key: 'wf.my.halfLeave', tone: 'leave' },
  sick: { key: 'wf.my.sick', tone: 'sick' },
  unpaid_leave: { key: 'wf.my.unpaid', tone: 'leave' },
  absent: { key: 'wf.my.absent', tone: 'sick' },
  day_off: { key: 'wf.my.dayOff', tone: 'off' },
  fixed_day_off: { key: 'wf.my.dayOff', tone: 'off' },
  other: { key: 'wf.my.other', tone: 'unknown' },
};

const hhmm = (value: string | null | undefined) => (value ? value.slice(0, 5) : null);
const shortTime = (value: string) => (value.endsWith(':00') ? value.slice(0, 2) : value);

/**
 * One day as the employee should read it.
 * A day without an entry is a day off once the month is planned (the planner
 * leaves days off empty, as in the Excel); before that it is "not planned yet".
 */
export function describeMyDay(
  date: string, entry: WorkforceEntry | undefined, baseHotel: string | null | undefined, monthPlanned: boolean,
): MyDay {
  if (!entry) {
    return {
      date, tone: monthPlanned ? 'off' : 'unknown', labelKey: monthPlanned ? 'wf.my.dayOff' : 'wf.my.notPlanned',
      time: null, short: null, hours: null, awayHotel: null, note: null, isWork: false,
    };
  }
  const meta = KIND_KEY[entry.kind] ?? KIND_KEY.other;
  const start = hhmm(entry.start_time), end = hhmm(entry.end_time);
  const isWork = ['work', 'night', 'training', 'home_office', 'extra_day', 'half_leave'].includes(entry.kind);
  const code = isWork ? (cellLabel(entry) || null) : null;
  return {
    date, tone: meta.tone, labelKey: meta.key,
    time: start && end ? `${start} – ${end}` : code,
    short: start && end ? `${shortTime(start)}–${shortTime(end)}` : code,
    hours: entry.worked_minutes ? Math.round(entry.worked_minutes / 6) / 10 : null,
    awayHotel: entry.hotel_id && entry.hotel_id !== baseHotel ? entry.hotel_id : null,
    note: entry.note?.trim() || null,
    isWork,
  };
}

export interface LeaveBalance { total: number; used: number; left: number; percentUsed: number }

/** Annual leave: entitlement, used this year, left. Null when HR has not entered an entitlement. */
export function leaveBalance(annualLeaveDays: number | null | undefined, usedThisYear: number): LeaveBalance | null {
  if (annualLeaveDays == null || !Number.isFinite(Number(annualLeaveDays))) return null;
  const total = Number(annualLeaveDays);
  const used = Math.max(0, usedThisYear);
  return { total, used, left: Math.round((total - used) * 10) / 10, percentUsed: total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0 };
}

/** The seven days of the week (Monday first) that contains `date`. */
export function weekOf(date: string): string[] {
  const d = new Date(`${date}T12:00:00Z`);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000);
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 86400000).toISOString().slice(0, 10));
}

export const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
