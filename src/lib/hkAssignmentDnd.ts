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

/** Kept for compatibility with older room-board error handling. */
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

/** Thrown when a room already has both shared-cleaning seats occupied. */
export class SharedAssignmentFullError extends Error {
  readonly code = 'shared_assignment_full' as const;
  readonly primaryAssigneeId: string | null;
  readonly sharedAssigneeId: string | null;

  constructor(primaryAssigneeId: string | null, sharedAssigneeId: string | null) {
    super('This room is already shared by two housekeepers');
    this.name = 'SharedAssignmentFullError';
    this.primaryAssigneeId = primaryAssigneeId;
    this.sharedAssigneeId = sharedAssigneeId;
  }
}

export function isSharedAssignmentFullError(err: unknown): err is SharedAssignmentFullError {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'shared_assignment_full';
}

/**
 * Dragging a housekeeper onto an unassigned room creates the primary assignment.
 * Dragging a different housekeeper onto an already-assigned room adds them as
 * the second cleaner instead of replacing the first. The database RPC locks the
 * canonical room assignment, so two simultaneous drops cannot create a third
 * cleaner or fork the room state. Joining is deliberately allowed even after
 * the first cleaner has started.
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
  const { data, error } = await (supabase as any).rpc('assign_or_share_housekeeping_room', {
    p_room_id: params.roomId,
    p_staff_id: params.staffId,
    p_assignment_date: params.assignmentDate,
    p_assigned_by: params.assignedBy,
    p_organization_slug: params.organizationSlug ?? null,
    p_is_checkout_room: params.isCheckoutRoom ?? false,
    p_ready_to_clean: params.readyToClean ?? null,
    p_priority: params.priority ?? null,
  });

  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : data;
  if (result?.ok === false && result?.code === 'shared_assignment_full') {
    throw new SharedAssignmentFullError(result.assigned_to ?? null, result.shared_with ?? null);
  }
  if (result?.ok === false) {
    throw new Error(result?.code || 'Unable to assign housekeeper to room');
  }
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

// ---------------------------------------------------------------------------
// Mobile touch / pen bridge for the existing HTML5 housekeeper -> room DnD.
//
// iOS/Android browsers do not reliably emit HTML5 drag events for draggable
// elements. The room board already has the correct dragstart/drop handlers and
// realtime assignment write path, so we translate a touch/pen pointer gesture
// into the same drag event contract instead of maintaining a second assignment
// implementation. This is intentionally scoped to the signed-in housekeeper
// pills inside #hotel-room-overview; room dragging and every other draggable in
// the application keep their existing behaviour.
// ---------------------------------------------------------------------------

type MobileDragDataTransfer = DataTransfer & {
  __hotelcareData?: Map<string, string>;
};

type MobilePointerDrag = {
  pointerId: number;
  source: HTMLElement;
  dataTransfer: MobileDragDataTransfer;
  overTarget: Element | null;
  ghost: HTMLElement | null;
};

const MOBILE_DND_INSTALL_KEY = '__hotelcareMobileHousekeeperDndInstalled';

function createMobileDataTransfer(): MobileDragDataTransfer {
  const data = new Map<string, string>();
  const transfer = {
    dropEffect: 'move',
    effectAllowed: 'move',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [] as string[],
    setData(format: string, value: string) {
      const key = String(format);
      data.set(key, String(value));
      this.types = Array.from(data.keys());
    },
    getData(format: string) {
      return data.get(String(format)) ?? '';
    },
    clearData(format?: string) {
      if (format === undefined) data.clear();
      else data.delete(String(format));
      this.types = Array.from(data.keys());
    },
    setDragImage() {
      // We render a lightweight finger-following clone below instead.
    },
    __hotelcareData: data,
  } as unknown as MobileDragDataTransfer;
  return transfer;
}

function dispatchMobileDragEvent(
  type: 'dragstart' | 'dragenter' | 'dragover' | 'dragleave' | 'drop' | 'dragend',
  target: Element,
  dataTransfer: DataTransfer,
  clientX: number,
  clientY: number,
  relatedTarget: Element | null = null,
): boolean {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { configurable: true, value: dataTransfer },
    clientX: { configurable: true, value: clientX },
    clientY: { configurable: true, value: clientY },
    relatedTarget: { configurable: true, value: relatedTarget },
  });
  return target.dispatchEvent(event);
}

function findMobileHousekeeperSource(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const draggable = target.closest<HTMLElement>('[draggable="true"]');
  if (!draggable || !draggable.closest('#hotel-room-overview')) return null;

  // Signed-in housekeeper pills are the only draggable controls in the room
  // overview with the GripVertical icon. This avoids intercepting room-chip
  // dragging, venue dragging, or unrelated draggable controls elsewhere.
  if (!draggable.querySelector('svg.lucide-grip-vertical')) return null;
  return draggable;
}

function createMobileDragGhost(source: HTMLElement, x: number, y: number): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  const ghost = source.cloneNode(true) as HTMLElement;
  const rect = source.getBoundingClientRect();
  ghost.removeAttribute('draggable');
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: `${Math.max(rect.width, 44)}px`,
    minHeight: `${Math.max(rect.height, 32)}px`,
    margin: '0',
    pointerEvents: 'none',
    zIndex: '2147483646',
    opacity: '0.92',
    transform: `translate3d(${Math.round(x + 14)}px, ${Math.round(y + 14)}px, 0)`,
  });
  document.body.appendChild(ghost);
  return ghost;
}

function moveMobileDragGhost(ghost: HTMLElement | null, x: number, y: number) {
  if (!ghost) return;
  ghost.style.transform = `translate3d(${Math.round(x + 14)}px, ${Math.round(y + 14)}px, 0)`;
}

function removeMobileDragGhost(ghost: HTMLElement | null) {
  if (ghost?.parentNode) ghost.parentNode.removeChild(ghost);
}

function mobileDropTargetAt(x: number, y: number, source: HTMLElement): Element | null {
  const hit = document.elementFromPoint(x, y);
  if (!hit || source.contains(hit)) return null;

  // Room chips themselves are draggable. Stabilising the target at the nearest
  // draggable avoids dragleave/dragenter flicker while a finger crosses the
  // badges inside one room chip. If the pointer is over a non-draggable area,
  // keep the exact hit so existing section-level handlers can still receive it.
  return hit.closest('[draggable="true"]') ?? hit;
}

function autoScrollMobileDrag(y: number) {
  const edge = 76;
  const height = window.innerHeight;
  if (y < edge) {
    window.scrollBy({ top: -Math.ceil((edge - y) / 4), behavior: 'auto' });
  } else if (y > height - edge) {
    window.scrollBy({ top: Math.ceil((y - (height - edge)) / 4), behavior: 'auto' });
  }
}

function installMobileHousekeeperDragBridge() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const win = window as Window & Record<string, unknown>;
  if (win[MOBILE_DND_INSTALL_KEY]) return;
  win[MOBILE_DND_INSTALL_KEY] = true;

  let active: MobilePointerDrag | null = null;

  const finish = (event: PointerEvent, shouldDrop: boolean) => {
    if (!active || event.pointerId !== active.pointerId) return;
    const current = active;
    active = null;

    event.preventDefault();
    const target = mobileDropTargetAt(event.clientX, event.clientY, current.source) ?? current.overTarget;
    if (shouldDrop && target) {
      dispatchMobileDragEvent('drop', target, current.dataTransfer, event.clientX, event.clientY);
    }
    if (current.overTarget && current.overTarget !== target) {
      dispatchMobileDragEvent('dragleave', current.overTarget, current.dataTransfer, event.clientX, event.clientY, target);
    }
    dispatchMobileDragEvent('dragend', current.source, current.dataTransfer, event.clientX, event.clientY, target);
    removeMobileDragGhost(current.ghost);
    try {
      if (current.source.hasPointerCapture(event.pointerId)) current.source.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; older WebViews may not implement it.
    }
  };

  document.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || active) return;
    const source = findMobileHousekeeperSource(event.target);
    if (!source) return;

    // Housekeeper pills have no tap action today, so reserving the gesture for
    // assignment does not steal another control. Preventing the native gesture
    // here is what makes vertical drag reliable on Safari instead of scrolling.
    if (event.cancelable) event.preventDefault();

    const dataTransfer = createMobileDataTransfer();
    dispatchMobileDragEvent('dragstart', source, dataTransfer, event.clientX, event.clientY);

    // Defensive check: only continue if the existing React dragstart handler
    // actually populated a housekeeper payload. If markup changes later, this
    // bridge fails closed instead of turning another draggable into an assignee.
    if (!dataTransfer.getData('housekeeperid')) {
      dispatchMobileDragEvent('dragend', source, dataTransfer, event.clientX, event.clientY);
      return;
    }

    active = {
      pointerId: event.pointerId,
      source,
      dataTransfer,
      overTarget: null,
      ghost: createMobileDragGhost(source, event.clientX, event.clientY),
    };

    try { source.setPointerCapture(event.pointerId); } catch { /* optional */ }
  }, { passive: false, capture: true });

  document.addEventListener('pointermove', (event) => {
    if (!active || event.pointerId !== active.pointerId) return;
    if (event.cancelable) event.preventDefault();

    moveMobileDragGhost(active.ghost, event.clientX, event.clientY);
    autoScrollMobileDrag(event.clientY);

    const target = mobileDropTargetAt(event.clientX, event.clientY, active.source);
    if (target !== active.overTarget) {
      if (active.overTarget) {
        dispatchMobileDragEvent('dragleave', active.overTarget, active.dataTransfer, event.clientX, event.clientY, target);
      }
      if (target) {
        dispatchMobileDragEvent('dragenter', target, active.dataTransfer, event.clientX, event.clientY, active.overTarget);
      }
      active.overTarget = target;
    }
    if (target) {
      dispatchMobileDragEvent('dragover', target, active.dataTransfer, event.clientX, event.clientY);
    }
  }, { passive: false, capture: true });

  document.addEventListener('pointerup', (event) => finish(event, true), { passive: false, capture: true });
  document.addEventListener('pointercancel', (event) => finish(event, false), { passive: false, capture: true });
}

installMobileHousekeeperDragBridge();