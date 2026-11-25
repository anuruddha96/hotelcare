/** Geometry-only boundary for the mobile/desktop Rate & Pickup summary.
 * Only the boolean changes at entry/exit; the pinned header is not animated
 * or translated during a scroll gesture.
 */
export interface RateSummaryBoundary {
  anchorTop: number;
  appHeaderBottom: number;
  lastRateBottom: number;
  summaryHeight: number;
}

export function shouldPinRateSummary({
  anchorTop,
  appHeaderBottom,
  lastRateBottom,
  summaryHeight,
}: RateSummaryBoundary): boolean {
  if (![anchorTop, appHeaderBottom, lastRateBottom, summaryHeight].every(Number.isFinite)) return false;
  if (summaryHeight <= 0) return false;
  return anchorTop <= appHeaderBottom && lastRateBottom > appHeaderBottom + summaryHeight;
}
