export interface HistoricalHousekeepingRowLike {
  towel_change_required?: boolean | null;
  linen_change_required?: boolean | null;
  had_dnd?: boolean | null;
  is_dnd?: boolean | null;
  had_no_service?: boolean | null;
  room_notes?: string | null;
  assignment_notes?: string | null;
  final_state?: Record<string, unknown> | null;
  scheduled_service_due?: { towel?: boolean; change_room?: boolean; first_observed_at?: string } | null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Historical T/C must describe the final instruction for that business day,
 * not "this flag was true at any point". DND/No Service are encounter evidence,
 * so they intentionally remain cumulative.
 */
export function resolveHistoricalHousekeepingState(row: HistoricalHousekeepingRowLike) {
  const final = row.final_state || {};

  const towel = bool(final.towel_change_required_for_assignment)
    ?? bool(final.towel_change_required_at_close)
    ?? Boolean(row.towel_change_required);

  const changeRoom = bool(final.linen_change_required_for_assignment)
    ?? bool(final.linen_change_required_at_close)
    ?? Boolean(row.linen_change_required);

  const hadDnd = bool(final.had_dnd) ?? Boolean(row.had_dnd || row.is_dnd);
  const hadNoService = bool(final.had_no_service)
    ?? Boolean(row.had_no_service || row.assignment_notes?.includes('[NO_SERVICE]'));

  return {
    towel,
    changeRoom,
    // Recorded duty is independent of the final approved cleaning result.
    // Only Hotel Memories records this evidence. It must not imply that towels
    // or linen were physically changed or override the immutable final_state.
    scheduledTowel: row.scheduled_service_due?.towel === true,
    scheduledChangeRoom: row.scheduled_service_due?.change_room === true,
    hadDnd,
    hadNoService,
    roomNotes: text(final.room_notes_at_close) ?? row.room_notes ?? null,
    assignmentNotes: text(final.assignment_notes) ?? row.assignment_notes ?? null,
    managerInstruction: text(final.manager_instruction_text),
    finalized: Boolean(row.final_state),
  };
}
