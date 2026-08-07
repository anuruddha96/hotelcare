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
}

export function setRoomDragPayload(e: React.DragEvent, payload: RoomDragPayload) {
  e.dataTransfer.setData('roomId', payload.roomId);
  e.dataTransfer.setData('roomNumber', payload.roomNumber);
  e.dataTransfer.setData('sourceType', payload.sourceType);
  e.dataTransfer.setData('dragOrigin', payload.origin);
  e.dataTransfer.setData('assignedTo', payload.assignedTo ?? '');
  e.dataTransfer.setData('assignedToName', payload.assignedToName ?? '');
  e.dataTransfer.effectAllowed = 'move';
}

export function readRoomDragPayload(e: React.DragEvent): RoomDragPayload | null {
  const roomId = e.dataTransfer.getData('roomId');
  if (!roomId) return null;
  return {
    roomId,
    roomNumber: e.dataTransfer.getData('roomNumber'),
    sourceType: e.dataTransfer.getData('sourceType'),
    origin: (e.dataTransfer.getData('dragOrigin') as DragOrigin) || 'overview',
    assignedTo: e.dataTransfer.getData('assignedTo') || null,
    assignedToName: e.dataTransfer.getData('assignedToName') || null,
  };
}

/**
 * Assign (or reassign) a unit to a housekeeper for a given date.
 * Existing assignment metadata (type, ready-to-clean, PMS hold, notes) is
 * preserved — only the owner changes.
 */
export async function assignRoomToStaff(params: {
  roomId: string;
  staffId: string;
  assignmentDate: string;
  assignedBy: string;
  organizationSlug?: string | null;
  isCheckoutRoom?: boolean;
}): Promise<void> {
  const { roomId, staffId, assignmentDate, assignedBy, organizationSlug, isCheckoutRoom } = params;

  const { data: existing, error: findErr } = await supabase
    .from('room_assignments')
    .select('id, assigned_to, status')
    .eq('room_id', roomId)
    .eq('assignment_date', assignmentDate)
    .maybeSingle();
  if (findErr) throw findErr;

  if (existing) {
    if (existing.assigned_to === staffId) return;
    const { error } = await supabase
      .from('room_assignments')
      .update({ assigned_to: staffId, assigned_by: assignedBy })
      .eq('id', existing.id);
    if (error) throw error;
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
