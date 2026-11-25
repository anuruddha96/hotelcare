import { getFloorFromRoomNumber, getMemoriesZone, type RoomForAssignment } from './roomAssignmentAlgorithm';

export interface LiveRoomProgress {
  room_id: string;
  assigned_to: string;
  status: string;
  supervisor_approved?: boolean | null;
}

export type LiveRoomDisplayStatus = 'assigned' | 'cleaning' | 'pending_approval' | 'done';

/** Progress is a view over the published assignment, never a reason to remove its room. */
export function getLiveRoomDisplayStatus(progress: LiveRoomProgress | null | undefined): LiveRoomDisplayStatus {
  if (progress?.status === 'completed') return progress.supervisor_approved ? 'done' : 'pending_approval';
  if (progress?.status === 'in_progress') return 'cleaning';
  return 'assigned';
}

export function isProtectedLiveAssignment(status: string | null | undefined): boolean {
  return status === 'completed' || status === 'in_progress' || status === 'dnd_pending_retry';
}

/** Prior finished work is evidence of a cleaner's familiar route, not a manager instruction. */
export function buildMemoriesHistoricalPreferences(
  observations: Array<{ room_id: string; assigned_to: string; assignment_date: string }>,
  rooms: RoomForAssignment[],
  eligibleStaffIds: ReadonlySet<string>,
): { preferences: Record<string, string[]>; sampleCount: number } {
  const roomsById = new Map(rooms.map(room => [room.id, room]));
  const zoneCounts = new Map<string, Map<string, number>>();
  let sampleCount = 0;
  const seen = new Set<string>();
  for (const record of observations) {
    if (!eligibleStaffIds.has(record.assigned_to)) continue;
    const room = roomsById.get(record.room_id);
    if (!room) continue;
    const observationKey = `${record.assignment_date}|${record.room_id}|${record.assigned_to}`;
    if (seen.has(observationKey)) continue;
    seen.add(observationKey);
    sampleCount++;
    const zone = room.housekeeping_section_id
      ? `section-${room.housekeeping_section_id}`
      : getMemoriesZone(room.room_number);
    const zones = zoneCounts.get(record.assigned_to) || new Map<string, number>();
    zones.set(zone, (zones.get(zone) || 0) + 1);
    const floor = String(room.floor_number ?? getFloorFromRoomNumber(room.room_number));
    zones.set(floor, (zones.get(floor) || 0) + 0.35);
    zoneCounts.set(record.assigned_to, zones);
  }
  const preferences: Record<string, string[]> = {};
  for (const [staffId, zones] of zoneCounts) {
    const ranked = [...zones.entries()].filter(([zone, count]) =>
      count >= (zone.startsWith('section-') || zone.includes('f') || zone === 'ground' ? 4 : 2),
    ).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (ranked.length) preferences[staffId] = ranked.slice(0, 2).map(([zone]) => zone);
  }
  return { preferences, sampleCount };
}

/** Stable input → stable proposal. Only a deliberate change of goal or inputs changes the seed. */
export function stableAssignmentSeed(hotel: string, date: string, goal: string, staffIds: string[], roomIds: string[]): number {
  const key = [hotel, date, goal, [...staffIds].sort().join(','), [...roomIds].sort().join(',')].join('|');
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1109;
}
