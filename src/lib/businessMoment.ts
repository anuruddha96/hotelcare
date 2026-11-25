/** Budapest business dates are wall-clock values, not the browser's timezone. */
export const BUSINESS_TZ = 'Europe/Budapest';

export function budapestDateTime(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const part = (key: string) => parts.find((p) => p.type === key)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function budapestToday(at: Date = new Date()): string {
  return budapestDateTime(at).slice(0, 10);
}

/** Reject spring-forward gaps, choose the earlier occurrence of fall-back overlaps. */
export function budapestWallToIso(wall: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall)) throw new Error('INVALID_BUSINESS_TIME');
  const utcWall = Date.parse(`${wall}:00Z`);
  if (!Number.isFinite(utcWall)) throw new Error('INVALID_BUSINESS_TIME');
  for (const offsetMinutes of [120, 60]) {
    const candidate = new Date(utcWall - offsetMinutes * 60_000);
    if (budapestDateTime(candidate) === wall) return candidate.toISOString();
  }
  throw new Error('INVALID_BUSINESS_TIME');
}

export function formatBudapestMoment(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TZ, day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso));
}

export function earliestBusinessDay(firstClosure?: string | null, minimum?: string | null): string | undefined {
  const days = [firstClosure, minimum].filter((v): v is string => !!v);
  return days.length ? days.sort().at(-1) : undefined;
}
