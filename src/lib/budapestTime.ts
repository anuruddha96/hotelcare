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

function budapestHour(at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Budapest',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  return Number(parts.find(part => part.type === 'hour')?.value);
}

/**
 * Next-day housekeeping preparation becomes available from 09:00 Budapest
 * business time. This gives managers the full working day to review today's
 * released plan and prepare tomorrow without exposing the workflow overnight.
 */
export function isBudapestNineOrLater(at: Date = new Date()): boolean {
  const hour = budapestHour(at);
  return Number.isFinite(hour) && hour >= 9;
}

/**
 * Kept for workflows that still intentionally use a noon threshold.
 */
export function isBudapestNoonOrLater(at: Date = new Date()): boolean {
  const hour = budapestHour(at);
  return Number.isFinite(hour) && hour >= 12;
}
