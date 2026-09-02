// Room Assignment Algorithm — FAIR + LOCALITY aware
// Priority: 1) safe/fair workload 2) keep floors/zones together 3) nearby sequence
//           4) distribute heavy rooms 5) learned affinity/preferences

// Time constants (in minutes)
export const CHECKOUT_MINUTES = 45;
export const DAILY_MINUTES = 15;
export const TOWEL_CHANGE_MINUTES = 10;
export const LINEN_CHANGE_MINUTES = 15; // Clean Room (C) = 15 min total
export const BREAK_TIME_MINUTES = 30;
export const STANDARD_SHIFT_MINUTES = 480; // 8 hours
export const AVAILABLE_WORK_MINUTES = STANDARD_SHIFT_MINUTES - BREAK_TIME_MINUTES; // 450 minutes

export interface RoomForAssignment {
  id: string;
  room_number: string;
  hotel: string;
  floor_number: number | null;
  room_size_sqm: number | null;
  room_capacity: number | null;
  is_checkout_room: boolean;
  pms_metadata?: any;
  status: string;
  towel_change_required?: boolean;
  linen_change_required?: boolean;
  wing?: string | null;
  elevator_proximity?: number | null;
  room_category?: string | null;
  bed_configuration?: string | null;
  notes?: string | null;
  ready_to_clean?: boolean;
  checkout_time?: string | null;
}

export interface StaffForAssignment {
  id: string;
  full_name: string;
  nickname: string | null;
}

export interface AssignmentPreview {
  staffId: string;
  staffName: string;
  rooms: RoomForAssignment[];
  totalWeight: number;
  checkoutCount: number;
  dailyCount: number;
  estimatedMinutes: number;
  totalWithBreak: number;
  exceedsShift: boolean;
  overageMinutes: number;
}

// Fairness + locality metrics used by best-of-N preview generation.
export interface FairnessMetrics {
  checkoutDiff: number;
  dailyDiff: number;
  totalDiff: number;
  timeSpreadMinutes: number;
  weightSpread: number;
  heavyRoomDiff: number;
  splitFloorCount: number;
  score: number; // lower = better
}

// ─── HOTEL MEMORIES BUDAPEST ZONE MAPPING ───
const MEMORIES_ZONES: Record<string, string[]> = {
  'ground': ['002', '004', '006', '008', '010', '032', '034', '036', '038', '040', '042', '044'],
  'f1-left': ['101', '102', '103', '104', '105', '106', '107', '108', '109', '110', '111', '112', '113', '114', '115', '117', '119', '121', '123', '125', '127'],
  'f1-right': ['130', '131', '132', '133', '134', '135', '136', '137', '138', '139', '140', '141', '142', '143', '144', '145', '147'],
  'f2-f3': ['201', '202', '203', '204', '205', '206', '207', '208', '209', '210', '211', '212', '213', '214', '215', '216', '217', '302', '304', '306', '308'],
};

const MEMORIES_ROOM_TO_ZONE: Record<string, string> = {};
for (const [zone, rooms] of Object.entries(MEMORIES_ZONES)) {
  for (const room of rooms) MEMORIES_ROOM_TO_ZONE[room] = zone;
}

export function getMemoriesZone(roomNumber: string): string {
  return MEMORIES_ROOM_TO_ZONE[roomNumber] || `unknown-${roomNumber}`;
}

export function isHotelMemoriesBudapest(hotelName: string | undefined | null): boolean {
  return hotelName === 'Hotel Memories Budapest';
}

export function applyMemoriesZones(rooms: RoomForAssignment[]): RoomForAssignment[] {
  return rooms.map(room => ({ ...room, wing: getMemoriesZone(room.room_number) }));
}

function isCheckoutRoom(room: RoomForAssignment): boolean {
  return room.is_checkout_room || room.pms_metadata?.scheduledDepartureToday === true;
}

// Calculate estimated time for a room in minutes.
export function calculateRoomTime(room: RoomForAssignment): number {
  const isCheckout = isCheckoutRoom(room);
  if (room.towel_change_required && !isCheckout && !room.linen_change_required) return TOWEL_CHANGE_MINUTES;
  if (room.linen_change_required && !isCheckout) return LINEN_CHANGE_MINUTES;
  if (!isCheckout) return DAILY_MINUTES;

  const capacity = room.room_capacity || 2;
  if (capacity >= 4) return 60;
  if (capacity >= 3) return 55;
  const size = room.room_size_sqm || 0;
  if (size >= 40) return 60;
  if (size >= 28) return 50;
  return CHECKOUT_MINUTES;
}

export function calculateTimeEstimation(rooms: RoomForAssignment[]): {
  estimatedMinutes: number;
  totalWithBreak: number;
  exceedsShift: boolean;
  overageMinutes: number;
} {
  const estimatedMinutes = rooms.reduce((sum, room) => sum + calculateRoomTime(room), 0);
  const totalWithBreak = estimatedMinutes + BREAK_TIME_MINUTES;
  const exceedsShift = totalWithBreak > STANDARD_SHIFT_MINUTES;
  const overageMinutes = exceedsShift ? totalWithBreak - STANDARD_SHIFT_MINUTES : 0;
  return { estimatedMinutes, totalWithBreak, exceedsShift, overageMinutes };
}

export function formatMinutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

// Weight is deliberately separate from time. It captures physical effort so a
// large suite/triple is not treated as identical to a small room just because
// both are daily service tasks.
export function calculateRoomWeight(room: RoomForAssignment): number {
  const isCheckout = isCheckoutRoom(room);
  if (room.towel_change_required && !isCheckout && !room.linen_change_required) return 0.4;

  let weight = isCheckout ? 1.5 : 1.0;
  if (room.linen_change_required && !isCheckout) weight += 0.5;
  if (room.towel_change_required && !isCheckout) weight += 0.2;

  const capacity = room.room_capacity || 2;
  if (capacity >= 4) weight += 0.8;
  else if (capacity >= 3) weight += 0.4;

  const size = room.room_size_sqm || 20;
  if (size >= 40) weight += 1.0;
  else if (size >= 28) weight += 0.6;
  else if (size >= 22) weight += 0.3;
  return weight;
}

export function getFloorFromRoomNumber(roomNumber: string): number {
  const num = parseInt(roomNumber, 10);
  if (isNaN(num)) return 0;
  return Math.floor(num / 100);
}

export type WingProximityMap = Record<string, Record<string, number>>;
export type RoomAffinityMap = Map<string, number>;

export function buildWingProximityMap(
  layouts: Array<{ floor_number: number; wing: string; x: number; y: number }>
): WingProximityMap {
  const map: WingProximityMap = {};
  for (const a of layouts) {
    for (const b of layouts) {
      if (a.wing === b.wing) continue;
      const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
      if (!map[a.wing]) map[a.wing] = {};
      map[a.wing][b.wing] = Math.round(dist);
    }
  }
  return map;
}

function affinityKey(roomA: string, roomB: string): string {
  return roomA < roomB ? `${roomA}|${roomB}` : `${roomB}|${roomA}`;
}

export function buildAffinityMap(
  patterns: Array<{ room_number_a: string; room_number_b: string; pair_count: number }>
): RoomAffinityMap {
  if (patterns.length === 0) return new Map();
  const maxCount = Math.max(...patterns.map(p => p.pair_count));
  if (maxCount === 0) return new Map();
  const map: RoomAffinityMap = new Map();
  for (const p of patterns) {
    map.set(affinityKey(p.room_number_a, p.room_number_b), p.pair_count / maxCount);
  }
  return map;
}

export interface HotelAssignmentConfig {
  floorPenaltyMultiplier?: number;
  affinityBonusMultiplier?: number;
  checkoutFirstGrouping?: boolean;
  roomProximityWeight?: number;
  wingZoneMapping?: Record<string, string>;
  staffPreferences?: Record<string, string[]>;
  hotelName?: string;
  randomSeed?: number;
  floorOwnershipBonus?: number;
  heavyRoomFairnessWeight?: number;
}

// ─── HELPERS ───
function getFloor(room: RoomForAssignment): number {
  return room.floor_number ?? getFloorFromRoomNumber(room.room_number);
}

function getZone(room: RoomForAssignment): string {
  return room.wing || `floor-${getFloor(room)}`;
}

function getStaffZones(rooms: RoomForAssignment[]): Set<string> {
  const zones = new Set<string>();
  rooms.forEach(r => zones.add(getZone(r)));
  return zones;
}

function roomOrdinal(roomNumber: string): number | null {
  const values = String(roomNumber || '').match(/\d+/g);
  if (!values?.length) return null;
  return Number(values[values.length - 1]);
}

function zoneMapDistance(roomZone: string, zones: Set<string>, wingMap?: WingProximityMap): number | null {
  if (!wingMap || zones.size === 0) return null;
  let closest = Infinity;
  for (const zone of zones) {
    const direct = wingMap[zone]?.[roomZone] ?? wingMap[roomZone]?.[zone];
    if (typeof direct === 'number') closest = Math.min(closest, direct);
  }
  return closest === Infinity ? null : closest;
}

// Lower is better. This intentionally makes changing floor more expensive
// than choosing a slightly less even room count, while still allowing fairness
// to win when a worker would otherwise become materially overloaded.
function zoneFitScore(
  room: RoomForAssignment,
  staffRooms: RoomForAssignment[],
  floorPenaltyMultiplier: number,
  wingMap?: WingProximityMap
): number {
  if (staffRooms.length === 0) return 0;

  const roomZone = getZone(room);
  const zones = getStaffZones(staffRooms);
  if (zones.has(roomZone)) return -35 * floorPenaltyMultiplier;

  const roomFloor = getFloor(room);
  const floors = new Set(staffRooms.map(r => getFloor(r)));
  if (floors.has(roomFloor)) return 8; // same floor, different wing/zone

  const minFloorDist = Math.min(...Array.from(floors).map(f => Math.abs(f - roomFloor)));
  const zoneDist = zoneMapDistance(roomZone, zones, wingMap);
  const floorPenalty = minFloorDist * 105 * floorPenaltyMultiplier;
  const zonePenalty = zoneDist == null ? 0 : Math.min(70, zoneDist * 4);
  const spreadPenalty = Math.max(0, zones.size - 1) * 35;
  return floorPenalty + zonePenalty + spreadPenalty;
}

function roomProximityScore(room: RoomForAssignment, staffRooms: RoomForAssignment[]): number {
  if (staffRooms.length === 0) return 0;
  const num = roomOrdinal(room.room_number);
  if (num == null) return 0;

  const sameFloor = staffRooms.filter(existing => getFloor(existing) === getFloor(room));
  const pool = sameFloor.length > 0 ? sameFloor : staffRooms;
  let closest = Infinity;
  for (const existing of pool) {
    const existingNum = roomOrdinal(existing.room_number);
    if (existingNum != null) closest = Math.min(closest, Math.abs(num - existingNum));
  }
  return closest === Infinity ? 0 : Math.min(30, closest);
}

function getAffinityBonus(
  roomNumber: string,
  existingRoomNumbers: string[],
  affinityMap?: RoomAffinityMap
): number {
  if (!affinityMap || affinityMap.size === 0) return 0;
  let bonus = 0;
  for (const existing of existingRoomNumbers) {
    const score = affinityMap.get(affinityKey(roomNumber, existing));
    if (score) bonus += score;
  }
  return Math.min(bonus, 3.0);
}

function isHeavyRoom(room: RoomForAssignment): boolean {
  return calculateRoomWeight(room) >= 1.7 || calculateRoomTime(room) >= 55;
}

function removalClusterPenalty(room: RoomForAssignment, staffRooms: RoomForAssignment[]): number {
  const sameZone = staffRooms.filter(r => r.id !== room.id && getZone(r) === getZone(room)).length;
  const sameFloor = staffRooms.filter(r => r.id !== room.id && getFloor(r) === getFloor(room)).length;
  if (sameZone >= 2) return 220;
  if (sameZone === 1) return 150;
  if (sameFloor >= 2) return 110;
  if (sameFloor === 1) return 65;
  return 0;
}

function sortRoomsOptimally(rooms: RoomForAssignment[]): RoomForAssignment[] {
  return [...rooms].sort((a, b) => {
    const aCheckout = isCheckoutRoom(a);
    const bCheckout = isCheckoutRoom(b);
    if (aCheckout !== bCheckout) return aCheckout ? -1 : 1;
    const floorA = getFloor(a);
    const floorB = getFloor(b);
    if (floorA !== floorB) return floorA - floorB;
    const ordinalA = roomOrdinal(a.room_number) ?? Number.MAX_SAFE_INTEGER;
    const ordinalB = roomOrdinal(b.room_number) ?? Number.MAX_SAFE_INTEGER;
    if (ordinalA !== ordinalB) return ordinalA - ordinalB;
    return a.room_number.localeCompare(b.room_number);
  });
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function previewFromRooms(staff: StaffForAssignment, rooms: RoomForAssignment[]): AssignmentPreview {
  const sorted = sortRoomsOptimally(rooms);
  const timeEstimate = calculateTimeEstimation(sorted);
  return {
    staffId: staff.id,
    staffName: staff.full_name,
    rooms: sorted,
    totalWeight: sorted.reduce((sum, r) => sum + calculateRoomWeight(r), 0),
    checkoutCount: sorted.filter(isCheckoutRoom).length,
    dailyCount: sorted.filter(r => !isCheckoutRoom(r)).length,
    ...timeEstimate,
  };
}

// ─── FAIRNESS + LOCALITY SCORING ───
export function computeFairnessMetrics(previews: AssignmentPreview[]): FairnessMetrics {
  const active = previews.filter(p => p.rooms.length > 0);
  if (active.length <= 1) {
    return {
      checkoutDiff: 0,
      dailyDiff: 0,
      totalDiff: 0,
      timeSpreadMinutes: 0,
      weightSpread: 0,
      heavyRoomDiff: 0,
      splitFloorCount: 0,
      score: 0,
    };
  }

  const checkouts = active.map(p => p.checkoutCount);
  const dailies = active.map(p => p.dailyCount);
  const totals = active.map(p => p.rooms.length);
  const times = active.map(p => p.estimatedMinutes);
  const weights = active.map(p => p.totalWeight);
  const heavyCounts = active.map(p => p.rooms.filter(isHeavyRoom).length);

  const checkoutDiff = Math.max(...checkouts) - Math.min(...checkouts);
  const dailyDiff = Math.max(...dailies) - Math.min(...dailies);
  const totalDiff = Math.max(...totals) - Math.min(...totals);
  const timeSpreadMinutes = Math.max(...times) - Math.min(...times);
  const weightSpread = Math.max(...weights) - Math.min(...weights);
  const heavyRoomDiff = Math.max(...heavyCounts) - Math.min(...heavyCounts);

  // A floor being split between two people counts as 1 split; three people = 2.
  const floorOwners = new Map<number, Set<string>>();
  for (const preview of active) {
    for (const room of preview.rooms) {
      const floor = getFloor(room);
      if (!floorOwners.has(floor)) floorOwners.set(floor, new Set());
      floorOwners.get(floor)!.add(preview.staffId);
    }
  }
  const splitFloorCount = Array.from(floorOwners.values())
    .reduce((sum, owners) => sum + Math.max(0, owners.size - 1), 0);

  // Counts stay the primary safety rails. Among similarly fair candidates,
  // fewer split floors, heavy-room imbalance and walking time decide the winner.
  const score =
    checkoutDiff * 2000 +
    dailyDiff * 650 +
    totalDiff * 350 +
    timeSpreadMinutes * 4 +
    weightSpread * 180 +
    heavyRoomDiff * 450 +
    splitFloorCount * 500;

  return {
    checkoutDiff,
    dailyDiff,
    totalDiff,
    timeSpreadMinutes,
    weightSpread,
    heavyRoomDiff,
    splitFloorCount,
    score,
  };
}

// ─── MAIN ALGORITHM ───
export function autoAssignRooms(
  rooms: RoomForAssignment[],
  staff: StaffForAssignment[],
  wingProximityMap?: WingProximityMap,
  affinityMap?: RoomAffinityMap,
  hotelConfig?: HotelAssignmentConfig
): AssignmentPreview[] {
  const config: Required<Pick<HotelAssignmentConfig,
    'affinityBonusMultiplier' | 'floorPenaltyMultiplier' | 'roomProximityWeight' |
    'floorOwnershipBonus' | 'heavyRoomFairnessWeight'>> & HotelAssignmentConfig = {
    affinityBonusMultiplier: 5,
    floorPenaltyMultiplier: 1.25,
    roomProximityWeight: 2.5,
    floorOwnershipBonus: 280,
    heavyRoomFairnessWeight: 260,
    ...hotelConfig,
  };
  const rand = config.randomSeed ? seededRandom(config.randomSeed) : () => 0;

  if (staff.length === 0 || rooms.length === 0) {
    return staff.map(s => previewFromRooms(s, []));
  }

  let allRooms = [...rooms];
  if (isHotelMemoriesBudapest(config.hotelName)) {
    allRooms = applyMemoriesZones(allRooms);
  } else if (config.wingZoneMapping) {
    allRooms = allRooms.map(room => {
      if (room.wing && config.wingZoneMapping![room.wing]) {
        return { ...room, wing: config.wingZoneMapping![room.wing] };
      }
      return room;
    });
  }

  const assignments = new Map<string, RoomForAssignment[]>();
  const staffMinutes = new Map<string, number>();
  staff.forEach(s => {
    assignments.set(s.id, []);
    staffMinutes.set(s.id, 0);
  });

  const checkoutRooms = allRooms.filter(isCheckoutRoom);
  const dailyRooms = allRooms.filter(r => !isCheckoutRoom(r));
  const dailyCleanRooms = dailyRooms.filter(r => r.linen_change_required);
  const dailyNormalRooms = dailyRooms.filter(r => !r.linen_change_required);

  const staffCount = staff.length;
  const targetCheckoutMax = Math.ceil(checkoutRooms.length / staffCount);
  const targetDailyMax = Math.ceil(dailyRooms.length / staffCount);
  const targetTotalMax = Math.ceil(allRooms.length / staffCount);
  const totalMinutes = allRooms.reduce((sum, room) => sum + calculateRoomTime(room), 0);
  const targetMinutes = totalMinutes / staffCount;
  const totalWeight = allRooms.reduce((sum, room) => sum + calculateRoomWeight(room), 0);
  const targetWeight = totalWeight / staffCount;

  // First room on a zone/floor establishes a soft owner. The owner receives a
  // meaningful locality bonus for the next nearby room, but fairness/shift
  // limits can still move work to somebody else.
  const zoneOwners = new Map<string, string>();

  function getStaffCounts(staffId: string) {
    const current = assignments.get(staffId)!;
    return {
      checkouts: current.filter(isCheckoutRoom).length,
      daily: current.filter(r => !isCheckoutRoom(r)).length,
      total: current.length,
      minutes: staffMinutes.get(staffId) || 0,
      weight: current.reduce((sum, room) => sum + calculateRoomWeight(room), 0),
      heavy: current.filter(isHeavyRoom).length,
    };
  }

  function overloadPenalty(current: number, targetMax: number): number {
    if (current < targetMax) return 0;
    const over = current - targetMax + 1;
    return over * over * 70;
  }

  function ownershipAdjustment(room: RoomForAssignment, staffId: string): number {
    const owner = zoneOwners.get(getZone(room));
    if (!owner) return 0;
    const checkoutFactor = isCheckoutRoom(room) ? 0.48 : 1;
    if (owner === staffId) return -config.floorOwnershipBonus * checkoutFactor;
    return config.floorOwnershipBonus * (isCheckoutRoom(room) ? 0.12 : 0.25);
  }

  function preferenceBonus(room: RoomForAssignment, staffId: string): number {
    const prefs = config.staffPreferences?.[staffId];
    if (!prefs?.length) return 0;
    const zone = getZone(room);
    return prefs.includes(zone) || prefs.includes(String(getFloor(room))) ? 45 : 0;
  }

  function candidateScore(room: RoomForAssignment, staffId: string): number {
    const currentRooms = assignments.get(staffId)!;
    const counts = getStaffCounts(staffId);
    const roomWeight = calculateRoomWeight(room);
    const roomMinutes = calculateRoomTime(room);
    const checkout = isCheckoutRoom(room);

    const countPenalty = checkout
      ? counts.checkouts * 560 + overloadPenalty(counts.checkouts, targetCheckoutMax)
      : counts.daily * 220 + overloadPenalty(counts.daily, targetDailyMax);
    const totalPenalty = counts.total * 60 + overloadPenalty(counts.total, targetTotalMax);

    // Gradually prefer the under-loaded worker instead of waiting until they
    // exceed the target. This makes large suites naturally fan out.
    const minutePenalty = counts.minutes * (checkout ? 1.25 : 1.0)
      + Math.max(0, counts.minutes + roomMinutes - targetMinutes) * 2.5;
    const weightPenalty = counts.weight * 70
      + Math.max(0, counts.weight + roomWeight - targetWeight) * 110;
    const heavyPenalty = isHeavyRoom(room) ? counts.heavy * config.heavyRoomFairnessWeight : 0;
    const shiftPenalty = counts.minutes + roomMinutes > AVAILABLE_WORK_MINUTES
      ? (counts.minutes + roomMinutes - AVAILABLE_WORK_MINUTES) * 30
      : 0;

    const locality = zoneFitScore(room, currentRooms, config.floorPenaltyMultiplier, wingProximityMap)
      + roomProximityScore(room, currentRooms) * config.roomProximityWeight
      + ownershipAdjustment(room, staffId);

    const affinityBonus = getAffinityBonus(
      room.room_number,
      currentRooms.map(r => r.room_number),
      affinityMap
    ) * config.affinityBonusMultiplier;

    return countPenalty + totalPenalty + minutePenalty + weightPenalty + heavyPenalty
      + shiftPenalty + locality - affinityBonus - preferenceBonus(room, staffId) + rand() * 1.5;
  }

  function assignRoom(room: RoomForAssignment) {
    const ranked = staff
      .map(s => ({ id: s.id, score: candidateScore(room, s.id) }))
      .sort((a, b) => a.score - b.score);
    const bestId = ranked[0].id;
    assignments.get(bestId)!.push(room);
    staffMinutes.set(bestId, (staffMinutes.get(bestId) || 0) + calculateRoomTime(room));
    const zone = getZone(room);
    if (!zoneOwners.has(zone)) zoneOwners.set(zone, bestId);
  }

  function distributeByZone(pool: RoomForAssignment[]) {
    const byZone = new Map<string, RoomForAssignment[]>();
    for (const room of pool) {
      const zone = getZone(room);
      if (!byZone.has(zone)) byZone.set(zone, []);
      byZone.get(zone)!.push(room);
    }

    const groups = Array.from(byZone.values()).sort((a, b) => {
      if (a.length !== b.length) return b.length - a.length;
      const aHeavy = a.filter(isHeavyRoom).length;
      const bHeavy = b.filter(isHeavyRoom).length;
      return bHeavy - aHeavy;
    });

    for (const zoneRooms of groups) {
      zoneRooms.sort((a, b) => {
        const heavyDiff = Number(isHeavyRoom(b)) - Number(isHeavyRoom(a));
        if (heavyDiff !== 0) return heavyDiff;
        const ao = roomOrdinal(a.room_number) ?? Number.MAX_SAFE_INTEGER;
        const bo = roomOrdinal(b.room_number) ?? Number.MAX_SAFE_INTEGER;
        return ao - bo;
      });
      zoneRooms.forEach(assignRoom);
    }
  }

  // Checkout workload first, then linen-change daily rooms, then normal daily.
  // This keeps the harder/less flexible work fair before filling the route with
  // light nearby tasks.
  distributeByZone(checkoutRooms);
  distributeByZone(dailyCleanRooms);
  distributeByZone(dailyNormalRooms);

  function moveRoomInternal(room: RoomForAssignment, fromId: string, toId: string) {
    if (fromId === toId) return;
    const fromRooms = assignments.get(fromId)!;
    const toRooms = assignments.get(toId)!;
    const index = fromRooms.findIndex(r => r.id === room.id);
    if (index < 0) return;
    fromRooms.splice(index, 1);
    toRooms.push(room);
    const minutes = calculateRoomTime(room);
    staffMinutes.set(fromId, (staffMinutes.get(fromId) || 0) - minutes);
    staffMinutes.set(toId, (staffMinutes.get(toId) || 0) + minutes);
  }

  function relocationScore(room: RoomForAssignment, fromId: string, toId: string): number {
    const fromRooms = assignments.get(fromId)!;
    const toRooms = assignments.get(toId)!;
    return zoneFitScore(room, toRooms, config.floorPenaltyMultiplier, wingProximityMap)
      + roomProximityScore(room, toRooms) * config.roomProximityWeight
      + removalClusterPenalty(room, fromRooms);
  }

  // Checkout count should never be materially unfair.
  for (let iter = 0; iter < 30; iter++) {
    const ranked = staff.map(s => ({ id: s.id, count: assignments.get(s.id)!.filter(isCheckoutRoom).length }))
      .sort((a, b) => b.count - a.count);
    const most = ranked[0];
    const least = ranked[ranked.length - 1];
    if (most.count - least.count <= 1) break;

    const movable = assignments.get(most.id)!
      .filter(isCheckoutRoom)
      .map(room => ({ room, score: relocationScore(room, most.id, least.id) }))
      .sort((a, b) => a.score - b.score);
    if (!movable.length) break;
    moveRoomInternal(movable[0].room, most.id, least.id);
  }

  // Daily and total counts may differ slightly to preserve efficient floor
  // routes and compensate for suites/heavier rooms.
  for (let iter = 0; iter < 30; iter++) {
    const ranked = staff.map(s => ({ id: s.id, count: assignments.get(s.id)!.filter(r => !isCheckoutRoom(r)).length }))
      .sort((a, b) => b.count - a.count);
    const most = ranked[0];
    const least = ranked[ranked.length - 1];
    if (most.count - least.count <= 2) break;

    const movable = assignments.get(most.id)!
      .filter(r => !isCheckoutRoom(r))
      .map(room => ({ room, score: relocationScore(room, most.id, least.id) }))
      .sort((a, b) => a.score - b.score);
    if (!movable.length) break;
    moveRoomInternal(movable[0].room, most.id, least.id);
  }

  for (let iter = 0; iter < 30; iter++) {
    const ranked = staff.map(s => ({ id: s.id, count: assignments.get(s.id)!.length }))
      .sort((a, b) => b.count - a.count);
    const most = ranked[0];
    const least = ranked[ranked.length - 1];
    if (most.count - least.count <= 2) break;

    const movable = assignments.get(most.id)!
      .map(room => ({
        room,
        score: relocationScore(room, most.id, least.id) + (isCheckoutRoom(room) ? 160 : 0),
      }))
      .sort((a, b) => a.score - b.score);
    if (!movable.length) break;
    moveRoomInternal(movable[0].room, most.id, least.id);
  }

  // Heavy daily-room balancing. Checkout heavies are already distributed by
  // the checkout phase; moving them here could accidentally undo CO fairness.
  for (let iter = 0; iter < 15; iter++) {
    const heavyRank = staff.map(s => ({
      id: s.id,
      heavy: assignments.get(s.id)!.filter(isHeavyRoom).length,
    })).sort((a, b) => b.heavy - a.heavy);
    const most = heavyRank[0];
    const least = heavyRank[heavyRank.length - 1];
    if (most.heavy - least.heavy <= 1) break;

    const fromRooms = assignments.get(most.id)!;
    const toRooms = assignments.get(least.id)!;
    if (fromRooms.length - toRooms.length < 0) break;

    const candidate = fromRooms
      .filter(room => isHeavyRoom(room) && !isCheckoutRoom(room))
      .map(room => ({ room, score: relocationScore(room, most.id, least.id) }))
      .sort((a, b) => a.score - b.score)[0];
    if (!candidate) break;
    moveRoomInternal(candidate.room, most.id, least.id);
  }

  // Time balancing: only move when the time spread is large and the move is a
  // real improvement. Locality is used as a tie-breaker so we do not destroy a
  // good floor route to save only a few minutes.
  for (let iter = 0; iter < 20; iter++) {
    const ranked = staff.map(s => ({ id: s.id, minutes: staffMinutes.get(s.id) || 0 }))
      .sort((a, b) => b.minutes - a.minutes);
    const heavy = ranked[0];
    const light = ranked[ranked.length - 1];
    const currentSpread = heavy.minutes - light.minutes;
    if (currentSpread <= 75) break;

    const candidates = assignments.get(heavy.id)!
      .filter(r => !isCheckoutRoom(r))
      .map(room => {
        const t = calculateRoomTime(room);
        const newSpread = Math.abs((heavy.minutes - t) - (light.minutes + t));
        return {
          room,
          newSpread,
          locality: relocationScore(room, heavy.id, light.id),
        };
      })
      .filter(c => c.newSpread < currentSpread)
      .sort((a, b) => (a.newSpread - b.newSpread) || (a.locality - b.locality));

    if (!candidates.length) break;
    // A small time improvement is not worth breaking a strong floor cluster.
    if (candidates[0].locality > 180 && currentSpread - candidates[0].newSpread < 30) break;
    moveRoomInternal(candidates[0].room, heavy.id, light.id);
  }

  // Final safety invariant: no later locality/heavy/total rebalance may leave
  // checkout workload more than one room apart. Only run when necessary, and
  // choose the geographically cheapest checkout move.
  for (let iter = 0; iter < 30; iter++) {
    const ranked = staff.map(s => ({ id: s.id, count: assignments.get(s.id)!.filter(isCheckoutRoom).length }))
      .sort((a, b) => b.count - a.count);
    const most = ranked[0];
    const least = ranked[ranked.length - 1];
    if (most.count - least.count <= 1) break;

    const movable = assignments.get(most.id)!
      .filter(isCheckoutRoom)
      .map(room => ({ room, score: relocationScore(room, most.id, least.id) }))
      .sort((a, b) => a.score - b.score);
    if (!movable.length) break;
    moveRoomInternal(movable[0].room, most.id, least.id);
  }

  return staff.map(s => previewFromRooms(s, assignments.get(s.id) || []));
}

// Move a room from one staff member to another (manual drag-and-drop).
export function moveRoom(
  previews: AssignmentPreview[],
  roomId: string,
  fromStaffId: string,
  toStaffId: string
): AssignmentPreview[] {
  if (fromStaffId === toStaffId) return previews;

  const room = previews.find(p => p.staffId === fromStaffId)?.rooms.find(r => r.id === roomId);
  if (!room) return previews;

  return previews.map(preview => {
    if (preview.staffId !== fromStaffId && preview.staffId !== toStaffId) return preview;
    const nextRooms = preview.staffId === fromStaffId
      ? preview.rooms.filter(r => r.id !== roomId)
      : [...preview.rooms, room];

    const sorted = sortRoomsOptimally(nextRooms);
    const estimate = calculateTimeEstimation(sorted);
    return {
      ...preview,
      rooms: sorted,
      totalWeight: sorted.reduce((sum, r) => sum + calculateRoomWeight(r), 0),
      checkoutCount: sorted.filter(isCheckoutRoom).length,
      dailyCount: sorted.filter(r => !isCheckoutRoom(r)).length,
      ...estimate,
    };
  });
}

// Export zone data for visual map.
export const MEMORIES_BUDAPEST_ZONES = MEMORIES_ZONES;
