import { parseRoomFlags } from './room-service-flags';
import { MEMORIES_GREEN_BOARD_MARKER } from './hotel-memories-housekeeping';

export interface ApprovalInstructionContext {
  snapshotAvailable: boolean;
  snapshotFrozen: boolean;
  snapshotSource: string | null;
  capturedAt: string | null;
  assignmentType: string;
  priority: number;
  towelChangeRequired: boolean;
  linenChangeRequired: boolean;
  collectExtraTowels: boolean;
  roomCleaningRequested: boolean;
  greenBoardRequested: boolean;
  managerInstruction: string;
  assignmentInstruction: string;
  bedInstruction: string | null;
  isDnd: boolean;
  floorNumber: number | null;
  guestNightsStayed: number | null;
  roomStatusAtBrief: string | null;
}

const LEGACY_GREEN_BOARD_MARKER = '[GREEN_BOARD]';
const TECHNICAL_MARKERS = /\[(?:GREEN_BOARD(?:_CLEAN_REQUEST)?|NO_BOARD(?:_NO_CLEANING)?|NO_SERVICE)\]/gi;
const SUPERVISOR_RECHECK_MARKER = /\[SUPERVISOR_RECHECK:([^\]]+)\]/gi;

/**
 * Approval cards are manager-facing operational records. Never expose the
 * bracket tokens used internally to transport housekeeping state.
 */
export function cleanOperationalInstruction(value: string | null | undefined): string {
  if (!value) return '';

  return value
    .replace(SUPERVISOR_RECHECK_MARKER, '$1')
    .replace(TECHNICAL_MARKERS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

function asNumber(value: unknown, fallback = 0): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function readBedInstruction(room: any): string | null {
  const metadata = room?.pms_metadata || {};
  const manual = metadata?.manualBedConfig?.value;
  const inferred = metadata?.inferredBedConfig?.value;
  const value = manual || inferred || room?.bed_configuration || null;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Resolve the exact briefing a housekeeper received. New assignments use the
 * immutable instruction_snapshot captured by the database lifecycle trigger.
 * Legacy assignments fall back to the joined room row so existing approvals
 * continue to work without pretending that mutable room data is historical.
 */
export function resolveApprovalInstructionContext(assignment: any): ApprovalInstructionContext {
  const snapshot = assignment?.instruction_snapshot;
  const snapshotRoom = snapshot?.room;
  const snapshotAvailable = Boolean(snapshot && snapshotRoom);
  const room = snapshotAvailable ? snapshotRoom : (assignment?.rooms || {});
  const assignmentNotes = snapshotAvailable
    ? (snapshot?.assignment_notes ?? '')
    : (assignment?.notes ?? '');
  const assignmentNoteText = typeof assignmentNotes === 'string' ? assignmentNotes : '';

  const parsedRoomNotes = parseRoomFlags(
    typeof room?.notes === 'string' ? room.notes : null,
  );

  return {
    snapshotAvailable,
    snapshotFrozen: asBoolean(snapshot?.frozen),
    snapshotSource: snapshotAvailable && typeof snapshot?.source === 'string' ? snapshot.source : null,
    capturedAt: snapshotAvailable && typeof snapshot?.captured_at === 'string' ? snapshot.captured_at : null,
    assignmentType: String(snapshotAvailable ? (snapshot?.assignment_type ?? assignment?.assignment_type ?? '') : (assignment?.assignment_type ?? '')),
    priority: asNumber(snapshotAvailable ? (snapshot?.priority ?? assignment?.priority) : assignment?.priority),
    towelChangeRequired: asBoolean(room?.towel_change_required),
    linenChangeRequired: asBoolean(room?.linen_change_required),
    collectExtraTowels: parsedRoomNotes.collectExtraTowels,
    roomCleaningRequested: parsedRoomNotes.roomCleaning,
    // Approval history is evidence, not a re-evaluation of today's policy.
    // Recognize both the current marker and the short legacy marker so older
    // assignments remain understandable after the marker was renamed.
    greenBoardRequested: assignmentNoteText.includes(MEMORIES_GREEN_BOARD_MARKER)
      || assignmentNoteText.includes(LEGACY_GREEN_BOARD_MARKER),
    managerInstruction: cleanOperationalInstruction(parsedRoomNotes.cleanNotes),
    assignmentInstruction: cleanOperationalInstruction(assignmentNoteText),
    bedInstruction: readBedInstruction(room),
    isDnd: asBoolean(room?.is_dnd),
    floorNumber: room?.floor_number == null ? null : asNumber(room.floor_number),
    guestNightsStayed: room?.guest_nights_stayed == null ? null : asNumber(room.guest_nights_stayed),
    roomStatusAtBrief: typeof room?.status === 'string' ? room.status : null,
  };
}
