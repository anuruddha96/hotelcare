/**
 * Pure schedule calculations shared by the desktop/mobile planner.
 * Hours are planned clock hours, not payroll-approved hours. Breaks, public
 * holiday supplements, overtime and attendance must be reconciled separately.
 */
export type StaffWorkStatus = 'working' | 'training' | 'off' | 'leave' | 'sick';

export type ScheduleCalculationRow = {
  user_id: string;
  work_date: string;
  shift_start?: string | null;
  shift_end?: string | null;
  work_status?: string | null;
  status?: string | null;
};

export function calculateScheduledMinutes(start?: string | null, end?: string | null): number | null {
  const toMinutes = (value?: string | null) => {
    if (!value || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) return null;
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  };
  const from = toMinutes(start), until = toMinutes(end);
  if (from === null || until === null || from === until) return null;
  return (until - from + 1440) % 1440;
}

export function getScheduleSummary(rows: ScheduleCalculationRow[], selectedIds?: Set<string>) {
  const included = selectedIds ? rows.filter(row => selectedIds.has(row.user_id)) : rows;
  let minutes = 0;
  let incomplete = 0;
  let working = 0;
  let training = 0;
  let leave = 0;
  let sick = 0;
  let off = 0;
  let published = 0;
  let drafts = 0;
  for (const row of included) {
    const workStatus = row.work_status ?? (row.status === 'off' ? 'off' : row.shift_start && row.shift_end ? 'working' : 'off');
    if (row.status === 'published') published++;
    else drafts++;
    if (workStatus === 'leave') leave++;
    else if (workStatus === 'sick') sick++;
    else if (workStatus === 'off') off++;
    else if (workStatus === 'working' || workStatus === 'training') {
      if (workStatus === 'training') training++;
      else working++;
      const duration = calculateScheduledMinutes(row.shift_start, row.shift_end);
      if (duration === null) incomplete++;
      else minutes += duration;
    }
  }
  return { minutes, hours: Math.round(minutes / 6) / 10, incomplete, working, training, leave, sick, off, published, drafts };
}
