export function visibleTrainingTarget(selector?: string): HTMLElement | null {
  if (!selector) return null;
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find((element) => (
    element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible'
  )) ?? null;
}
