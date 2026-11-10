/**
 * The repair SLA starts at tickets.sla_due_date, not at the timestamp of
 * the L1/L2 notification. Both escalation emails must report time elapsed
 * since the ORIGINAL repair deadline.
 */
export function maintenanceHoursPastDue(now: Date, slaDueDate: string): number {
  const due = Date.parse(slaDueDate);
  if (!Number.isFinite(due) || !Number.isFinite(now.getTime())) return 0;
  return Math.max(0, (now.getTime() - due) / 3_600_000);
}

export function formatMaintenanceOverdue(hoursPast: number): string {
  if (!Number.isFinite(hoursPast)) return 'Repair deadline exceeded';
  const minutes = Math.max(1, Math.ceil(Math.max(0, hoursPast) * 60));
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  if (days) {
    const dayText = `${days} ${days === 1 ? 'day' : 'days'}`;
    const hourText = hours ? ` ${hours} ${hours === 1 ? 'hour' : 'hours'}` : '';
    return `${dayText}${hourText} past repair deadline`;
  }
  if (hours) return `${hours} ${hours === 1 ? 'hour' : 'hours'} past repair deadline`;
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} past repair deadline`;
}
