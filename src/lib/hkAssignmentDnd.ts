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

let lastHousekeeperDrag: { payload: HousekeeperDragPayload; at: number } | null = null;

export function setHousekeeperDragPayload(e: React.DragEvent, payload: HousekeeperDragPayload) {
  lastHousekeeperDrag = { payload, at: Date.now() };
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

type AssignmentDropChoice = 'replace' | 'share';

type ExistingAssignmentRow = {
  id: string;
  assigned_to: string | null;
  shared_with: string | null;
  status: string | null;
};

async function resolveStaffName(staffId: string | null, fallback: string): Promise<string> {
  if (!staffId) return fallback;
  try {
    const { data } = await (supabase as any)
      .from('profiles')
      .select('full_name, nickname')
      .eq('id', staffId)
      .maybeSingle();
    return String(data?.nickname || data?.full_name || fallback).trim() || fallback;
  } catch {
    return fallback;
  }
}

async function resolveRoomNumber(roomId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('rooms')
      .select('room_number')
      .eq('id', roomId)
      .maybeSingle();
    return String((data as any)?.room_number || '').trim() || 'this room';
  } catch {
    return 'this room';
  }
}

/**
 * Explicit intent chooser for an occupied-room housekeeper drop.
 *
 * This is deliberately kept in the drag/drop library because the existing room
 * board already routes desktop and mobile pointer drops through
 * assignRoomToStaff(). It prevents an occupied drop from silently changing
 * meaning as shared cleaning is introduced.
 */
function askAssignmentDropChoice(params: {
  roomNumber: string;
  currentName: string;
  incomingName: string;
  inProgress: boolean;
}): Promise<AssignmentDropChoice> {
  if (typeof document === 'undefined' || !document.body) {
    // Non-interactive callers preserve the legacy takeover behavior. The choice
    // UI is specifically for manager drag/drop interactions in the browser.
    return Promise.resolve('replace');
  }

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `Assign room ${params.roomNumber}`);
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      background: 'rgba(15, 23, 42, 0.48)',
      backdropFilter: 'blur(2px)',
    });

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      width: 'min(460px, 100%)',
      borderRadius: '14px',
      background: 'var(--background, #fff)',
      color: 'var(--foreground, #0f172a)',
      border: '1px solid rgba(148, 163, 184, 0.35)',
      boxShadow: '0 24px 70px rgba(15, 23, 42, 0.28)',
      padding: '20px',
      fontFamily: 'inherit',
    });

    const title = document.createElement('div');
    title.textContent = `Room ${params.roomNumber} already has a housekeeper`;
    Object.assign(title.style, { fontSize: '17px', fontWeight: '700', marginBottom: '8px' });

    const description = document.createElement('div');
    description.textContent = params.inProgress
      ? `${params.currentName} has already started this room. ${params.incomingName} can join as the second cleaner, but the active assignment cannot be replaced.`
      : `${params.currentName} is currently assigned. What should happen when ${params.incomingName} is dropped onto this room?`;
    Object.assign(description.style, { fontSize: '14px', lineHeight: '1.5', opacity: '0.82', marginBottom: '14px' });

    const help = document.createElement('div');
    help.textContent = params.inProgress
      ? 'Work together keeps one shared room status, minibar record and dirty-linen record.'
      : `Replace moves the room from ${params.currentName} to ${params.incomingName}. Work together keeps ${params.currentName} and adds ${params.incomingName} as the second cleaner.`;
    Object.assign(help.style, {
      fontSize: '12px',
      lineHeight: '1.45',
      padding: '10px 12px',
      borderRadius: '9px',
      background: 'rgba(148, 163, 184, 0.12)',
      marginBottom: '16px',
    });

    const actions = document.createElement('div');
    Object.assign(actions.style, { display: 'grid', gridTemplateColumns: params.inProgress ? '1fr' : '1fr 1fr', gap: '10px' });

    const finish = (choice: AssignmentDropChoice) => {
      overlay.remove();
      resolve(choice);
    };

    if (!params.inProgress) {
      const replace = document.createElement('button');
      replace.type = 'button';
      replace.textContent = `Replace ${params.currentName}`;
      Object.assign(replace.style, {
        minHeight: '44px',
        borderRadius: '9px',
        border: '1px solid rgba(148, 163, 184, 0.55)',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontWeight: '650',
        cursor: 'pointer',
        padding: '9px 12px',
      });
      replace.addEventListener('click', () => finish('replace'));
      actions.appendChild(replace);
    }

    const share = document.createElement('button');
    share.type = 'button';
    share.textContent = 'Work together';
    Object.assign(share.style, {
      minHeight: '44px',
      borderRadius: '9px',
      border: '1px solid transparent',
      background: 'hsl(var(--primary, 221 83% 53%))',
      color: 'hsl(var(--primary-foreground, 0 0% 100%))',
      font: 'inherit',
      fontWeight: '700',
      cursor: 'pointer',
      padding: '9px 12px',
    });
    share.addEventListener('click', () => finish('share'));
    actions.appendChild(share);

    panel.append(title, description, help, actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    setTimeout(() => (params.inProgress ? share : actions.querySelector('button'))?.focus(), 0);
  });
}

async function shareRoomWithStaff(params: {
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
  if (result?.ok === false) throw new Error(result?.code || 'Unable to assign housekeeper to room');
}

async function replaceRoomAssignee(existing: ExistingAssignmentRow, params: {
  staffId: string;
  assignedBy: string;
}): Promise<void> {
  if (existing.status === 'in_progress') {
    throw new AssignmentInProgressError(existing.assigned_to);
  }

  // Replacement is intentionally explicit and race-safe. It only succeeds if
  // the room still has one cleaner and has not started while the manager was
  // choosing. If the room changed meanwhile, the manager gets a safe failure
  // rather than silently overwriting a live/shared assignment.
  const { data, error } = await (supabase as any)
    .from('room_assignments')
    .update({
      assigned_to: params.staffId,
      assigned_by: params.assignedBy,
      shared_with: null,
      shared_assigned_at: null,
      shared_assigned_by: null,
    })
    .eq('id', existing.id)
    .neq('status', 'in_progress')
    .is('shared_with', null)
    .select('id');

  if (error) throw error;
  if (Array.isArray(data) && data.length > 0) return;

  const { data: fresh } = await (supabase as any)
    .from('room_assignments')
    .select('assigned_to, shared_with, status')
    .eq('id', existing.id)
    .maybeSingle();
  if (fresh?.status === 'in_progress') throw new AssignmentInProgressError(fresh.assigned_to ?? existing.assigned_to);
  if (fresh?.shared_with) throw new SharedAssignmentFullError(fresh.assigned_to ?? existing.assigned_to, fresh.shared_with);
  throw new Error('Room assignment changed before replacement could be applied');
}

/**
 * Assign a dropped housekeeper without making the occupied-room gesture
 * ambiguous.
 *
 * - Empty room: assign immediately.
 * - Same cleaner: no-op.
 * - One existing cleaner + real drag/drop: ask Replace vs Work together.
 * - Already shared by two: reject a third cleaner.
 * - If cleaning has started, replacement is blocked; sharing remains a valid
 *   database operation for callers that do not pre-block active-room drops.
 *
 * Non-drag callers preserve the historic replacement behavior so automated or
 * programmatic assignment flows never get stuck behind a browser dialog.
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
  const { data: existingData, error: existingError } = await (supabase as any)
    .from('room_assignments')
    .select('id, assigned_to, shared_with, status')
    .eq('room_id', params.roomId)
    .eq('assignment_date', params.assignmentDate)
    .maybeSingle();
  if (existingError) throw existingError;

  const existing = (existingData || null) as ExistingAssignmentRow | null;
  if (!existing) {
    await shareRoomWithStaff(params);
    return;
  }

  if (existing.assigned_to === params.staffId || existing.shared_with === params.staffId) return;
  if (existing.shared_with) {
    throw new SharedAssignmentFullError(existing.assigned_to, existing.shared_with);
  }

  const isInteractiveDrag = !!lastHousekeeperDrag
    && lastHousekeeperDrag.payload.staffId === params.staffId
    && Date.now() - lastHousekeeperDrag.at < 15_000;

  if (!isInteractiveDrag) {
    await replaceRoomAssignee(existing, params);
    return;
  }

  const incomingFallback = lastHousekeeperDrag?.payload.staffName || 'the new housekeeper';
  const [roomNumber, currentName, incomingName] = await Promise.all([
    resolveRoomNumber(params.roomId),
    resolveStaffName(existing.assigned_to, 'the current housekeeper'),
    resolveStaffName(params.staffId, incomingFallback),
  ]);

  const choice = await askAssignmentDropChoice({
    roomNumber,
    currentName,
    incomingName,
    inProgress: existing.status === 'in_progress',
  });

  // Consume the drag marker so a later programmatic assignment cannot inherit
  // an old UI decision context.
  lastHousekeeperDrag = null;

  if (choice === 'replace') {
    await replaceRoomAssignee(existing, params);
    return;
  }

  await shareRoomWithStaff(params);
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