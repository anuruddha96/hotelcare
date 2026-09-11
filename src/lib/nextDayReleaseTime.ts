export const NEXT_DAY_RELEASE_TIME_OPTIONS = [
  '06:00',
  '06:30',
  '07:00',
  '07:30',
  '08:00',
  '08:30',
] as const;

export type NextDayReleaseTime = (typeof NEXT_DAY_RELEASE_TIME_OPTIONS)[number];

export const DEFAULT_NEXT_DAY_RELEASE_TIME: NextDayReleaseTime = '08:00';

export function normalizeNextDayReleaseTime(value?: string | null): NextDayReleaseTime {
  const normalized = (value || '').slice(0, 5) as NextDayReleaseTime;
  return NEXT_DAY_RELEASE_TIME_OPTIONS.includes(normalized)
    ? normalized
    : DEFAULT_NEXT_DAY_RELEASE_TIME;
}

export function isNextDayReleaseTime(value: string): value is NextDayReleaseTime {
  return NEXT_DAY_RELEASE_TIME_OPTIONS.includes(value as NextDayReleaseTime);
}
