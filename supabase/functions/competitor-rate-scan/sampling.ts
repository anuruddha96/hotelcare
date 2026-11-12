export const CRON_HORIZON_DAYS = 120;
export const CRON_SAMPLE_DATES = 60;
const CRON_NEAR_PRIORITY_DAYS = 14;

export function isoAdd(base: Date, days: number) {
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Select the scheduled market sample without pretending it is continuous
 * coverage. Always keep the urgent next 14 nights, then the commercially weak
 * November and January dates, then spread the remaining quota across the whole
 * 120-day horizon.
 */
export function prioritySampleDates(
  base: Date,
  horizonDays = CRON_HORIZON_DAYS,
  sampleCount = CRON_SAMPLE_DATES,
): string[] {
  const horizon = Array.from({ length: horizonDays }, (_, i) => isoAdd(base, i));
  const limit = Math.min(Math.max(Math.trunc(sampleCount), 1), horizon.length);
  const chosen = new Set<string>();
  const add = (date: string) => {
    if (chosen.size < limit) chosen.add(date);
  };

  horizon.slice(0, CRON_NEAR_PRIORITY_DAYS).forEach(add);
  horizon.filter((date) => {
    const month = Number(date.slice(5, 7));
    return month === 11 || month === 1;
  }).forEach(add);

  const remaining = horizon.filter((date) => !chosen.has(date));
  const needed = limit - chosen.size;
  if (needed === 1 && remaining.length) add(remaining[Math.floor(remaining.length / 2)]);
  if (needed > 1 && remaining.length) {
    for (let i = 0; i < needed; i += 1) {
      add(remaining[Math.round(i * (remaining.length - 1) / (needed - 1))]);
    }
  }
  // Rounding can select the same date twice in very small horizons.
  remaining.forEach(add);

  return horizon.filter((date) => chosen.has(date));
}
