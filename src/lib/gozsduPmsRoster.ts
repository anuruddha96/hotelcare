import { getGozsduHousekeepingCycle, type GozsduHousekeepingService } from './gozsdu-housekeeping';
import { readGozsduRoomOverride } from './gozsduRoomBucketOverride';

export type GozsduPmsRow = {
  room_label: string | null;
  room_number: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  status: string | null;
  housekeeping_dep: string | null;
  captured_at: string | null;
};
export type GozsduRosterEntry = {
  bucket: 'checkout' | 'service' | 'other' | 'noshow';
  service: GozsduHousekeepingService;
  night: number;
  totalNights: number;
  leavesTomorrow: boolean;
};

type LocalRoom = { id: string; room_number: string; pms_metadata?: any };
type RegistryEntry = { room_id: string; pms_room_name: string; service_status: string };
const key = (name: string | null | undefined) => String(name ?? '').normalize('NFKC').trim().toLowerCase();
const day = (date: string | null | undefined) => date && /^\d{4}-\d{2}-\d{2}$/.test(date)
  ? Date.parse(`${date}T00:00:00Z`) / 86400000 : NaN;

/** Read-only, all-or-nothing reconciliation. Never manufacture an operational checkout from a sparse poll. */
export function reconcileGozsduPmsRoster(
  rooms: LocalRoom[], registry: RegistryEntry[], snapshots: GozsduPmsRow[],
  selectedDate: string, now = Date.now(),
): { byRoom: Map<string, GozsduRosterEntry>; capturedAt: string } {
  if (!rooms.length || registry.length !== rooms.length || snapshots.length !== registry.length) {
    throw new Error(`Gozsdu PMS room coverage is incomplete (${snapshots.length} snapshot / ${registry.length} registered / ${rooms.length} local).`);
  }
  const roomsById = new Map(rooms.map(room => [room.id, room]));
  const byName = new Map<string, string>();
  for (const entry of registry) {
    const alias = key(entry.pms_room_name);
    if (!alias || !roomsById.has(entry.room_id) || byName.has(alias)) throw new Error('Gozsdu PMS room registry has an incomplete or duplicate mapping.');
    byName.set(alias, entry.room_id);
  }
  const byRoom = new Map<string, GozsduRosterEntry>();
  let latest = '';
  let oldest = Number.POSITIVE_INFINITY;
  for (const row of snapshots) {
    const roomId = byName.get(key(row.room_label));
    if (!roomId || byRoom.has(roomId)) throw new Error(`Gozsdu PMS room is missing, duplicated or unmapped: ${row.room_label || 'unknown'}.`);
    const stamp = row.captured_at ? Date.parse(row.captured_at) : NaN;
    if (!Number.isFinite(stamp) || stamp > now + 60000) throw new Error('Gozsdu PMS snapshot is missing a valid capture time.');
    oldest = Math.min(oldest, stamp);
    if (!latest || row.captured_at! > latest) latest = row.captured_at!;
    const room = roomsById.get(roomId)!;
    const arrival = day(row.arrival_date);
    const departure = day(row.departure_date);
    const selected = day(selectedDate);
    if (![arrival, departure, selected].every(Number.isFinite) || departure < selected || arrival > selected || arrival >= departure) {
      throw new Error(`Gozsdu PMS stay dates are inconsistent for ${row.room_label}.`);
    }
    const isCheckout = row.departure_date === selectedDate || row.status === 'departing'
      || String(row.housekeeping_dep || '').toUpperCase() === 'DEP';
    const night = selected - arrival + 1;
    const totalNights = departure - arrival;
    const registryEntry = registry.find(entry => entry.room_id === roomId)!;
    const noShow = !isCheckout && room.pms_metadata?.isNoShow === true && row.status !== 'ongoing';
    const computedService = isCheckout || noShow || registryEntry.service_status !== 'operating'
      ? 'none' : getGozsduHousekeepingCycle({ currentNight: night, totalNights, isCheckout }).service;
    // Manual cleaning plans are date-scoped and do not modify PMS stay facts.
    // Never turn a no-show or unavailable room into an operational task.
    const override = !noShow && registryEntry.service_status === 'operating'
      ? readGozsduRoomOverride(room.pms_metadata, selectedDate) : null;
    const service = override?.service ?? computedService;
    byRoom.set(roomId, {
      bucket: override?.bucket ?? (isCheckout ? 'checkout' : noShow ? 'noshow' : service !== 'none' ? 'service' : 'other'),
      service, night, totalNights, leavesTomorrow: row.departure_date === new Date((selected + 1) * 86400000).toISOString().slice(0, 10),
    });
  }
  if (byRoom.size !== rooms.length) throw new Error('Gozsdu PMS snapshot has unmapped local rooms.');
  if (now - oldest > 60 * 60 * 1000 || Date.parse(latest) - oldest > 15 * 60 * 1000) {
    throw new Error('Gozsdu PMS snapshot is stale or mixes sync batches. Refresh the selected day in Previo.');
  }
  return { byRoom, capturedAt: latest };
}

/** Tomorrow may omit a currently departing vacant room, but never an unknown/unmapped guest room. */
export function verifyGozsduTomorrowCoverage(
  registryNames: string[], today: Array<{ room_label: string | null; departure_date: string | null; captured_at: string | null }>,
  tomorrow: Array<{ room_label: string | null; captured_at: string | null }>, todayDate: string,
): boolean {
  const registered = new Set(registryNames.map(key));
  if (registered.size !== registryNames.length || registered.has('') || today.length !== registryNames.length || !tomorrow.length) return false;
  const seenToday = new Set<string>();
  const departedToday = new Set<string>();
  for (const row of today) {
    const label = key(row.room_label);
    if (!registered.has(label) || seenToday.has(label) || !row.captured_at) return false;
    seenToday.add(label);
    if (row.departure_date === todayDate) departedToday.add(label);
  }
  const seenTomorrow = new Set<string>();
  for (const row of tomorrow) {
    const label = key(row.room_label);
    if (!registered.has(label) || seenTomorrow.has(label) || !row.captured_at) return false;
    seenTomorrow.add(label);
  }
  // Every missing unit must have a date-matched scheduled departure in the full previous-day feed.
  return [...registered].every(label => seenTomorrow.has(label) || departedToday.has(label));
}
