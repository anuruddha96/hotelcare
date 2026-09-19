// Previo daily overview is a point-in-time observation, NOT a reservation API.
// There is no external reservation ID in daily_overview_snapshots. Never equate
// a room/date signature with a confirmed booking identity or mutate either side.
export interface ReceptionSnapshot {
  id: string;
  hotel_id: string;
  captured_at: string;
  business_date: string;
  room_label: string | null;
  room_number: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  guest_names: string | null;
  status: string | null;
  [field: string]: unknown;
}

export interface ReceptionRoom {
  id: string;
  room_number: string;
}

export interface ReceptionReservation {
  id: string;
  hotel_id?: string | null;
  source?: string | null;
  room_id?: string | null;
  check_in_date: string;
  check_out_date: string;
  status?: string | null;
}

export interface SnapshotAudit {
  latestCapture: string | null;
  stale: boolean;
  records: Array<{ snapshot: ReceptionSnapshot; roomId: string | null }>;
  suppressedOverlaps: number;
  ambiguousRooms: number;
  invalidDates: number;
}

const canonical = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const active = new Set(['pending', 'confirmed', 'checked_in', 'checked_out']);

/** Read-only overlay for the planner. Never feed these observations into booking totals. */
export function auditReceptionSnapshots(
  propertyId: string,
  snapshots: readonly ReceptionSnapshot[],
  rooms: readonly ReceptionRoom[],
  reservations: readonly ReceptionReservation[],
  nowMs: number,
  maxAgeMs = 4 * 60 * 60 * 1000,
): SnapshotAudit {
  const scoped = snapshots.filter((row) => row.hotel_id === propertyId);
  const latestCapture = scoped.reduce<string | null>((latest, row) => !latest || row.captured_at > latest ? row.captured_at : latest, null);
  const capturedMs = latestCapture ? Date.parse(latestCapture) : NaN;
  const stale = !Number.isFinite(capturedMs) || capturedMs > nowMs || nowMs - capturedMs > maxAgeMs;
  if (stale || !latestCapture) return { latestCapture, stale, records: [], suppressedOverlaps: 0, ambiguousRooms: 0, invalidDates: 0 };

  // The same room can occur on many business dates in one snapshot batch.
  const latest = scoped.filter((row) => row.captured_at === latestCapture);
  const byNumber = new Map<string, ReceptionRoom[]>();
  for (const room of rooms) {
    const key = canonical(room.room_number);
    if (!key) continue;
    byNumber.set(key, [...(byNumber.get(key) ?? []), room]);
  }
  const seen = new Set<string>();
  const records: SnapshotAudit['records'] = [];
  let suppressedOverlaps = 0;
  let ambiguousRooms = 0;
  let invalidDates = 0;

  for (const snapshot of latest) {
    const from = snapshot.arrival_date ?? '';
    const to = snapshot.departure_date ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from >= to) {
      invalidDates++;
      continue;
    }
    const key = [canonical(snapshot.room_label || snapshot.room_number), from, to, canonical(snapshot.guest_names)].join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    // Use full room label first; only fall back to exact number if it is unique
    // within this property. NEVER guess a building from the final digits.
    const labelCandidates = byNumber.get(canonical(snapshot.room_label)) ?? [];
    const numberCandidates = byNumber.get(canonical(snapshot.room_number)) ?? [];
    const matches = labelCandidates.length ? labelCandidates : numberCandidates;
    const roomId = matches.length === 1 ? matches[0].id : null;
    if (matches.length > 1) ambiguousRooms++;

    // Avoid displaying an imported Previo booking and its corresponding
    // observation as two separate stays. Dates may change between feeds; any
    // room/date overlap is an unverified match requiring source-ID reconciliation.
    // Keep legitimate direct-booking collisions visible for human investigation.
    const overlapsImported = roomId && reservations.some((booking) =>
      booking.hotel_id === propertyId && booking.source === 'previo' && booking.room_id === roomId &&
      active.has(booking.status ?? '') && booking.check_in_date < to && booking.check_out_date > from,
    );
    if (overlapsImported) {
      suppressedOverlaps++;
      continue;
    }
    records.push({ snapshot, roomId });
  }

  return { latestCapture, stale: false, records, suppressedOverlaps, ambiguousRooms, invalidDates };
}
