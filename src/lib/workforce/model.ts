import { isNightShift, WORKING_KINDS, type WorkforceKind } from './cellParser';

export type { WorkforceKind } from './cellParser';

export type AccessLevel = 'org' | 'property' | 'self';

export interface WorkforceDepartment { id: string; name: string; color: string | null; sort_order: number; is_active: boolean }
export interface WorkforceJobRole { id: string; department_id: string; name: string; sort_order: number; is_active: boolean }
export interface WorkforceShiftCode {
  id: string; code: string; label: string; kind: WorkforceKind;
  start_time: string | null; end_time: string | null; day_fraction: number; hotel_id: string | null;
  sort_order: number; is_active: boolean;
}
export interface WorkforceStaff {
  id: string; full_name: string; nickname: string | null;
  department_id: string | null; job_role_id: string | null; hotel_id: string | null; profile_id: string | null;
  employment_type: 'full_time' | 'part_time' | 'hourly' | 'trainee' | 'external';
  daily_hours: number; annual_leave_days: number | null; leave_note: string | null;
  start_date: string | null; end_date: string | null; is_active: boolean; sort_order: number;
  notes: string | null; source_label: string | null;
}
export interface WorkforceEntry {
  id?: string; staff_id: string; work_date: string; kind: WorkforceKind; code: string | null;
  start_time: string | null; end_time: string | null; day_fraction: number; extra_minutes: number;
  hotel_id: string | null; raw_text: string | null; note: string | null; worked_minutes?: number;
  status: 'draft' | 'published';
}

export const ORG_ROLES = ['admin', 'top_management', 'top_management_manager', 'hr'];
export const PROPERTY_ROLES = ['manager', 'housekeeping_manager', 'maintenance_manager', 'reception_manager',
  'back_office_manager', 'finance_manager', 'control_manager', 'marketing_manager'];

/** Mirrors public.workforce_access(); the database stays the authority. */
export function accessLevelFor(role?: string | null, isSuperAdmin?: boolean | null): AccessLevel {
  if (isSuperAdmin || ORG_ROLES.includes(role ?? '')) return 'org';
  if (PROPERTY_ROLES.includes(role ?? '')) return 'property';
  return 'self';
}

/** Mirrors public.workforce_can_edit_date(). */
export function canEditDate(date: string, today: string, role?: string | null, isSuperAdmin?: boolean | null): boolean {
  const level = accessLevelFor(role, isSuperAdmin);
  if (level === 'self') return false;
  if (isSuperAdmin || role === 'admin' || role === 'hr') {
    const [y, m] = today.split('-').map(Number);
    const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
    return date >= prev;
  }
  return date >= today;
}

export const HOTELS: Array<{ id: string; name: string; short: string }> = [
  { id: 'gozsdu-court', name: 'Gozsdu Court Budapest', short: 'Gozsdu' },
  { id: 'memories-budapest', name: 'Hotel Memories Budapest', short: 'Memories' },
  { id: 'mika-downtown', name: 'Hotel Mika Downtown', short: 'Mika' },
  { id: 'ottofiori', name: 'Hotel Ottofiori', short: 'Ottofiori' },
];

export function hotelKey(value?: string | null): string | null {
  const text = value?.trim().toLowerCase();
  if (!text) return null;
  return HOTELS.find((h) => h.id === text || h.name.toLowerCase() === text)?.id ?? value!.trim();
}
export const hotelName = (id?: string | null) => (id ? HOTELS.find((h) => h.id === id)?.name ?? id : 'Company');
export const hotelShort = (id?: string | null) => (id ? HOTELS.find((h) => h.id === id)?.short ?? id : 'Company');

/** Colours of the workbook legend, softened for screens. */
export const KIND_STYLE: Record<WorkforceKind, { bg: string; fg: string; label: string }> = {
  work: { bg: '#d4d4d8', fg: '#18181b', label: 'Working' },
  night: { bg: '#a1a1aa', fg: '#09090b', label: 'Night shift' },
  training: { bg: '#bfdbfe', fg: '#1e3a8a', label: 'Training' },
  home_office: { bg: '#e0e7ff', fg: '#312e81', label: 'Home office' },
  extra_day: { bg: '#c7d2fe', fg: '#1e1b4b', label: 'Extra day (PN)' },
  leave: { bg: '#ef4444', fg: '#ffffff', label: 'Leave (szabadság)' },
  half_leave: { bg: '#fca5a5', fg: '#7f1d1d', label: 'Half-day leave' },
  sick: { bg: '#fde047', fg: '#422006', label: 'Sick (betegség)' },
  unpaid_leave: { bg: '#fef3c7', fg: '#78350f', label: 'Unpaid leave (FNSZ)' },
  absent: { bg: '#fb923c', fg: '#431407', label: 'Unexcused absence' },
  day_off: { bg: '#ffffff', fg: '#71717a', label: 'Day off (szabadnap)' },
  fixed_day_off: { bg: '#18181b', fg: '#fafafa', label: 'Fixed day off' },
  other: { bg: '#f4f4f5', fg: '#52525b', label: 'Note / to confirm' },
};

/** Working at another hotel keeps the workbook colours: Mika green, Ottofiori purple, Memories pink. */
export const HOTEL_STYLE: Record<string, { bg: string; fg: string }> = {
  'mika-downtown': { bg: '#86efac', fg: '#052e16' },
  ottofiori: { bg: '#a855f7', fg: '#ffffff' },
  'memories-budapest': { bg: '#f0abfc', fg: '#4a044e' },
  'gozsdu-court': { bg: '#5eead4', fg: '#042f2e' },
};

export function cellStyle(entry: Pick<WorkforceEntry, 'kind' | 'hotel_id'>, baseHotel: string | null): { bg: string; fg: string } {
  if (WORKING_KINDS.has(entry.kind) && entry.hotel_id) {
    if (entry.hotel_id === 'mika-downtown' || entry.hotel_id !== baseHotel) {
      const style = HOTEL_STYLE[entry.hotel_id];
      if (style) return style;
    }
  }
  return KIND_STYLE[entry.kind];
}

/** Short text shown inside a grid cell. */
export function cellLabel(entry: WorkforceEntry): string {
  const times = entry.start_time && entry.end_time ? `${entry.start_time.slice(0, 5).replace(/:00$/, '')}-${entry.end_time.slice(0, 5).replace(/:00$/, '')}` : '';
  const extra = entry.extra_minutes ? (entry.extra_minutes > 0 ? '+' : '−') + formatMinutesShort(Math.abs(entry.extra_minutes)) : '';
  switch (entry.kind) {
    case 'leave': return 'SZB';
    case 'half_leave': return '½ SZB';
    case 'sick': return 'B';
    case 'unpaid_leave': return 'FNSZ';
    case 'absent': return 'IG';
    case 'fixed_day_off': return '';
    case 'day_off': return '–';
    case 'other': return entry.note ?? entry.raw_text ?? '?';
    case 'night': return `É ${times}${extra ? ' ' + extra : ''}`.trim();
    default: {
      const code = entry.code && entry.code !== 'SZ' ? entry.code : entry.code === 'SZ' && !times ? 'SZ' : '';
      return [code, times, extra].filter(Boolean).join(' ') || '✓';
    }
  }
}

export function formatMinutesShort(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (!h) return `${m}p`;
  return m ? `${h}:${String(m).padStart(2, '0')}` : `${h}h`;
}

export function formatHours(minutes: number): string {
  return (Math.round(minutes / 6) / 10).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

export interface StaffMonthSummary {
  dayShifts: number; nights: number; leaveDays: number; sickDays: number; daysOff: number;
  unpaidDays: number; absentDays: number; extraDays: number; toConfirm: number;
  workedMinutes: number; extraMinutes: number; workedDays: number;
}

/**
 * The workbook's monthly totals per person (Napok, Éjszakák, Szabadságok,
 * Betegségek, Szabadnapok) plus hours. Days without an entry count as days off.
 */
export function summarizeStaffMonth(entries: WorkforceEntry[], daysInPeriod: number, dailyHours = 8): StaffMonthSummary {
  const s: StaffMonthSummary = { dayShifts: 0, nights: 0, leaveDays: 0, sickDays: 0, daysOff: 0, unpaidDays: 0, absentDays: 0, extraDays: 0, toConfirm: 0, workedMinutes: 0, extraMinutes: 0, workedDays: 0 };
  let counted = 0;
  for (const e of entries) {
    counted++;
    s.workedMinutes += e.worked_minutes ?? estimateWorkedMinutes(e, dailyHours);
    if (WORKING_KINDS.has(e.kind)) {
      s.workedDays++;
      s.extraMinutes += e.extra_minutes || 0;
      if (isNightShift({ kind: e.kind, start: e.start_time, end: e.end_time })) s.nights++;
      else s.dayShifts++;
      if (e.kind === 'extra_day') s.extraDays++;
    } else if (e.kind === 'leave') s.leaveDays++;
    else if (e.kind === 'half_leave') { s.leaveDays += 0.5; s.workedDays += 0.5; s.dayShifts++; }
    else if (e.kind === 'sick') s.sickDays++;
    else if (e.kind === 'unpaid_leave') s.unpaidDays++;
    else if (e.kind === 'absent') s.absentDays++;
    else if (e.kind === 'day_off' || e.kind === 'fixed_day_off') s.daysOff++;
    else s.toConfirm++;
  }
  s.daysOff += Math.max(0, daysInPeriod - counted);
  return s;
}

function estimateWorkedMinutes(e: WorkforceEntry, dailyHours: number): number {
  const extra = e.extra_minutes || 0;
  if (WORKING_KINDS.has(e.kind)) {
    if (e.start_time && e.end_time) {
      const [sh, sm] = e.start_time.split(':').map(Number), [eh, em] = e.end_time.split(':').map(Number);
      const d = ((eh * 60 + em) - (sh * 60 + sm) + 1440) % 1440;
      return Math.max(0, (d || 0) + extra);
    }
    return Math.max(0, Math.round(dailyHours * 60 * (e.day_fraction || 1)) + extra);
  }
  if (e.kind === 'half_leave') return Math.max(0, Math.round(dailyHours * 30) + extra);
  return 0;
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
export function monthDays(year: number, month: number): string[] {
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${year}-${pad2(month)}-${pad2(i + 1)}`);
}
export const WEEKDAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
export const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/**
 * Free-text search over people: name, nickname, role, department, hotel,
 * employment type. Several words must all match ("gozsdu sv" = Gozsdu supervisors).
 */
export function matchesStaffSearch(fields: Array<string | null | undefined>, query: string): boolean {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = norm(fields.filter(Boolean).join(' '));
  return terms.every((term) => haystack.includes(term));
}
