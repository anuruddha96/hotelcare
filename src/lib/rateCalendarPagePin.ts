/**
 * Align the interactive calendar decision summary immediately below the
 * app's sticky navigation while the page scrolls past rate-plan rows.
 *
 * The summary stays in its original horizontally scrollable DOM tree, so
 * both date buttons and the frozen room-label rail retain their React
 * handlers and native horizontal panning.
 *
 * The last price row is the release boundary: don't cover ADR, RevPAR, or
 * any later sections with the floating summary.
 */
export interface RateCalendarPagePinGeometry {
  paneTop: number;
  stickyTop: number;
  summaryHeight: number;
  lastRateBottom: number;
}

export function rateCalendarPagePinOffset({
  paneTop,
  stickyTop,
  summaryHeight,
  lastRateBottom,
}: RateCalendarPagePinGeometry): number {
  if (![paneTop, stickyTop, summaryHeight, lastRateBottom].every(Number.isFinite)) return 0;
  if (summaryHeight <= 0) return 0;

  const releaseAt = Math.max(0, lastRateBottom - paneTop - summaryHeight);
  const followPage = Math.max(0, stickyTop - paneTop);
  return Math.max(0, Math.min(releaseAt, followPage));
}
