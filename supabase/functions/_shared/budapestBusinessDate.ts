// Previo housekeeping operates on the property's local calendar day, not UTC.
// Use formatToParts rather than locale-specific date-string ordering.
export function budapestBusinessDate(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new Error("Unable to determine Budapest business date");
  return `${year}-${month}-${day}`;
}

/** UTC instant at the start of the specified Budapest calendar day.
 * Unlike `${day}T00:00:00Z`, this respects winter/summer time.
 */
export function budapestBusinessDayStartUtc(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid Budapest business date');
  const midnight = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(midnight.getTime())) throw new Error('Invalid Budapest business date');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hourCycle: 'h23',
  }).formatToParts(midnight);
  const part = (type: string) => Number(parts.find(item => item.type === type)?.value);
  const hour = part('hour');
  const minute = part('minute');
  const second = part('second');
  if (![hour, minute, second].every(Number.isFinite)) throw new Error('Invalid Budapest midnight');
  return new Date(midnight.getTime() - (hour * 3600 + minute * 60 + second) * 1000).toISOString();
}
