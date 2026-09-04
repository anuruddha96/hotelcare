// Shared drag-and-drop contract between the unit/room overview board and the
// housekeeper cards below it.
//
// Both panels live in different components, so the payload travels through the
// native HTML5 dataTransfer object. Keys are deliberately lowercase because
// some browsers normalise dataTransfer type names.

import { supabase } from '@/integrations/supabase/client';

export type DragOrigin = 'overview' | 'housekeeper';

export interface RoomDragPayload {
  roomId: string;
  roomNumber: string;
  /** 'checkout' | 'daily' — used by the existing section retype drop targets. */
  sourceType: string;
  origin: DragOrigin;
  /** Housekeeper the unit is currently assigned to, when known. */
  assignedTo?: string | null;
  assignedToName?: string | null;
  /**
   * Optional bulk payload — set when a whole venue row is dragged. Always
   * includes the primary roomId above so single-unit drop targets still work.
   */
  bulk?: Array<{ roomId: string; roomNumber: string; sourceType: string; assignedTo: string | null; assignedToName: string | null }>;
}

export function setRoomDragPayload(e: React.DragEvent, payload: RoomDragPayload) {
  e.dataTransfer.setData('roomId', payload.roomId);
  e.dataTransfer.setData('roomNumber', payload.roomNumber);
  e.dataTransfer.setData('sourceType', payload.sourceType);
  e.dataTransfer.setData('dragOrigin', payload.origin);
  e.dataTransfer.setData('assignedTo', payload.assignedTo ?? '');
  e.dataTransfer.setData('assignedToName', payload.assignedToName ?? '');
  e.dataTransfer.setData('bulk', payload.bulk ? JSON.stringify(payload.bulk) : '');
  e.dataTransfer.effectAllowed = 'move';
}

export function readRoomDragPayload(e: React.DragEvent): RoomDragPayload | null {
  const roomId = e.dataTransfer.getData('roomId');
  if (!roomId) return null;
  let bulk: RoomDragPayload['bulk'];
  try {
    const raw = e.dataTransfer.getData('bulk');
    if (raw) bulk = JSON.parse(raw);
  } catch {
    bulk = undefined;
  }
  return {
    roomId,
    roomNumber: e.dataTransfer.getData('roomNumber'),
    sourceType: e.dataTransfer.getData('sourceType'),
    origin: (e.dataTransfer.getData('dragOrigin') as DragOrigin) || 'overview',
    assignedTo: e.dataTransfer.getData('assignedTo') || null,
    assignedToName: e.dataTransfer.getData('assignedToName') || null,
    bulk,
  };
}

// ---------------------------------------------------------------------------
// Inverse drag: a housekeeper chip dragged onto a room chip.
// Separate DataTransfer keys so it can never be mistaken for a room drag.
// ---------------------------------------------------------------------------

export const HOUSEKEEPER_DRAG_TYPE = 'hk-housekeeper';

export interface HousekeeperDragPayload {
  staffId: string;
  staffName: string;
}

export function setHousekeeperDragPayload(e: React.DragEvent, payload: HousekeeperDragPayload) {
  e.dataTransfer.setData(HOUSEKEEPER_DRAG_TYPE, '1');
  e.dataTransfer.setData('housekeeperid', payload.staffId);
  e.dataTransfer.setData('housekeepername', payload.staffName);
  e.dataTransfer.effectAllowed = 'move';
}

export function readHousekeeperDragPayload(e: React.DragEvent): HousekeeperDragPayload | null {
  const staffId = e.dataTransfer.getData('housekeeperid');
  if (!staffId) return null;
  return { staffId, staffName: e.dataTransfer.getData('housekeepername') || '' };
}

/** Thrown when a room cannot be reassigned because cleaning already started. */
export class AssignmentInProgressError extends Error {
  readonly code = 'assignment_in_progress' as const;
  readonly currentAssigneeId: string | null;

  constructor(currentAssigneeId: string | null) {
    super('Room assignment is in progress and cannot be reassigned');
    this.name = 'AssignmentInProgressError';
    this.currentAssigneeId = currentAssigneeId;
  }
}

export function isAssignmentInProgressError(err: unknown): err is AssignmentInProgressError {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'assignment_in_progress';
}




/**
 * Assign (or reassign) a unit to a housekeeper for a given date.
 * Existing assignment metadata (type, ready-to-clean, PMS hold, notes) is
 * preserved — only the owner changes. Optional insert-only values are used
 * when a room did not have an assignment yet; they never overwrite an
 * existing assignment during a reassign.
 */
export async function assignRoomToStaff(params: {
  roomId: string;
  staffId: string;
  assignmentDate: string;
  assignedBy: string;
  organizationSlug?: string | null;
  isCheckoutRoom?: boolean;
  readyToClean?: boolean;
  priority?: number;
}): Promise<void> {
  const {
    roomId,
    staffId,
    assignmentDate,
    assignedBy,
    organizationSlug,
    isCheckoutRoom,
    readyToClean,
    priority,
  } = params;

  const { data: existing, error: findErr } = await supabase
    .from('room_assignments')
    .select('id, assigned_to, status')
    .eq('room_id', roomId)
    .eq('assignment_date', assignmentDate)
    .maybeSingle();
  if (findErr) throw findErr;

  if (existing) {
    if (existing.assigned_to === staffId) return;
    // A room that is being cleaned right now must never change owner. The
    // guard is race-safe: the update itself excludes in_progress rows, so an
    // assignment that starts between the read and the write still cannot be
    // moved.
    if (existing.status === 'in_progress') {
      throw new AssignmentInProgressError(existing.assigned_to ?? null);
    }
    const { data: updated, error } = await supabase
      .from('room_assignments')
      .update({ assigned_to: staffId, assigned_by: assignedBy })
      .eq('id', existing.id)
      .neq('status', 'in_progress')
      .select('id');
    if (error) throw error;
    if (!updated || updated.length === 0) {
      throw new AssignmentInProgressError(existing.assigned_to ?? null);
    }
    return;
  }


  const insert: Record<string, unknown> = {
    room_id: roomId,
    assigned_to: staffId,
    assigned_by: assignedBy,
    assignment_date: assignmentDate,
    assignment_type: isCheckoutRoom ? 'checkout_cleaning' : 'daily_cleaning',
    status: 'assigned',
  };
  if (organizationSlug) insert.organization_slug = organizationSlug;
  if (readyToClean !== undefined) insert.ready_to_clean = readyToClean;
  if (priority !== undefined) insert.priority = priority;

  const { error } = await supabase.from('room_assignments').insert(insert as never);
  if (error) throw error;
}

/** Remove today's assignment for a unit (the unit returns to the unassigned board). */
export async function unassignRoom(roomId: string, assignmentDate: string): Promise<void> {
  const { error } = await supabase
    .from('room_assignments')
    .delete()
    .eq('room_id', roomId)
    .eq('assignment_date', assignmentDate);
  if (error) throw error;
}
