// Preserve the existing portfolio algorithm verbatim for every property except
// Gozsdu Court Budapest. Only this facade opts Gozsdu into its mapped-building
// workload planner; the original implementation lives in the unchanged core.
export * from './roomAssignmentAlgorithmCore';

import * as core from './roomAssignmentAlgorithmCore';
import { isGozsduCourtHotel } from './gozsdu-housekeeping';
import type {
  AssignmentPreview, FairnessMetrics, HotelAssignmentConfig, RoomAffinityMap,
  RoomForAssignment, StaffForAssignment, WingProximityMap,
} from './roomAssignmentAlgorithmCore';

type GozsduPlanningMetadata = {
  cleaningSize?: string | null;
  verifiedBedCount?: number | null;
  checkoutMinutes?: number | null;
  serviceMinutes?: number | null;
  towelMinutes?: number | null;
};

const isGozsduRoom = (room: RoomForAssignment) => isGozsduCourtHotel(room.hotel);
const isCheckout = (room: RoomForAssignment) =>
  room.is_checkout_room === true || room.pms_metadata?.scheduledDepartureToday === true;
const mapped = (room: RoomForAssignment): GozsduPlanningMetadata =>
  room.pms_metadata?.gozsduAutoAssign || {};

function boundedMinutes(value: unknown): number | null {
  const n = Number(value);
  return value !== null && value !== undefined && Number.isInteger(n) && n >= 1 && n <= 480 ? n : null;
}

function verifiedBeds(room: RoomForAssignment): number | null {
  const value = mapped(room).verifiedBedCount;
  return value !== null && value !== undefined && Number.isInteger(Number(value))
    && Number(value) >= 1 && Number(value) <= 20 ? Number(value) : null;
}

/** A manager's size target is authoritative; a bed count changes physical-effort
 * balancing, never silently overwrites the time they explicitly configured. */
export function calculateRoomTime(room: RoomForAssignment): number {
  if (!isGozsduRoom(room)) return core.calculateRoomTime(room);
  const metadata = mapped(room);
  if (isCheckout(room)) return boundedMinutes(metadata.checkoutMinutes) ?? core.calculateRoomTime(room);
  if (room.towel_change_required && !room.linen_change_required) {
    return boundedMinutes(metadata.towelMinutes) ?? core.TOWEL_CHANGE_MINUTES;
  }
  if (room.linen_change_required) {
    return boundedMinutes(metadata.serviceMinutes)
      ?? (core.LINEN_CHANGE_MINUTES + Math.min(25, Math.max(0, (verifiedBeds(room) ?? 1) - 1) * 5));
  }
  return boundedMinutes(metadata.serviceMinutes) ?? core.calculateRoomTime(room);
}

export function calculateRoomWeight(room: RoomForAssignment): number {
  if (!isGozsduRoom(room)) return core.calculateRoomWeight(room);
  let weight = core.calculateRoomWeight(room);
  const size = mapped(room).cleaningSize;
  // The size class is the manager's classification, not an invented sqm value.
  if (room.room_size_sqm == null) {
    weight += size === 'extra_large' ? 1.1 : size === 'large' ? 0.7 : size === 'medium' ? 0.3 : 0;
  }
  if (isCheckout(room) || room.linen_change_required) {
    weight += Math.min(2.8, Math.max(0, (verifiedBeds(room) ?? 1) - 1) * 0.4);
  }
  return weight;
}

export function calculateTimeEstimation(rooms: RoomForAssignment[]) {
  if (!rooms.length || !rooms.every(isGozsduRoom)) return core.calculateTimeEstimation(rooms);
  const estimatedMinutes = rooms.reduce((sum, room) => sum + calculateRoomTime(room), 0);
  const totalWithBreak = estimatedMinutes + core.BREAK_TIME_MINUTES;
  return {
    estimatedMinutes,
    totalWithBreak,
    exceedsShift: totalWithBreak > core.STANDARD_SHIFT_MINUTES,
    overageMinutes: Math.max(0, totalWithBreak - core.STANDARD_SHIFT_MINUTES),
  };
}

function zone(room: RoomForAssignment): string {
  if (room.housekeeping_section_id) return `section:${room.housekeeping_section_id}`;
  // This is only a last-resort fallback until managers map a newly added room.
  const building = room.pms_metadata?.gozsduAvailability?.buildingCode;
  return building ? `building:${building}` : `unmapped:${room.id}`;
}

function roomLabel(room: RoomForAssignment): string {
  return room.pms_metadata?.gozsduAvailability?.pmsRoomName || room.room_number;
}

function preview(staff: StaffForAssignment, rooms: RoomForAssignment[]): AssignmentPreview {
  const sorted = [...rooms].sort((a, b) =>
    Number(isCheckout(b)) - Number(isCheckout(a))
    || zone(a).localeCompare(zone(b))
    || roomLabel(a).localeCompare(roomLabel(b), undefined, { numeric: true }));
  const time = calculateTimeEstimation(sorted);
  return {
    staffId: staff.id,
    staffName: staff.full_name,
    rooms: sorted,
    totalWeight: sorted.reduce((total, room) => total + calculateRoomWeight(room), 0),
    checkoutCount: sorted.filter(isCheckout).length,
    dailyCount: sorted.filter(room => !isCheckout(room)).length,
    ...time,
  };
}

function gozsduPreview(previews: AssignmentPreview[]): boolean {
  const rooms = previews.flatMap(result => result.rooms);
  return rooms.length > 0 && rooms.every(isGozsduRoom);
}

/** For Gozsdu, an unmapped physical floor must not make different buildings
 * look like the same F0. Calculate split ownership from the ACTUAL manager map. */
export function computeFairnessMetrics(previews: AssignmentPreview[]): FairnessMetrics {
  const metrics = core.computeFairnessMetrics(previews);
  if (!gozsduPreview(previews)) return metrics;
  const active = previews.filter(result => result.rooms.length > 0);
  const owners = new Map<string, Set<string>>();
  for (const result of active) {
    for (const room of result.rooms) {
      const key = zone(room);
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key)!.add(result.staffId);
    }
  }
  const splitSections = [...owners.values()].reduce((total, people) => total + Math.max(0, people.size - 1), 0);
  const heavyCounts = active.map(result => result.rooms.filter(room =>
    calculateRoomWeight(room) >= 1.7 || calculateRoomTime(room) >= 55).length);
  const heavyDiff = heavyCounts.length > 1 ? Math.max(...heavyCounts) - Math.min(...heavyCounts) : 0;
  return {
    ...metrics,
    heavyRoomDiff: heavyDiff,
    splitFloorCount: splitSections,
    score: metrics.score - metrics.heavyRoomDiff * 450 - metrics.splitFloorCount * 500
      + heavyDiff * 450 + splitSections * 500,
  };
}

function stableTie(room: RoomForAssignment, staffId: string, seed: number): number {
  const str = `${room.id}|${staffId}|${seed}`;
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) hash = Math.imul(hash ^ str.charCodeAt(i), 16777619);
  return (hash >>> 0) % 17 / 10;
}

/** Group by the manager's real building/apartment section, then balance
 * configured cleaning minutes, verified-bed physical effort, checkout count
 * and 450-minute usable shifts. This only returns a preview; no DB writes. */
function assignGozsdu(rooms: RoomForAssignment[], staff: StaffForAssignment[], config: HotelAssignmentConfig): AssignmentPreview[] {
  if (!staff.length) return [];
  const operating = rooms.filter(room => room.pms_metadata?.gozsduAvailability?.status === 'operating');
  if (!operating.length) return staff.map(person => preview(person, []));

  const groups = new Map<string, RoomForAssignment[]>();
  for (const room of operating) {
    const key = zone(room);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(room);
  }
  const groupsOrdered = [...groups.entries()].sort(([nameA, a], [nameB, b]) => {
    const workA = a.reduce((total, room) => total + calculateRoomTime(room), 0);
    const workB = b.reduce((total, room) => total + calculateRoomTime(room), 0);
    return workB - workA || nameA.localeCompare(nameB);
  });
  const assigned = new Map(staff.map(person => [person.id, [] as RoomForAssignment[]]));
  const minutes = new Map(staff.map(person => [person.id, 0]));
  const weights = new Map(staff.map(person => [person.id, 0]));
  const zoneOwners = new Map<string, Set<string>>();
  const targetMinutes = operating.reduce((total, room) => total + calculateRoomTime(room), 0) / staff.length;
  const targetWeight = operating.reduce((total, room) => total + calculateRoomWeight(room), 0) / staff.length;
  const targetCheckouts = operating.filter(isCheckout).length / staff.length;
  const seed = config.randomSeed || 0;

  for (const [key, group] of groupsOrdered) {
    group.sort((a, b) => Number(isCheckout(b)) - Number(isCheckout(a))
      || calculateRoomTime(b) - calculateRoomTime(a)
      || roomLabel(a).localeCompare(roomLabel(b), undefined, { numeric: true }));
    for (const room of group) {
      const taskMinutes = calculateRoomTime(room);
      const taskWeight = calculateRoomWeight(room);
      const existingOwners = zoneOwners.get(key) || new Set<string>();
      const ranked = staff.map(person => {
        const current = assigned.get(person.id)!;
        const currentMinutes = minutes.get(person.id)!;
        const currentWeight = weights.get(person.id)!;
        const projected = currentMinutes + taskMinutes;
        const currentCheckouts = current.filter(isCheckout).length;
        const existingZones = new Set(current.map(zone));
        const preferences = config.staffPreferences?.[person.id] || [];
        const preferred = preferences.includes(key)
          || preferences.includes(room.housekeeping_section_name || '') ? -80 : 0;
        const locality = existingZones.has(key) ? -210
          : existingOwners.size > 0 ? 190 + existingZones.size * 60
          : current.length > 0 ? 45 + existingZones.size * 35 : 0;
        const beyondShift = Math.max(0, projected - core.AVAILABLE_WORK_MINUTES);
        const beyondTarget = Math.max(0, projected - targetMinutes);
        const checkoutPenalty = isCheckout(room)
          ? Math.max(0, currentCheckouts + 1 - Math.ceil(targetCheckouts)) * 180 + currentCheckouts * 75 : 0;
        const score = beyondShift * 95 + beyondTarget * 7 + currentMinutes * 1.8
          + Math.max(0, currentWeight + taskWeight - targetWeight) * 95
          + current.length * 20 + checkoutPenalty + locality + preferred
          + stableTie(room, person.id, seed);
        return { staffId: person.id, score };
      }).sort((a, b) => a.score - b.score || a.staffId.localeCompare(b.staffId));
      const chosen = ranked[0].staffId;
      assigned.get(chosen)!.push(room);
      minutes.set(chosen, minutes.get(chosen)! + taskMinutes);
      weights.set(chosen, weights.get(chosen)! + taskWeight);
      if (!zoneOwners.has(key)) zoneOwners.set(key, new Set());
      zoneOwners.get(key)!.add(chosen);
    }
  }
  return staff.map(person => preview(person, assigned.get(person.id)!));
}

export function autoAssignRooms(
  rooms: RoomForAssignment[], staff: StaffForAssignment[],
  wingProximityMap?: WingProximityMap, affinityMap?: RoomAffinityMap,
  hotelConfig?: HotelAssignmentConfig,
): AssignmentPreview[] {
  const gozsdu = rooms.length > 0 && rooms.every(isGozsduRoom)
    && (!hotelConfig?.hotelName || isGozsduCourtHotel(hotelConfig.hotelName));
  return gozsdu ? assignGozsdu(rooms, staff, hotelConfig || {})
    : core.autoAssignRooms(rooms, staff, wingProximityMap, affinityMap, hotelConfig);
}

/** Moving a mapped Gozsdu room must keep the manager's size duration and bed
 * weighting in the live preview. All other hotels use their old move logic. */
export function moveRoom(
  previews: AssignmentPreview[], roomId: string, fromStaffId: string, toStaffId: string,
): AssignmentPreview[] {
  if (!gozsduPreview(previews)) return core.moveRoom(previews, roomId, fromStaffId, toStaffId);
  if (fromStaffId === toStaffId || !previews.some(result =>
    result.staffId === fromStaffId && result.rooms.some(room => room.id === roomId))) return previews;
  const moving = previews.find(result => result.staffId === fromStaffId)!.rooms.find(room => room.id === roomId)!;
  return previews.map(result => {
    if (result.staffId !== fromStaffId && result.staffId !== toStaffId) return result;
    const rooms = result.staffId === fromStaffId ? result.rooms.filter(room => room.id !== roomId)
      : [...result.rooms, moving];
    return preview({ id: result.staffId, full_name: result.staffName, nickname: null }, rooms);
  });
}
