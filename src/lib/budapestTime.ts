// Returns today's calendar date in Europe/Budapest as 'YYYY-MM-DD'.
export function todayBudapest(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(at);
}

// Returns tomorrow's Budapest business date without depending on the device timezone.
export function tomorrowBudapest(at: Date = new Date()): string {
  const today = todayBudapest(at);
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
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
