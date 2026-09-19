// Comparison only. This module MUST NOT create, modify or cancel reservations.
// A matching ID/date/room within the requested window is not a guarantee that
// the full PMS or an OTA is synchronized.
export type IncomingReservation = {
  sourceRef: string;
  arrivalDate: string;
  departureDate: string;
  objId: string | null;
  statusId: number;
};

export type StoredReservation = {
  hotel_id: string;
  source: string;
  source_reservation_id: string | null;
  check_in_date: string;
  check_out_date: string;
  room_id: string | null;
  status: string;
};

export type ReservationReconciliation = {
  comparison: 'matched_within_window' | 'mismatch_within_window';
  window: { from: string; to: string };
  incoming: number;
  stored: number;
  missingInHotelCare: number;
  missingInPrevioResponse: number;
  duplicateIncomingIds: number;
  duplicateStoredIds: number;
  missingStoredIds: number;
  dateMismatches: number;
  roomMismatches: number;
  terminalStatusMismatches: number;
  unmappedPrevioRooms: number;
  unusuallyLongStays: number;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const TERMINAL = new Map([[7, 'cancelled'], [8, 'no_show']]);

export function reconcilePrevioReservations(
  propertyId: string,
  from: string,
  to: string,
  incoming: readonly IncomingReservation[],
  stored: readonly StoredReservation[],
  pmsRoomToHotelcareRoom: ReadonlyMap<string, string>,
): ReservationReconciliation {
  if (!propertyId || !ISO_DAY.test(from) || !ISO_DAY.test(to) || from >= to) {
    throw new Error('Invalid property or reconciliation window');
  }
  const remoteById = new Map<string, IncomingReservation>();
  let duplicateIncomingIds = 0;
  let unusuallyLongStays = 0;
  for (const row of incoming) {
    if (!row.sourceRef || !ISO_DAY.test(row.arrivalDate) || !ISO_DAY.test(row.departureDate) || row.arrivalDate >= row.departureDate) {
      throw new Error('Invalid Previo reservation identity or dates');
    }
    if (remoteById.has(row.sourceRef)) duplicateIncomingIds++;
    else remoteById.set(row.sourceRef, row);
    if ((Date.parse(row.departureDate) - Date.parse(row.arrivalDate)) / 86400000 > 366) unusuallyLongStays++;
  }

  const localById = new Map<string, StoredReservation>();
  let duplicateStoredIds = 0;
  let missingStoredIds = 0;
  for (const row of stored) {
    // Defend against an accidentally unscoped database response.
    if (row.hotel_id !== propertyId || row.source !== 'previo') throw new Error('Cross-property or non-Previo data in comparison');
    if (!row.source_reservation_id) { missingStoredIds++; continue; }
    if (localById.has(row.source_reservation_id)) duplicateStoredIds++;
    else localById.set(row.source_reservation_id, row);
  }

  let missingInHotelCare = 0;
  let dateMismatches = 0;
  let roomMismatches = 0;
  let terminalStatusMismatches = 0;
  let unmappedPrevioRooms = 0;
  for (const [ref, remote] of remoteById) {
    // This is a bounded window audit, not an all-history inventory assertion.
    if (remote.departureDate <= from || remote.arrivalDate >= to) continue;
    const mappedRoom = remote.objId ? pmsRoomToHotelcareRoom.get(remote.objId) : undefined;
    if (remote.objId && !mappedRoom) unmappedPrevioRooms++;
    const local = localById.get(ref);
    if (!local) { missingInHotelCare++; continue; }
    if (local.check_in_date !== remote.arrivalDate || local.check_out_date !== remote.departureDate) dateMismatches++;
    // An unassigned booking is not a proven mismatch. An unmapped source room
    // is counted separately; never guess by room number or building suffix.
    if (mappedRoom && local.room_id && local.room_id !== mappedRoom) roomMismatches++;
    const remoteTerminal = TERMINAL.get(remote.statusId);
    if (remoteTerminal && local.status !== remoteTerminal) terminalStatusMismatches++;
    if (!remoteTerminal && ['cancelled', 'no_show'].includes(local.status)) terminalStatusMismatches++;
  }

  let missingInPrevioResponse = 0;
  for (const [ref, local] of localById) {
    if (local.check_out_date > from && local.check_in_date < to && !remoteById.has(ref)) missingInPrevioResponse++;
  }
  const issues = [missingInHotelCare, missingInPrevioResponse, duplicateIncomingIds, duplicateStoredIds,
    missingStoredIds, dateMismatches, roomMismatches, terminalStatusMismatches,
    unmappedPrevioRooms, unusuallyLongStays];
  return {
    comparison: issues.some(Boolean) ? 'mismatch_within_window' : 'matched_within_window',
    window: { from, to }, incoming: remoteById.size, stored: localById.size,
    missingInHotelCare, missingInPrevioResponse, duplicateIncomingIds, duplicateStoredIds,
    missingStoredIds, dateMismatches, roomMismatches, terminalStatusMismatches,
    unmappedPrevioRooms, unusuallyLongStays,
  };
}
