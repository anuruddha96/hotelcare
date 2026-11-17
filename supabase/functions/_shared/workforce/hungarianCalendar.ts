/**
 * Hungarian public holidays (munkaszüneti napok, Mt. 102. §) and the yearly
 * working-day swaps decreed by the ministry (áthelyezett munkanapok).
 *
 * December 24 is a public holiday every year from 2026 (law adopted by
 * Parliament on 3 Nov 2026), which also cancelled the 12 Dec 2026 working
 * Saturday. Swaps are published each spring for the following year; add new
 * years to SWAPS when the decree appears.
 */
export type CalendarDayKind = 'holiday' | 'rest_day' | 'working_saturday';
export interface CalendarDay { date: string; kind: CalendarDayKind; name: string; nameHu: string }

/** 10/2025. (IV. 30.) NGM rendelet, as amended for December 24. */
const SWAPS: Record<number, Array<Omit<CalendarDay, 'date'> & { date: string }>> = {
  2025: [
    { date: '2025-05-02', kind: 'rest_day', name: 'Bridge day off', nameHu: 'Áthelyezett pihenőnap' },
    { date: '2025-05-17', kind: 'working_saturday', name: 'Working Saturday (for 2 May)', nameHu: 'Szombati munkanap' },
    { date: '2025-10-18', kind: 'working_saturday', name: 'Working Saturday (for 24 Oct)', nameHu: 'Szombati munkanap' },
    { date: '2025-10-24', kind: 'rest_day', name: 'Bridge day off', nameHu: 'Áthelyezett pihenőnap' },
    { date: '2025-12-13', kind: 'working_saturday', name: 'Working Saturday (for 24 Dec)', nameHu: 'Szombati munkanap' },
    { date: '2025-12-24', kind: 'rest_day', name: 'Christmas Eve (bridge day off)', nameHu: 'Szenteste (áthelyezett pihenőnap)' },
  ],
  2026: [
    { date: '2026-01-02', kind: 'rest_day', name: 'Bridge day off', nameHu: 'Áthelyezett pihenőnap' },
    { date: '2026-01-10', kind: 'working_saturday', name: 'Working Saturday (for 2 Jan)', nameHu: 'Szombati munkanap' },
    { date: '2026-08-08', kind: 'working_saturday', name: 'Working Saturday (for 21 Aug)', nameHu: 'Szombati munkanap' },
    { date: '2026-08-21', kind: 'rest_day', name: 'Bridge day off', nameHu: 'Áthelyezett pihenőnap' },
  ],
};

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Gregorian Easter Sunday (anonymous algorithm). */
export function easterSunday(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

const cache = new Map<number, Map<string, CalendarDay>>();

export function hungarianCalendar(year: number): Map<string, CalendarDay> {
  const hit = cache.get(year);
  if (hit) return hit;
  const easter = easterSunday(year);
  const list: CalendarDay[] = [
    { date: iso(year, 1, 1), kind: 'holiday', name: "New Year's Day", nameHu: 'Újév' },
    { date: iso(year, 3, 15), kind: 'holiday', name: 'National Day (1848)', nameHu: 'Nemzeti ünnep' },
    { date: addDays(easter, -2), kind: 'holiday', name: 'Good Friday', nameHu: 'Nagypéntek' },
    { date: easter, kind: 'holiday', name: 'Easter Sunday', nameHu: 'Húsvétvasárnap' },
    { date: addDays(easter, 1), kind: 'holiday', name: 'Easter Monday', nameHu: 'Húsvéthétfő' },
    { date: iso(year, 5, 1), kind: 'holiday', name: 'Labour Day', nameHu: 'A munka ünnepe' },
    { date: addDays(easter, 49), kind: 'holiday', name: 'Whit Sunday', nameHu: 'Pünkösdvasárnap' },
    { date: addDays(easter, 50), kind: 'holiday', name: 'Whit Monday', nameHu: 'Pünkösdhétfő' },
    { date: iso(year, 8, 20), kind: 'holiday', name: 'State Foundation Day', nameHu: 'Államalapítás ünnepe' },
    { date: iso(year, 10, 23), kind: 'holiday', name: 'National Day (1956)', nameHu: 'Nemzeti ünnep' },
    { date: iso(year, 11, 1), kind: 'holiday', name: "All Saints' Day", nameHu: 'Mindenszentek' },
    ...(year >= 2026 ? [{ date: iso(year, 12, 24), kind: 'holiday' as const, name: 'Christmas Eve', nameHu: 'Szenteste' }] : []),
    { date: iso(year, 12, 25), kind: 'holiday', name: 'Christmas Day', nameHu: 'Karácsony' },
    { date: iso(year, 12, 26), kind: 'holiday', name: 'Boxing Day', nameHu: 'Karácsony másnapja' },
  ];
  const map = new Map<string, CalendarDay>();
  for (const d of SWAPS[year] ?? []) map.set(d.date, d);
  for (const d of list) map.set(d.date, d); // a statutory holiday wins over a swap
  cache.set(year, map);
  return map;
}

export const calendarDay = (date: string): CalendarDay | undefined => hungarianCalendar(Number(date.slice(0, 4))).get(date);
export const isPublicHoliday = (date: string) => calendarDay(date)?.kind === 'holiday';
/** A day off for office staff: weekend (unless a working Saturday), holiday or bridge day. */
export function isNonWorkingDay(date: string): boolean {
  const day = calendarDay(date);
  if (day) return day.kind !== 'working_saturday';
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6;
}
/** Statutory working days in a list of dates (for full-time hour targets). */
export const workingDays = (dates: string[]) => dates.filter((d) => !isNonWorkingDay(d)).length;
/** Whether the swaps for a year are known (decree published). */
export const swapsKnown = (year: number) => year in SWAPS || year < 2025;
