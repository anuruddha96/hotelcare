/** Auto advance only when printed text is high-confidence and the captured
 * first side positively identifies an ID. A provisional front always offers
 * an explicit next-side button; no check digit or identity claim is implied. */
export function shouldAdvanceFront(confidence: number | null, positiveId: boolean): boolean {
  return positiveId && confidence !== null && Number.isFinite(confidence) && confidence > 90;
}

export function confidenceTone(confidence: number | null): 'high' | 'medium' | 'low' | 'unknown' {
  if (confidence === null || !Number.isFinite(confidence)) return 'unknown';
  return confidence > 90 ? 'high' : confidence >= 75 ? 'medium' : 'low';
}

/** The printed data on a TD1 back occupies the upper section, away from MRZ.
 * Use a broad crop so the specimen's three labeled rows stay together. */
export function printedRegion(width: number, height: number, idBack: boolean, focusLeft = false) {
  return { x: 0, y: 0, width: idBack && focusLeft ? Math.round(width * 0.78) : width, height: idBack ? Math.round(height * 0.68) : height };
}
