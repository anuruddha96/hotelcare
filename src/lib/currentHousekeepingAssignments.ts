import { HOUSEKEEPING_SERVICE_RESULT_CLEANED, HOUSEKEEPING_SERVICE_RESULT_GUEST_DECLINED, LEGACY_NO_SERVICE_MARKER } from './hotel-memories-housekeeping';

export interface CurrentHousekeepingAssignment {
  id: string;
  room_id: string;
  status: string;
  created_at?: string | null;
  notes?: string | null;
  service_result?: string | null;
}

const activePriority = (status: string): number => {
  if (status === 'in_progress') return 3;
  if (status === 'assigned') return 2;
  if (status === 'dnd_pending_retry') return 1;
  return 0;
};

/**
 * A supervisor recheck creates a NEW room_assignments row while retaining the
 * completed submission as audit history. Choose the newest assignment for
 * each room, regardless of PostgREST row order. In a timestamp tie, prefer
 * live work over a completed historic outcome.
 */
export function selectCurrentHousekeepingAssignments<T extends CurrentHousekeepingAssignment>(
  assignments: readonly T[],
): Map<string, T> {
  const byRoom = new Map<string, T>();
  for (const assignment of assignments) {
    const previous = byRoom.get(assignment.room_id);
    if (!previous) {
      byRoom.set(assignment.room_id, assignment);
      continue;
    }
    const currentTime = assignment.created_at ? Date.parse(assignment.created_at) : NaN;
    const previousTime = previous.created_at ? Date.parse(previous.created_at) : NaN;
    const currentMs = Number.isFinite(currentTime) ? currentTime : -Infinity;
    const previousMs = Number.isFinite(previousTime) ? previousTime : -Infinity;
    if (currentMs > previousMs || (currentMs === previousMs && (
      activePriority(assignment.status) > activePriority(previous.status)
      || (activePriority(assignment.status) === activePriority(previous.status) && assignment.id > previous.id)
    ))) {
      byRoom.set(assignment.room_id, assignment);
    }
  }
  return byRoom;
}

/** A former guest-declined submission must never paint a reopened room red. */
export function isCurrentNoServiceOutcome(
  assignment?: Pick<CurrentHousekeepingAssignment, 'status' | 'notes' | 'service_result'> | null,
): boolean {
  if (!assignment || assignment.status !== 'completed') return false;
  if (assignment.service_result === HOUSEKEEPING_SERVICE_RESULT_CLEANED) return false;
  return assignment.service_result === HOUSEKEEPING_SERVICE_RESULT_GUEST_DECLINED
    || !!assignment.notes?.includes(LEGACY_NO_SERVICE_MARKER);
}
