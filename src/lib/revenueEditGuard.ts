/**
 * Tiny registry of "a rate editor currently holds unsaved values".
 *
 * The executive resume refresh must never overwrite what a manager is in the
 * middle of typing, so any editable Revenue surface registers itself here
 * while it is open. Refreshes that arrive during that window are deferred and
 * replayed once the last editor closes.
 */

const openEditors = new Set<string>();
const waiting = new Set<() => void>();

/** True while at least one rate editor is open with local, unsaved state. */
export function isRevenueEditorDirty(): boolean {
  return openEditors.size > 0;
}

/** Mark an editor as holding unsaved local state. Returns the release fn. */
export function beginRevenueEdit(id: string): () => void {
  openEditors.add(id);
  return () => endRevenueEdit(id);
}

export function endRevenueEdit(id: string): void {
  if (!openEditors.delete(id)) return;
  if (openEditors.size > 0) return;
  const pending = Array.from(waiting);
  waiting.clear();
  pending.forEach((fn) => {
    try { fn(); } catch { /* a deferred refresh must never break the editor */ }
  });
}

/**
 * Run `fn` now when nothing is dirty, otherwise once the last editor closes.
 * Repeated deferrals collapse into a single replay.
 */
export function runWhenRevenueEditorsClosed(fn: () => void): void {
  if (!isRevenueEditorDirty()) { fn(); return; }
  waiting.add(fn);
}

/** Test helper. */
export function __resetRevenueEditGuard(): void {
  openEditors.clear();
  waiting.clear();
}
