/** Historical chips must be derived from their dated snapshot, never today's mutable room. */
export interface HistoricalRoomSnapshot {
  is_checkout_room?: boolean | null;
  towel_change_required?: boolean | null;
  linen_change_required?: boolean | null;
  room_notes?: string | null;
  bed_configuration?: string | null;
  pms_metadata?: Record<string, unknown> | null;
  final_state?: Record<string, unknown> | null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 'true';
}

export function frozenPreviousRoomService(
  snapshot: HistoricalRoomSnapshot | null | undefined,
  previousAssignmentType: string,
) {
  const final = snapshot?.final_state || {};
  const isCheckout = booleanValue(
    final.is_checkout_room_at_close ?? snapshot?.is_checkout_room ?? (previousAssignmentType === 'checkout_cleaning'),
  );
  return {
    isCheckout,
    towelChangeRequired: !isCheckout && booleanValue(
      final.towel_change_required_for_assignment
        ?? final.towel_change_required_at_close
        ?? snapshot?.towel_change_required,
    ),
    linenChangeRequired: !isCheckout && booleanValue(
      final.linen_change_required_for_assignment
        ?? final.linen_change_required_at_close
        ?? snapshot?.linen_change_required,
    ),
    notes: (final.room_notes_at_close ?? snapshot?.room_notes ?? null) as string | null,
    bedConfiguration: snapshot?.bed_configuration || null,
    pmsMetadata: (final.pms_metadata_at_close ?? snapshot?.pms_metadata ?? null) as Record<string, unknown> | null,
  };
}
