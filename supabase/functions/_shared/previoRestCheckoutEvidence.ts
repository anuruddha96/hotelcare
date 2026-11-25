/**
 * Parse independently fetched Previo REST reservation records for a verified
 * same-day completed departure. This is Gozsdu-only: never infer a physical
 * checkout from an expected departure time, new arrival or dirty-room status.
 */
export type RestCheckoutEvidence = { objId: number; roomName: string; reservationId: string };
export type RestCheckoutAudit = { roomId: number; status: string; evidence: boolean };
type RecordValue = Record<string, unknown>;
const asRecord = (v: unknown): RecordValue | null =>
  v && typeof v === "object" && !Array.isArray(v) ? v as RecordValue : null;
const day = (v: unknown): string => String(v ?? "").match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
const statusNumber = (v: unknown): number => {
  const candidate = asRecord(v);
  const value = candidate ? candidate.id ?? candidate.value : v;
  const n = Number(value);
  return Number.isInteger(n) ? n : 0;
};
export function reservationList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const obj = asRecord(payload);
  if (!obj) return [];
  if (Array.isArray(obj.data)) return obj.data;
  if (Array.isArray(obj.reservations)) return obj.reservations;
  if (Array.isArray(obj.items)) return obj.items;
  if (Array.isArray(obj.results)) return obj.results;
  const data = asRecord(obj.data);
  if (data) return reservationList(data);
  return [];
}
export function verifiedGozsduRestCheckouts(
  payload: unknown,
  businessDate: string,
  knownPhysicalRooms: ReadonlyMap<number, string>,
  locallyMappedRoomIds: ReadonlySet<number>,
  explicitlyInHouseRoomIds: ReadonlySet<number>,
): { checkouts: RestCheckoutEvidence[]; audits: RestCheckoutAudit[]; total: number } {
  const entries = reservationList(payload);
  const checkouts: RestCheckoutEvidence[] = [];
  const audits: RestCheckoutAudit[] = [];
  const seen = new Set<number>();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return { checkouts, audits, total: entries.length };
  for (const raw of entries) {
    const record = asRecord(raw);
    if (!record) continue;
    // A multi-room booking-wide status cannot prove a specific unit departed.
    const assigned = record.roomReservations ?? record.reservationRooms ?? record.rooms;
    if (Array.isArray(assigned) && assigned.length > 1) continue;
    const item = Array.isArray(assigned) && assigned.length === 1 ? asRecord(assigned[0]) : null;
    const physical = asRecord(record.room) ?? asRecord(record.object)
      ?? asRecord(item?.room) ?? asRecord(item?.object);
    const idRaw = item?.roomId ?? item?.objId ?? item?.room_id
      ?? record.roomId ?? record.objId ?? record.room_id ?? record.objectId
      ?? physical?.roomId ?? physical?.objId;
    const objId = Number(idRaw);
    if (!Number.isSafeInteger(objId) || objId <= 0 || !locallyMappedRoomIds.has(objId)) continue;
    const rosterName = knownPhysicalRooms.get(objId);
    if (!rosterName) continue;
    const reportedName = String(item?.roomName ?? record.roomName ?? record.objectName ?? physical?.name ?? "").trim();
    if (reportedName && reportedName !== rosterName) continue;
    const departure = day(item?.departureDate ?? record.departureDate ?? record.departure
      ?? record.to ?? record.checkOutDate ?? record.checkOut);
    const status = statusNumber(item?.roomReservationStatusId ?? item?.statusId
      ?? record.roomReservationStatusId ?? record.statusId ?? record.reservationStatusId
      ?? record.cosId ?? record.status);
    const positive = item?.checkedOut === true || item?.isCheckedOut === true
      || record.checkedOut === true || record.isCheckedOut === true
      || status === 6 || status === 9
      || (day(item?.checkedOutAt ?? record.checkedOutAt ?? record.actualCheckOutAt) === businessDate);
    const evidence = departure === businessDate
      && positive && !explicitlyInHouseRoomIds.has(objId);
    audits.push({ roomId: objId, status: String(status || "unknown"), evidence });
    if (!evidence || seen.has(objId)) continue;
    seen.add(objId);
    checkouts.push({
      objId, roomName: rosterName,
      reservationId: String(item?.reservationId ?? record.reservationId ?? record.resId ?? record.id ?? ""),
    });
  }
  return { checkouts, audits, total: entries.length };
}
