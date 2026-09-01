export const SAME_DAY_DEFAULT_FLOOR_EUR = 100;
export const SAME_DAY_DEFAULT_CUTOFF_MINUTES = 15 * 60;
export const SAME_DAY_DEFAULT_INTERVAL_MINUTES = 30;

/**
 * Whole-euro markdown for an arrival-day check with no genuine pickup in the
 * current 30-minute observation window. The closer the hotel gets to 15:00,
 * the more valuable occupancy becomes relative to holding the prior BAR.
 */
export function sameDayUrgencyStep(localMinutes: number, roomsRemaining: number): number {
  let base = 3;
  if (localMinutes >= 14 * 60 + 30) base = 10;
  else if (localMinutes >= 14 * 60) base = 8;
  else if (localMinutes >= 13 * 60) base = 7;
  else if (localMinutes >= 12 * 60) base = 6;
  else if (localMinutes >= 10 * 60) base = 5;
  else if (localMinutes >= 8 * 60) base = 4;

  // More unsold inventory increases urgency. With only one room left, preserve
  // a little scarcity value while still making a meaningful move.
  if (roomsRemaining >= 4) base += 2;
  else if (roomsRemaining === 1) base = Math.max(3, base - 2);
  return Math.round(base);
}
