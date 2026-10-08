/**
 * Imperative highlighting for Rate & Pickup drag selection.
 *
 * The price grid is large, so dragging does not re-render React for every
 * pointer event. React may still re-attach or replace a price button during
 * a gesture; painted keys alone are not proof that its DOM is highlighted.
 */
export const PRICE_RANGE_CLASSES = ["bg-primary/25", "ring-1", "ring-inset", "ring-primary"] as const;

export function setPriceCellPainted(element: HTMLButtonElement, selected: boolean): void {
  if (selected) {
    element.style.transitionProperty = "none";
    element.classList.add(...PRICE_RANGE_CLASSES);
  } else {
    element.classList.remove(...PRICE_RANGE_CLASSES);
    element.style.transitionProperty = "";
  }
}

/** Keep actual DOM nodes in sync even when the selected keys did not change. */
export function syncPriceCellSelection(
  elements: ReadonlyMap<string, HTMLButtonElement>,
  previouslyPainted: ReadonlySet<string>,
  selected: ReadonlySet<string>,
): void {
  for (const key of previouslyPainted) {
    if (selected.has(key)) continue;
    const element = elements.get(key);
    if (element) setPriceCellPainted(element, false);
  }
  for (const key of selected) {
    const element = elements.get(key);
    if (!element || element.disabled) continue;
    // A button may have been re-mounted, or React may have written className
    // after the previous frame. Never skip it just because its key was painted.
    if (!PRICE_RANGE_CLASSES.every((className) => element.classList.contains(className))) {
      setPriceCellPainted(element, true);
    }
  }
}
