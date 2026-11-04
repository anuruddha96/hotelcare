/**
 * Rate & Pickup viewport rules. Background rate/pickup updates must be visual
 * data changes, not unsolicited navigation.
 */
export function shouldAllowRateCalendarEdgePan(
  pointerType: string,
  selectingDates: boolean,
  draggingRateCells: boolean,
): boolean {
  return pointerType === "mouse" && (selectingDates || draggingRateCells);
}

/**
 * The initial populated render and a deliberate hotel/date-view change may
 * position the calendar; transient empty/loading states may not.
 */
export function shouldResetRateCalendarViewport(
  previousKey: string | null,
  nextKey: string,
  hasGridRows: boolean,
): boolean {
  return hasGridRows && previousKey !== nextKey;
}
