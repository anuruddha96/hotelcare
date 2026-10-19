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
  business_date?: string | null;
};
export type GozsduRosterEntry = {
  bucket: 'checkout' | 'service' | 'other' | 'noshow' | 'arrival' | 'vacant';
  incomingToday?: boolean;
  evidence?: 'night_snapshot' | 'day_arrival' | 'next_day_arrival' | 'explicit_checkout' | 'verified_unsold' | 'confirmed_no_show';
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

/**
 * A room that starts a new stay today belongs to the arrivals bucket even when
 * the guest has already checked in. Previo can legitimately expose those
 * arrivals with status 1 or 3; requiring status 2/notArrived caused valid
 * same-day arrivals to make the whole Gozsdu roster fail closed.
 */
export function isGozsduAwaitingArrival(room: LocalRoom, selectedDate: string): boolean {
  const pms = room.pms_metadata;
  if (!pms || pms.pmsSyncDate !== selectedDate || pms.arrivalToday !== true) return false;
  const statusId = Number(pms.reservationStatusId);
  return Number.isFinite(statusId)
    && ![7, 8, 9].includes(statusId)
    && pms.isNoShow !== true
    && pms.isCancelled !== true
    && pms.checkedOutToday !== true
    && pms.scheduledDepartureToday !== true;
}

/** Only explicit, date-matched room metadata qualifies as a metadata no-show. */
export function isGozsduNoShow(room: LocalRoom, selectedDate: string): boolean {
  const pms = room.pms_metadata;
  if (!pms || pms.pmsSyncDate !== selectedDate) return false;
  const status = Number(pms.reservationStatusId);
  // A stale inference can coexist with an actual Previo checked-in status.
  // Never promote that contradiction into a confirmed no-show.
  return (status === 8 || (pms.isNoShow === true && pms.noShowSource === 'previo_status_8'))
    && ![3, 5, 6, 9].includes(status)
    && pms.isCancelled !== true
    && pms.occupiedToday !== true
    && pms.checkedOutToday !== true;
}

/**
 * The exact-day occupied-night feed intentionally excludes some same-day events.
 * Use an independent, date-matched Previo *room* sync only when it explicitly
 * proves a checkout or verified unsold room. Unrecognized absences still fail
 * closed; the missing room is NEVER assumed vacant just because it is absent.
 */
const MAX_SUPPLEMENT_AGE_MS = 2 * 60 * 60 * 1000;

function recentSameDayRoomEvidence(room: LocalRoom, selectedDate: string, now: number): boolean {
  const pms = room.pms_metadata;
  if (!pms || pms.pmsProvider !== 'previo' || pms.pmsSyncDate !== selectedDate) return false;
  const stamp = Date.parse(String(pms.lastServerMorningSyncAt || ''));
  return Number.isFinite(stamp) && stamp <= now + 60_000 && now - stamp <= MAX_SUPPLEMENT_AGE_MS;
}

export function isGozsduVerifiedCheckout(room: LocalRoom, selectedDate: string, now = Date.now()): boolean {
  const pms = room.pms_metadata;
  if (!recentSameDayRoomEvidence(room, selectedDate, now)) return false;
  const checkoutStamp = Date.parse(String(pms.checkedOutAt || ''));
  return pms.checkedOutToday === true && pms.scheduledDepartureToday === true
    && pms.departureDate === selectedDate
    && pms.isNoShow !== true && pms.isCancelled !== true
    && Number.isFinite(checkoutStamp) && checkoutStamp <= now + 60_000;
}

export function isGozsduVerifiedUnsold(room: LocalRoom, selectedDate: string, now = Date.now()): boolean {
  const pms = room.pms_metadata;
  if (!recentSameDayRoomEvidence(room, selectedDate, now)) return false;
  const stamp = Date.parse(String(pms.pmsVacancyVerifiedAt || ''));
  return pms.pmsOccupancyStatus === 'unsold'
    && pms.pmsVacancyEvidence === 'current_previo_reservation_snapshot_and_physical_room_roster'
    && pms.reservationId == null && pms.occupiedToday === false
    && pms.arrivalToday === false && pms.checkedOutToday === false
    && pms.isNoShow !== true
    && Number.isFinite(stamp) && stamp <= now + 60_000
    && now - stamp <= MAX_SUPPLEMENT_AGE_MS;
}

/** Identify a sparse selected-day feed without equating a missing row to a vacant or unavailable room. */
export function missingGozsduPmsRooms(registry: RegistryEntry[], snapshots: GozsduPmsRow[]): string[] {
  const observed = new Set(snapshots.map(row => key(row.room_label)));
  return registry.filter(entry => !observed.has(key(entry.pms_room_name)))
    .map(entry => entry.pms_room_name);
}

/** Read-only reconciliation. Same-day arrivals/no-shows may be absent from the occupied-night snapshot.
 * Rehydrate ONLY rooms with explicit date-matched Previo flags.
 * Unknown gaps, duplicates and stale batches still fail closed. */
export function reconcileGozsduPmsRoster(
  rooms: LocalRoom[], registry: RegistryEntry[], snapshots: GozsduPmsRow[],
  selectedDate: string, now = Date.now(), nextDaySnapshots: GozsduPmsRow[] = [],
): { byRoom: Map<string, GozsduRosterEntry>; capturedAt: string } {
  if (!rooms.length || registry.length !== rooms.length) {
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
  const selected = day(selectedDate);
  const nextDate = new Date((selected + 1) * 86400000).toISOString().slice(0, 10);
  // Occupied-night snapshots represent the night BEFORE business_date.
  // A newly arriving guest first appears in tomorrow's row, not today's.
  const incoming = new Map<string, GozsduPmsRow>();
  const ambiguousIncoming = new Set<string>();
  for (const row of nextDaySnapshots) {
    const roomId = byName.get(key(row.room_label));
    const stamp = Date.parse(String(row.captured_at || ''));
    if (!roomId || row.business_date !== nextDate || row.arrival_date !== selectedDate
      || !row.departure_date || row.departure_date <= selectedDate
      || !['ongoing', 'departing'].includes(String(row.status || '').toLowerCase())
      || !Number.isFinite(stamp) || stamp > now + 60000 || now - stamp > 60 * 60 * 1000)
      continue;
    if (incoming.has(roomId)) { incoming.delete(roomId); ambiguousIncoming.add(roomId); }
    else if (!ambiguousIncoming.has(roomId)) incoming.set(roomId, row);
  }
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
    // A selected-day snapshot that explicitly says no-show is authoritative.
    // Date-matched room metadata is the fallback when Previo omits that row.
    const noShow = String(row.status || '').toLowerCase() === 'no_show' || isGozsduNoShow(room, selectedDate);
    const isCheckout = !noShow && (row.departure_date === selectedDate || row.status === 'departing'
      || String(row.housekeeping_dep || '').toUpperCase() === 'DEP');
    const awaitingArrival = !isCheckout && !noShow && isGozsduAwaitingArrival(room, selectedDate);
    const night = selected - arrival + 1;
    const totalNights = departure - arrival;
    const registryEntry = registry.find(entry => entry.room_id === roomId)!;
    const computedService = isCheckout || noShow || awaitingArrival || registryEntry.service_status !== 'operating'
      ? 'none' : getGozsduHousekeepingCycle({ currentNight: night, totalNights, isCheckout }).service;
    // Manual cleaning plans are date-scoped and do not modify PMS stay facts.
    // Never turn a no-show, same-day arrival or unavailable room into an operational task.
    const override = !noShow && !awaitingArrival && registryEntry.service_status === 'operating'
      ? readGozsduRoomOverride(room.pms_metadata, selectedDate) : null;
    const service = override?.service ?? computedService;
    byRoom.set(roomId, {
      bucket: noShow ? 'noshow' : isCheckout ? 'checkout' : awaitingArrival ? 'arrival' : override?.bucket ?? (service !== 'none' ? 'service' : 'other'),
      service, night, totalNights, leavesTomorrow: row.departure_date === nextDate,
      incomingToday: incoming.has(roomId), evidence: noShow ? 'confirmed_no_show' : 'night_snapshot',
    });
  }
  // The occupied-night feed intentionally omits some reservations whose stay
  // starts today and can also omit an explicit no-show. Never infer either state
  // from absence alone: only fresh Previo room metadata may rehydrate the room.
  for (const entry of registry) {
    if (byRoom.has(entry.room_id)) continue;
    const room = roomsById.get(entry.room_id)!;
    const noShow = isGozsduNoShow(room, selectedDate);
    const fromTomorrow = !noShow && incoming.has(entry.room_id);
    const arrival = !noShow && (fromTomorrow || isGozsduAwaitingArrival(room, selectedDate));
    // An arrival supported by the new booking's own stay dates supersedes the
    // old reservation's mutable checkout flag. Active checkout work stays
    // visible independently on the UI.
    const checkout = !noShow && !arrival && isGozsduVerifiedCheckout(room, selectedDate, now);
    const unsold = !noShow && !arrival && !checkout
      && isGozsduVerifiedUnsold(room, selectedDate, now);
    if (!noShow && !arrival && !checkout && !unsold) {
      const missing = missingGozsduPmsRooms(registry, snapshots);
      throw new Error(`Gozsdu PMS room coverage is incomplete (${snapshots.length} snapshot / ${registry.length} registered / ${rooms.length} local). Missing from selected-day PMS: ${missing.join(', ')}. Their operating status is unchanged; booking and occupancy are UNKNOWN until verified in Previo.`);
    }
    byRoom.set(entry.room_id, {
      bucket: noShow ? 'noshow' : arrival ? 'arrival' : checkout ? 'checkout' : 'vacant',
      service: 'none',
      night: unsold ? 0 : 1,
      totalNights: unsold ? 0 : fromTomorrow
        ? Math.max(1, day(incoming.get(entry.room_id)?.departure_date) - selected)
        : Math.max(1, Number(room.pms_metadata.totalNights) || 1),
      leavesTomorrow: arrival && (fromTomorrow
        ? incoming.get(entry.room_id)?.departure_date === nextDate
        : Number(room.pms_metadata.totalNights) === 1),
      incomingToday: fromTomorrow,
      evidence: noShow ? 'confirmed_no_show' : fromTomorrow ? 'next_day_arrival'
        : arrival ? 'day_arrival' : checkout ? 'explicit_checkout' : 'verified_unsold',
    });
  }
  if (byRoom.size !== rooms.length) throw new Error('Gozsdu PMS snapshot has unmapped local rooms.');
  if (!latest || now - oldest > 60 * 60 * 1000 || Date.parse(latest) - oldest > 15 * 60 * 1000) {
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
