// Returns today's calendar date in Europe/Budapest as 'YYYY-MM-DD'.
export function todayBudapest(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  if (!year || !month || !day) throw new Error('Unable to determine Budapest business date');
  return `${year}-${month}-${day}`;
}

// Returns tomorrow's Budapest business date without depending on the device timezone.
export function tomorrowBudapest(at: Date = new Date()): string {
  const today = todayBudapest(at);
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Convert a Budapest business day to its actual UTC midnight for sync history.
 * The offset is +01:00 or +02:00 depending on the local date (DST).
 */
export function startOfBudapestDayUtc(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid business day');
  const utcMidnight = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(utcMidnight.getTime())) throw new Error('Invalid business day');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hourCycle: 'h23',
  }).formatToParts(utcMidnight);
  const part = (type: string) => Number(parts.find(item => item.type === type)?.value);
  const hour = part('hour');
  const minute = part('minute');
  const second = part('second');
  if (![hour, minute, second].every(Number.isFinite)) throw new Error('Invalid Budapest time');
  return new Date(utcMidnight.getTime() - (hour * 3600 + minute * 60 + second) * 1000).toISOString();
}

/** Advance only a live day view when Budapest rolls over. Never override a
 * manager-selected historical/future date or discard pending assignments.
 */
export function rollForwardSelectedBusinessDate(
  selectedDate: string, previousBusinessDate: string, currentBusinessDate: string,
  hasUnsavedMoves = false,
): string {
  return !hasUnsavedMoves && selectedDate === previousBusinessDate
    && currentBusinessDate > previousBusinessDate
    ? currentBusinessDate : selectedDate;
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
