// Returns today's calendar date in Europe/Budapest as 'YYYY-MM-DD'.
export function todayBudapest(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(new Date());
}

/**
 * Tomorrow-housekeeping planning is intentionally an afternoon workflow.
 * Use Budapest business time rather than the device timezone so the rule is
 * consistent for managers travelling or using remotely managed devices.
 */
export function isBudapestNoonOrLater(at: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Budapest',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  return Number.isFinite(hour) && hour >= 12;
}
