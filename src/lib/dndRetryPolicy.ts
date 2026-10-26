import { todayBudapest } from './budapestTime';

/**
 * A DND door photo is a visit, not a two-photo checklist. A second visit
 * becomes due four hours after the first photo, or at 14:00 Budapest time,
 * whichever occurs first. Attempts first made after 14:00 are immediately
 * eligible for a second door check (but never invent a second photo).
 */
export function getDndRetryWindow(
  firstAttemptAt: string | null | undefined,
  now: Date = new Date(),
): { allowed: boolean; availableAt: Date | null; reason: 'ready' | 'waiting' | 'missing' | 'different_day' } {
  if (!firstAttemptAt) return { allowed: false, availableAt: null, reason: 'missing' };
  const first = new Date(firstAttemptAt);
  if (!Number.isFinite(first.getTime())) return { allowed: false, availableAt: null, reason: 'missing' };
  const workDate = todayBudapest(first);
  if (todayBudapest(now) !== workDate) return { allowed: false, availableAt: null, reason: 'different_day' };

  // Noon in Budapest is unambiguous even on daylight-saving transition days.
  // Read its UTC offset, then construct the actual 14:00 Budapest instant.
  const noonUtc = new Date(`${workDate}T12:00:00.000Z`);
  const offsetName = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Budapest', timeZoneName: 'shortOffset',
  }).formatToParts(noonUtc).find(part => part.type === 'timeZoneName')?.value ?? '';
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offsetName);
  if (!match) return { allowed: false, availableAt: null, reason: 'missing' };
  const minutes = (Number(match[2]) * 60 + Number(match[3] ?? 0)) * (match[1] === '+' ? 1 : -1);
  const cutoff = Date.parse(`${workDate}T14:00:00.000Z`) - minutes * 60_000;
  const availableAt = new Date(Math.max(first.getTime(), Math.min(first.getTime() + 4 * 60 * 60_000, cutoff)));
  return {
    allowed: now.getTime() >= availableAt.getTime(),
    availableAt,
    reason: now.getTime() >= availableAt.getTime() ? 'ready' : 'waiting',
  };
}

export function dndRetryTimeLabel(availableAt: Date, language = 'en'): string {
  return new Intl.DateTimeFormat(language === 'hu' ? 'hu-HU' : 'en-GB', {
    timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(availableAt);
}
