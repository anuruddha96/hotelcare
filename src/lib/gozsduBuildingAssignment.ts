import {
  AVAILABLE_WORK_MINUTES,
  type AssignmentPreview,
  type HotelAssignmentConfig,
  type RoomForAssignment,
  type StaffForAssignment,
} from './roomAssignmentAlgorithmCore';
import { calculateRoomTime, calculateRoomWeight, calculateTimeEstimation } from './roomAssignmentAlgorithmGozsduLegacy';

/** This policy is exclusively for Gozsdu Court Budapest. The mapped housekeeping
 * section is authoritative; a Previo buildingCode describes a room type, NOT a
 * manager's walking route (e.g. 1B can occur in several different buildings). */
type Building = 'gozsdu-12' | 'gozsdu-345' | 'hollo-12' | 'hollo-10' | 'kazinczy';
const compatible: Record<Building, readonly Building[]> = {
  'gozsdu-12': ['gozsdu-12', 'hollo-12'],
  'gozsdu-345': ['gozsdu-345', 'hollo-10', 'kazinczy'],
  'hollo-12': ['gozsdu-12', 'hollo-12', 'kazinczy'],
  'hollo-10': ['gozsdu-345', 'hollo-10', 'kazinczy'],
  kazinczy: ['gozsdu-345', 'hollo-12', 'hollo-10', 'kazinczy'],
};

function building(room: RoomForAssignment): Building | null {
  // Do not derive this from room numbers or pms_metadata.gozsduAvailability.buildingCode.
  if (!room.housekeeping_section_id || !room.housekeeping_section_name) return null;
  const name = room.housekeeping_section_name.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.\-_]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^building (i|ii|1|2)$/.test(name)) return 'gozsdu-12';
  if (/^building (iii|iv|v|3|4|5)$/.test(name)) return 'gozsdu-345';
  if (/^hollo 12$/.test(name)) return 'hollo-12';
  if (/^hollo 10$/.test(name)) return 'hollo-10';
  if (/^kazinczy (a|b|c|abc)$/.test(name)) return 'kazinczy';
  return null;
}

export function gozsduRoomsCanShare(rooms: RoomForAssignment[]): boolean {
  const classes = rooms.map(building);
  if (classes.some(value => value === null)) return false;
  return classes.every((left, index) => classes.every((right, other) =>
    index === other || compatible[left!].includes(right!)));
}

export function gozsduAllocationRespectsBuildings(previews: AssignmentPreview[]): boolean {
  return previews.every(preview => preview.rooms.length === 0 || gozsduRoomsCanShare(preview.rooms));
}

const checkout = (room: RoomForAssignment) => room.is_checkout_room === true
  || room.pms_metadata?.scheduledDepartureToday === true;
const minutes = (rooms: RoomForAssignment[]) => rooms.reduce((sum, room) => sum + calculateRoomTime(room), 0);
const weight = (rooms: RoomForAssignment[]) => rooms.reduce((sum, room) => sum + calculateRoomWeight(room), 0);

function preview(person: StaffForAssignment, rooms: RoomForAssignment[]): AssignmentPreview {
  const sorted = [...rooms].sort((a, b) => Number(checkout(b)) - Number(checkout(a))
    || String(a.housekeeping_section_name).localeCompare(String(b.housekeeping_section_name))
    || a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
  return {
    staffId: person.id,
    staffName: person.full_name,
    rooms: sorted,
    totalWeight: weight(sorted),
    checkoutCount: sorted.filter(checkout).length,
    dailyCount: sorted.filter(room => !checkout(room)).length,
    ...calculateTimeEstimation(sorted),
  };
}

function groupsByManagerSection(rooms: RoomForAssignment[]): RoomForAssignment[][] {
  const groups = new Map<string, RoomForAssignment[]>();
  for (const room of rooms) {
    const key = room.housekeeping_section_id!;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(room);
  }
  return [...groups.values()].sort((a, b) => minutes(b) - minutes(a)
    || String(a[0].housekeeping_section_name).localeCompare(String(b[0].housekeeping_section_name)));
}

/** A pool cannot mix the two incompatible sides of the walking route. Assign
 * whole mapped sections when fair, otherwise split a large section by minutes,
 * verified bed effort and checkout count. No production assignments are written. */
function assignPool(
  groups: RoomForAssignment[][], people: StaffForAssignment[],
  assigned: Map<string, RoomForAssignment[]>, config: HotelAssignmentConfig,
): void {
  if (!groups.length) return;
  const all = groups.flat();
  const targetMinutes = minutes(all) / people.length;
  const targetWeight = weight(all) / people.length;
  const targetCheckouts = all.filter(checkout).length / people.length;
  const seed = Math.abs(Math.trunc(config.randomSeed ?? 0));
  const preference = config.staffPreferences ?? {};

  function score(person: StaffForAssignment, added: RoomForAssignment[]): number {
    const current = assigned.get(person.id)!;
    if (!gozsduRoomsCanShare([...current, ...added])) return Number.POSITIVE_INFINITY;
    const currentMinutes = minutes(current);
    const projectedMinutes = currentMinutes + minutes(added);
    const projectedWeight = weight([...current, ...added]);
    const projectedCheckouts = [...current, ...added].filter(checkout).length;
    const sameSection = current.some(room => room.housekeeping_section_id === added[0].housekeeping_section_id);
    const sectionAlreadyOwned = [...assigned.values()].some(rooms => rooms.some(room =>
      room.housekeeping_section_id === added[0].housekeeping_section_id));
    const preferenceForSection = preference[person.id]?.some(value =>
      value === added[0].housekeeping_section_id || value === added[0].housekeeping_section_name) ?? false;
    // Hard shift and target overruns dominate small locality/preferences bonuses.
    return Math.max(0, projectedMinutes - AVAILABLE_WORK_MINUTES) * 100
      + Math.max(0, projectedMinutes - targetMinutes) * 7
      + currentMinutes * 3
      + Math.max(0, projectedWeight - targetWeight) * 65
      + Math.max(0, projectedCheckouts - Math.ceil(targetCheckouts)) * 105
      + (sameSection ? -55 : sectionAlreadyOwned ? 60 : 0)
      + (preferenceForSection ? -30 : 0)
      + ((seed + person.id.length) % 13) / 100;
  }

  function add(rooms: RoomForAssignment[]): void {
    const chosen = [...people].sort((a, b) => score(a, rooms) - score(b, rooms)
      || a.id.localeCompare(b.id))[0];
    if (!chosen || !Number.isFinite(score(chosen, rooms))) throw new Error('Gozsdu mapped buildings have no compatible available housekeeper.');
    assigned.get(chosen.id)!.push(...rooms);
  }

  for (const group of groups) {
    const sectionMinutes = minutes(group);
    const sorted = [...group].sort((a, b) => Number(checkout(b)) - Number(checkout(a))
      || calculateRoomTime(b) - calculateRoomTime(a)
      || calculateRoomWeight(b) - calculateRoomWeight(a)
      || a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
    // Keep a small/medium mapped section together; do not preserve locality
    // by giving one person a 700-minute shift and another no work.
    if (sectionMinutes <= AVAILABLE_WORK_MINUTES && sectionMinutes <= targetMinutes * 1.35
      && people.some(person => minutes(assigned.get(person.id)!) + sectionMinutes <= AVAILABLE_WORK_MINUTES)) {
      add(sorted);
    } else {
      for (const room of sorted) add([room]);
    }
  }
}

/** A null result means fail closed: unmapped inventory or too few employees for
 * incompatible routes. The existing Auto Assign coverage gate blocks saving. */
export function planGozsduBuildingAssignments(
  rooms: RoomForAssignment[], staff: StaffForAssignment[], config: HotelAssignmentConfig = {},
): AssignmentPreview[] {
  if (!staff.length) return [];
  const operating = rooms.filter(room => room.pms_metadata?.gozsduAvailability?.status === 'operating');
  if (!operating.length) return staff.map(person => preview(person, []));
  if (operating.some(room => building(room) === null)) return [];

  const west = operating.filter(room => building(room) === 'gozsdu-12' || building(room) === 'hollo-12');
  const east = operating.filter(room => building(room) === 'gozsdu-345' || building(room) === 'hollo-10');
  const kazinczy = operating.filter(room => building(room) === 'kazinczy');
  const hasRestrictedWest = west.some(room => building(room) === 'gozsdu-12');
  const separateKazinczy = west.length > 0 && east.length === 0 && hasRestrictedWest && kazinczy.length > 0;
  const eastWork = [...east, ...(east.length > 0 || separateKazinczy ? kazinczy : [])];
  const westWork = [...west, ...(east.length === 0 && !separateKazinczy ? kazinczy : [])];
  const needsTwoPools = eastWork.length > 0 && westWork.length > 0;
  if (needsTwoPools && staff.length < 2) return [];

  const orderedStaff = [...staff].sort((a, b) => a.id.localeCompare(b.id));
  const rotation = Math.abs(Math.trunc(config.randomSeed ?? 0)) % orderedStaff.length;
  const rotated = [...orderedStaff.slice(rotation), ...orderedStaff.slice(0, rotation)];
  const westCount = needsTwoPools
    ? Math.max(1, Math.min(staff.length - 1,
      Math.round(staff.length * minutes(westWork) / (minutes(westWork) + minutes(eastWork)))))
    : westWork.length > 0 ? staff.length : 0;
  const westStaff = rotated.slice(0, westCount);
  const eastStaff = rotated.slice(westCount);
  const assigned = new Map(staff.map(person => [person.id, [] as RoomForAssignment[]]));
  if (westWork.length) assignPool(groupsByManagerSection(westWork), westStaff, assigned, config);
  if (eastWork.length) assignPool(groupsByManagerSection(eastWork), eastStaff, assigned, config);
  const result = staff.map(person => preview(person, assigned.get(person.id)!));
  const assignedIds = result.flatMap(person => person.rooms.map(room => room.id));
  return assignedIds.length === operating.length && new Set(assignedIds).size === operating.length
    && gozsduAllocationRespectsBuildings(result) ? result : [];
}
