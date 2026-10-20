import { captureIdleVisualBackdrop, clearIdleVisualBackdrop } from './idleVisualBackdrop';

/**
 * One browser tab, one activity clock. Suspension is intentionally sticky:
 * mouse moves or focus changes never reactivate an obsolete application.
 * A full document refresh is required to restore subscriptions and queries.
 */
export const SESSION_INACTIVITY_MS = 30 * 60 * 1000;
export const CLIENT_VERSION_CHECK_MS = 5 * 60 * 1000;
export const CLIENT_UPDATE_GRACE_MS = 5 * 60 * 1000;

export type SessionSuspension = 'idle' | 'update' | null;

let lastInteractionAt = Date.now();
let suspension: SessionSuspension = null;
const listeners = new Set<() => void>();

export function getSessionSuspension(): SessionSuspension {
  return suspension;
}
export function observeSessionSuspension(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function notify() { for (const listener of listeners) listener(); }

export function recordHotelCareInteraction(now = Date.now()): void {
  if (suspension) return;
  lastInteractionAt = now;
}
export function checkHotelCareInactivity(now = Date.now()): boolean {
  if (suspension) return true;
  if (now - lastInteractionAt >= SESSION_INACTIVITY_MS) {
    // Preserve a noninteractive image of the current workspace for the dialog
    // before the authenticated UI is unmounted. Operational cleanup is unchanged.
    captureIdleVisualBackdrop();
    suspendHotelCareSession('idle');
    return true;
  }
  return false;
}
export function suspendHotelCareSession(reason: Exclude<SessionSuspension, null>): void {
  if (suspension) return;
  suspension = reason;
  notify();
}
export function resetHotelCareSession(now = Date.now()): void {
  clearIdleVisualBackdrop();
  lastInteractionAt = now;
  suspension = null;
  notify();
}
