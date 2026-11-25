/**
 * Per-hotel NTAK reservation boundary. In profiled_only mode an assigned room
 * must have an ACTIVE unit profile. A room type is used only while no room
 * has been assigned; a mapped type never overrides an unprofiled room.
 */
export interface NtakScopedReservation {
  room_id?: string | null;
  room_type_id?: string | null;
}
export interface NtakScope {
  mode: 'all' | 'profiled_only';
  roomIds: Set<string>;
  roomTypeIds: Set<string>;
}

export function isInNtakScope(scope: NtakScope, reservation: NtakScopedReservation): boolean {
  if (scope.mode === 'all') return true;
  if (reservation.room_id) return scope.roomIds.has(reservation.room_id);
  return !!reservation.room_type_id && scope.roomTypeIds.has(reservation.room_type_id);
}

export async function loadNtakScope(
  db: any,
  settings: { hotel_id: string; unit_scope?: 'all' | 'profiled_only' | null },
): Promise<NtakScope> {
  if (settings.unit_scope !== 'profiled_only') {
    return { mode: 'all', roomIds: new Set(), roomTypeIds: new Set() };
  }
  const [profiles, types] = await Promise.all([
    db.from('ntak_unit_profiles').select('room_id').eq('hotel_id', settings.hotel_id).eq('active', true),
    db.from('ntak_room_type_units').select('room_type_id').eq('hotel_id', settings.hotel_id).eq('active', true),
  ]);
  if (profiles.error || types.error) throw new Error('Unable to load NTAK unit scope');
  return {
    mode: 'profiled_only',
    roomIds: new Set((profiles.data ?? []).map((p: { room_id: string }) => p.room_id)),
    roomTypeIds: new Set((types.data ?? []).map((t: { room_type_id: string }) => t.room_type_id)),
  };
}
