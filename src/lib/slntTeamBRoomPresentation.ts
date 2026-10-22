import { displayHousekeepingBedSetup } from './housekeepingBedSetup';
import { housekeeperVisibleAssignmentNote } from './housekeeperVisibleAssignmentNote';
import { parseRoomFlags } from './room-service-flags';

export type SlntPlannedInstruction = { content: string; instruction_type: string };
export type SlntRoomCardDetails = {
  room_number: string;
  notes: string | null;
  pms_metadata: Record<string, unknown> | null;
  bed_configuration: string | null;
  assignment_notes: string | null;
  manager_instruction_text: string | null;
  planned_notes: SlntPlannedInstruction[] | null;
};

type InferredBed = { value?: unknown; bedConfiguration?: unknown };

const CLEANING_NOTE_HEADER = /^(?:Housekeeping|Takar[ií]t[aá]s|H[oó]zvezet[ée]s)\s*:/i;
const PMS_SECTION_HEADER = /(?:Recepce|Reception|Kuchyn[ěe]|Kitchen|Syst[ée]m|Poznámka)\s*:/i;

/** Reuse the same manager/PMS/bed sources as the actual RD room card.
 * Do not show technical flags, raw reservation blobs, or invent a note when
 * the PMS has supplied none. This is preview-only; the full room card is
 * still used after an atomic claim.
 */
export function slntTeamBRoomInstructions(room: SlntRoomCardDetails) {
  const flags = parseRoomFlags(room.notes);
  const raw = flags.cleanNotes.replace(/\[(?:DND|NO_SERVICE)\]/gi, '').trim();
  let managerRoomNote = raw;
  if (PMS_SECTION_HEADER.test(raw) || /Housekeeping\s*:/i.test(raw)) {
    managerRoomNote = raw.split(/\s•\s|\s\|\s/)
      .filter(part => CLEANING_NOTE_HEADER.test(part.trim()))
      .map(part => part.trim().replace(/^[^:]+:\s*/, ''))
      .filter(Boolean).join(' • ');
  }
  const meta = room.pms_metadata || {};
  const inferred = meta.inferredBedConfig as InferredBed | undefined;
  const bedRaw = [inferred?.value, inferred?.bedConfiguration, room.bed_configuration]
    .find(value => typeof value === 'string' && value.trim()) as string | undefined;
  const bedInstruction = displayHousekeepingBedSetup(bedRaw, 'slnt-group');
  const previo = typeof meta.slntPrevioHousekeepingNote === 'string'
    ? meta.slntPrevioHousekeepingNote.trim() : '';
  const assignmentNote = housekeeperVisibleAssignmentNote(room.assignment_notes, 'slnt-group');
  const manual = (room.manager_instruction_text || '').trim();
  const notes: Array<{ kind: 'manager' | 'previo' | 'assignment' | 'planned'; text: string; label?: string }> = [];
  const seen = new Set<string>();
  const add = (kind: 'manager' | 'previo' | 'assignment' | 'planned', text: string, label?: string) => {
    const normalized = text.trim();
    if (!normalized || seen.has(normalized.toLowerCase())) return;
    seen.add(normalized.toLowerCase());
    notes.push({ kind, text: normalized, label });
  };
  add('manager', manual);
  add('manager', managerRoomNote);
  add('previo', previo);
  add('assignment', assignmentNote);
  for (const planned of room.planned_notes || []) {
    if (typeof planned.content === 'string')
      add('planned', planned.content, planned.instruction_type);
  }
  return {
    bedInstruction,
    notes,
    roomCleaning: flags.roomCleaning,
    collectExtraTowels: flags.collectExtraTowels,
  };
}
