// Room Assignment Algorithm - FAIRNESS-FIRST approach
// Priority: 1) Equal checkout distribution 2) Fair daily distribution 3) Zone proximity

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
  pms_metadata?: {
    scheduledDepartureToday?: boolean;
    [key: string]: any;
  } | null;
  status: string;
  towel_change_required?: boolean;
  linen_change_required?: boolean;
  wing?: string | null;
  elevator_proximity?: number | null;
  room_category?: string | null;
  bed_configuration?: string | null;
  ready_to_clean?: boolean;
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

// Fairness metrics for quality scoring
export interface FairnessMetrics {
  checkoutDiff: number;
  dailyDiff: number;
  totalDiff: number;
  timeSpreadMinutes: number;
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
  for (const room of rooms) {
    MEMORIES_ROOM_TO_ZONE[room] = zone;
  }
}

export function getMemoriesZone(roomNumber: string): string {
  return MEMORIES_ROOM_TO_ZONE[roomNumber] || `unknown-${roomNumber}`;
}

export function isHotelMemoriesBudapest(hotelName: string | undefined | null): boolean {
  return hotelName === 'Hotel Memories Budapest';
}

export function applyMemoriesZones(rooms: RoomForAssignment[]): RoomForAssignment[] {
  return rooms.map(room => ({
    ...room,
    wing: getMemoriesZone(room.room_number),
  }));
}

// Calculate estimated time for a room in minutes
export function calculateRoomTime(room: RoomForAssignment): number {
  const isCheckout = room.is_checkout_room || room.pms_metadata?.scheduledDepartureToday === true;
  if (room.towel_change_required && !isCheckout && !room.linen_change_required) {
    return TOWEL_CHANGE_MINUTES;
  }
  if (room.linen_change_required && !isCheckout) {
    return LINEN_CHANGE_MINUTES;
  }
  if (!isCheckout) {
    return DAILY_MINUTES;
  }
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

export function calculateRoomWeight(room: RoomForAssignment): number {
  if (room.towel_change_required && !room.is_checkout_room && !room.linen_change_required) {
    return 0.4;
  }
  const isCheckout = room.is_checkout_room || room.pms_metadata?.scheduledDepartureToday === true;
  let weight = isCheckout ? 1.5 : 1.0;
  if (room.linen_change_required && !isCheckout) {
    weight += 0.5;
  }
  if (room.towel_change_required && !isCheckout) {
    weight += 0.2;
  }
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
}

// ─── HELPER FUNCTIONS ───

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

// Zone-aware fit score (lower = better)
function zoneFitScore(room: RoomForAssignment, staffRooms: RoomForAssignment[]): number {
  if (staffRooms.length === 0) return 0;
  const roomZone = getZone(room);
  const zones = getStaffZones(staffRooms);
  
  if (zones.has(roomZone)) return 0;
  
  const zoneCount = zones.size + 1;
  if (zoneCount >= 4) return 100; // Penalize but don't block
  if (zoneCount >= 3) return 60;
  
  const existingZones = Array.from(zones);
  const isAdjacent = existingZones.some(z => areZonesAdjacent(z, roomZone));
  
  return isAdjacent ? 10 : 40;
}

function areZonesAdjacent(zoneA: string, zoneB: string): boolean {
  const adjacencyMap: Record<string, string[]> = {
    'ground': ['f1-left', 'f1-right'],
    'f1-left': ['ground', 'f1-right', 'f2-f3'],
    'f1-right': ['ground', 'f1-left', 'f2-f3'],
    'f2-f3': ['f1-left', 'f1-right'],
  };
  return adjacencyMap[zoneA]?.includes(zoneB) || adjacencyMap[zoneB]?.includes(zoneA) || false;
}

function roomProximityScore(room: RoomForAssignment, staffRooms: RoomForAssignment[]): number {
  if (staffRooms.length === 0) return 0;
  const num = parseInt(room.room_number, 10);
  if (isNaN(num)) return 0;
  let closestDist = Infinity;
  for (const existing of staffRooms) {
    const existingNum = parseInt(existing.room_number, 10);
    if (!isNaN(existingNum)) {
      closestDist = Math.min(closestDist, Math.abs(num - existingNum));
    }
  }
  return closestDist === Infinity ? 0 : closestDist;
}

// Affinity bonus - CAPPED to prevent snowball
function getAffinityBonus(
  roomNumber: string, existingRoomNumbers: string[], affinityMap?: RoomAffinityMap
): number {
  if (!affinityMap || affinityMap.size === 0) return 0;
  let bonus = 0;
  for (const existing of existingRoomNumbers) {
    const score = affinityMap.get(affinityKey(roomNumber, existing));
    if (score) bonus += score;
  }
  // Cap at 3.0 to prevent rich-get-richer
  return Math.min(bonus, 3.0);
}

function sortRoomsOptimally(rooms: RoomForAssignment[]): RoomForAssignment[] {
  return [...rooms].sort((a, b) => {
    const aIsCheckout = a.is_checkout_room || a.pms_metadata?.scheduledDepartureToday === true;
    const bIsCheckout = b.is_checkout_room || b.pms_metadata?.scheduledDepartureToday === true;
    if (aIsCheckout && !bIsCheckout) return -1;
    if (!aIsCheckout && bIsCheckout) return 1;
    const floorA = getFloor(a);
    const floorB = getFloor(b);
    if (floorA !== floorB) return floorA - floorB;
    return parseInt(a.room_number) - parseInt(b.room_number);
  });
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return (s / 0x7fffffff);
  };
}

// ─── FAIRNESS SCORING ───

export function computeFairnessMetrics(previews: AssignmentPreview[]): FairnessMetrics {
  const active = previews.filter(p => p.rooms.length > 0);
  if (active.length <= 1) {
    return { checkoutDiff: 0, dailyDiff: 0, totalDiff: 0, timeSpreadMinutes: 0, score: 0 };
  }
  
  const checkouts = active.map(p => p.checkoutCount);
  const dailies = active.map(p => p.dailyCount);
  const totals = active.map(p => p.rooms.length);
  const times = active.map(p => p.estimatedMinutes);
  
  const checkoutDiff = Math.max(...checkouts) - Math.min(...checkouts);
  const dailyDiff = Math.max(...dailies) - Math.min(...dailies);
  const totalDiff = Math.max(...totals) - Math.min(...totals);
  const timeSpreadMinutes = Math.max(...times) - Math.min(...times);
  
  // Score: heavily penalize count imbalances, then time spread
  const score = 
    checkoutDiff * 2000 +
    dailyDiff * 800 +
    totalDiff * 400 +
    timeSpreadMinutes * 5;
  
  return { checkoutDiff, dailyDiff, totalDiff, timeSpreadMinutes, score };
}

// ─── MAIN ALGORITHM: FAIRNESS-FIRST ───

export function autoAssignRooms(
  rooms: RoomForAssignment[],
  staff: StaffForAssignment[],
  wingProximityMap?: WingProximityMap,
  affinityMap?: RoomAffinityMap,
  hotelConfig?: HotelAssignmentConfig
): AssignmentPreview[] {
  const config = { ...{ affinityBonusMultiplier: 5 }, ...hotelConfig };
  const rand = config.randomSeed ? seededRandom(config.randomSeed) : () => 0;
  
  if (staff.length === 0 || rooms.length === 0) {
    return staff.map(s => ({
      staffId: s.id, staffName: s.full_name, rooms: [],
      totalWeight: 0, checkoutCount: 0, dailyCount: 0,
      estimatedMinutes: 0, totalWithBreak: BREAK_TIME_MINUTES,
      exceedsShift: false, overageMinutes: 0
    }));
  }

  // Apply zone mapping
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

  // Initialize per-staff state
  const assignments = new Map<string, RoomForAssignment[]>();
  const staffMinutes = new Map<string, number>();
  staff.forEach(s => {
    assignments.set(s.id, []);
    staffMinutes.set(s.id, 0);
  });

  // ─── CATEGORIZE ROOMS ───
  const checkoutRooms = allRooms.filter(r => r.is_checkout_room || r.pms_metadata?.scheduledDepartureToday === true);
  const dailyRooms = allRooms.filter(r => !(r.is_checkout_room || r.pms_metadata?.scheduledDepartureToday === true));
  const dailyCleanRooms = dailyRooms.filter(r => r.linen_change_required);
  const dailyNormalRooms = dailyRooms.filter(r => !r.linen_change_required);

  const staffCount = staff.length;
  
  // ─── FAIRNESS TARGETS ───
  const targetCheckoutMin = Math.floor(checkoutRooms.length / staffCount);
  const targetCheckoutMax = Math.ceil(checkoutRooms.length / staffCount);
  const targetDailyMin = Math.floor(dailyRooms.length / staffCount);
  const targetDailyMax = Math.ceil(dailyRooms.length / staffCount);
  const totalRoomCount = allRooms.length;
  const targetTotalMin = Math.floor(totalRoomCount / staffCount);
  const targetTotalMax = Math.ceil(totalRoomCount / staffCount);
  const totalMinutes = allRooms.reduce((s, r) => s + calculateRoomTime(r), 0);
  const targetMinutesPerStaff = totalMinutes / staffCount;

  // Helper: get staff's current counts
  function getStaffCounts(staffId: string) {
    const rooms = assignments.get(staffId)!;
    const checkouts = rooms.filter(r => r.is_checkout_room || r.pms_metadata?.scheduledDepartureToday === true).length;
    const daily = rooms.filter(r => !(r.is_checkout_room || r.pms_metadata?.scheduledDepartureToday === true)).length;
    const minutes = staffMinutes.get(staffId)!;
    return { checkouts, daily, total: rooms.length, minutes };
  }

  // Overload penalty: quadratic ramp when over target
  function overloadPenalty(current: number, targetMax: number): number {
    if (current < targetMax) return 0;
    const over = current - targetMax + 1;
    return over * over * 50; // quadratic: 50, 200, 450, 800...
  }

  // Minute deficit score: how far below average (negative = needs more work)
  function minuteDeficitScore(staffId: string): number {
    const mins = staffMinutes.get(staffId)!;
    return mins - targetMinutesPerStaff; // negative = under-loaded
  }

  // ─── PHASE 1: DISTRIBUTE CHECKOUTS EVENLY ───
  // Group checkouts by zone, then distribute round-robin respecting fairness
  const checkoutsByZone = new Map<string, RoomForAssignment[]>();
  checkoutRooms.forEach(r => {
    const z = getZone(r);
    if (!checkoutsByZone.has(z)) checkoutsByZone.set(z, []);
    checkoutsByZone.get(z)!.push(r);
  });

  const checkoutZoneGroups = Array.from(checkoutsByZone.entries())
    .sort((a, b) => b[1].length - a[1].length);

  for (const [, zoneRooms] of checkoutZoneGroups) {
    zoneRooms.sort((a, b) => parseInt(a.room_number) - parseInt(b.room_number));
    
    for (const room of zoneRooms) {
      const candidates = staff.map(s => {
        const counts = getStaffCounts(s.id);
        const sRooms = assignments.get(s.id)!;
        const fitScore = zoneFitScore(room, sRooms);
        const proxScore = roomProximityScore(room, sRooms);
        const affinityBonus = getAffinityBonus(
          room.room_number, sRooms.map(r => r.room_number), affinityMap
        ) * (config.affinityBonusMultiplier || 5);
        const randomPerturbation = rand() * 2; // tiny tie-breaker
        
        // PRIMARY: checkout count fairness (massive weight)
        // SECONDARY: minute balance
        // TERTIARY: zone fit (soft)
        const fairnessPenalty = counts.checkouts * 500 + overloadPenalty(counts.checkouts, targetCheckoutMax);
        const minutePenalty = Math.max(0, counts.minutes - targetMinutesPerStaff) * 2;
        
        return {
          id: s.id,
          score: fairnessPenalty + minutePenalty + fitScore + proxScore * 0.5 - affinityBonus + randomPerturbation
        };
      }).sort((a, b) => a.score - b.score);

      const bestId = candidates[0].id;
      assignments.get(bestId)!.push(room);
      staffMinutes.set(bestId, staffMinutes.get(bestId)! + calculateRoomTime(room));
    }
  }

  // ─── PHASE 2: DISTRIBUTE CLEAN ROOM (C) DAILY ROOMS FAIRLY ───
  // Staff with fewer checkouts / lower minutes get priority
  const cleanByZone = new Map<string, RoomForAssignment[]>();
  dailyCleanRooms.forEach(r => {
    const z = getZone(r);
    if (!cleanByZone.has(z)) cleanByZone.set(z, []);
    cleanByZone.get(z)!.push(r);
  });

  const cleanZoneGroups = Array.from(cleanByZone.entries())
    .sort((a, b) => b[1].length - a[1].length);

  for (const [, zoneRooms] of cleanZoneGroups) {
    zoneRooms.sort((a, b) => parseInt(a.room_number) - parseInt(b.room_number));
    
    for (const room of zoneRooms) {
      const candidates = staff.map(s => {
        const counts = getStaffCounts(s.id);
        const sRooms = assignments.get(s.id)!;
        const fitScore = zoneFitScore(room, sRooms);
        const proxScore = roomProximityScore(room, sRooms);
        const affinityBonus = getAffinityBonus(
          room.room_number, sRooms.map(r => r.room_number), affinityMap
        ) * (config.affinityBonusMultiplier || 5);
        const randomPerturbation = rand() * 2;
        
        // PRIMARY: daily count fairness + minute balance
        const dailyPenalty = counts.daily * 200 + overloadPenalty(counts.daily, targetDailyMax);
        const minutePenalty = Math.max(0, counts.minutes - targetMinutesPerStaff) * 3;
        const totalPenalty = overloadPenalty(counts.total, targetTotalMax);
        
        return {
          id: s.id,
          score: dailyPenalty + minutePenalty + totalPenalty + fitScore + proxScore * 0.3 - affinityBonus + randomPerturbation
        };
      }).sort((a, b) => a.score - b.score);

      const bestId = candidates[0].id;
      assignments.get(bestId)!.push(room);
      staffMinutes.set(bestId, staffMinutes.get(bestId)! + calculateRoomTime(room));
    }
  }

  // ─── PHASE 3: DISTRIBUTE REMAINING DAILY ROOMS (T and normal) ───
  const normalByZone = new Map<string, RoomForAssignment[]>();
  dailyNormalRooms.forEach(r => {
    const z = getZone(r);
    if (!normalByZone.has(z)) normalByZone.set(z, []);
    normalByZone.get(z)!.push(r);
  });

  const normalZoneGroups = Array.from(normalByZone.entries())
    .sort((a, b) => b[1].length - a[1].length);

  for (const [, zoneRooms] of normalZoneGroups) {
    zoneRooms.sort((a, b) => parseInt(a.room_number) - parseInt(b.room_number));
    
    for (const room of zoneRooms) {
      const candidates = staff.map(s => {
        const counts = getStaffCounts(s.id);
        const sRooms = assignments.get(s.id)!;
        const fitScore = zoneFitScore(room, sRooms);
        const proxScore = roomProximityScore(room, sRooms);
        const affinityBonus = getAffinityBonus(
          room.room_number, sRooms.map(r => r.room_number), affinityMap
        ) * (config.affinityBonusMultiplier || 5);
        const randomPerturbation = rand() * 2;
        
        // PRIMARY: daily count + total count fairness + minute balance
        const dailyPenalty = counts.daily * 200 + overloadPenalty(counts.daily, targetDailyMax);
        const minutePenalty = Math.max(0, counts.minutes - targetMinutesPerStaff) * 3;
        const totalPenalty = overloadPenalty(counts.total, targetTotalMax);
        
        return {
          id: s.id,
          score: dailyPenalty + minutePenalty + totalPenalty + fitScore + proxScore * 0.3 - affinityBonus + randomPerturbation
        };
      }).sort((a, b) => a.score - b.score);

      const bestId = candidates[0].id;
      assignments.get(bestId)!.push(room);
      staffMinutes.set(bestId, staffMinutes.get(bestId)! + calculateRoomTime(room));
    }
  }

  // ─── PHASE 4: MULTI-PASS REBALANCING ───
  
  // Helper to move a room between staff
  function moveRoomInternal(roomToMove: RoomForAssignment, fromId: string, toId: string) {
    const fromRooms = assignments.get(fromId)!;
    const toRooms = assignments.get(toId)!;
    const idx = fromRooms.indexOf(roomToMove);
    if (idx === -1) return;
    fromRooms.splice(idx, 1);
    toRooms.push(roomToMove);
    const time = calculateRoomTime(roomToMove);
    staffMinutes.set(fromId, staffMinutes.get(fromId)! - time);
    staffMinutes.set(toId, staffMinutes.get(toId)! + time);
  }

  // 4a: Ensure checkout equality (max diff of 1)
  for (let iter = 0; iter < 30; iter++) {
    const coCounts = staff.map(s => ({
      id: s.id,
      checkouts: assignments.get(s.id)!.filter(r => r.is_checkout_room).length
    })).sort((a, b) => b.checkouts - a.checkouts);
    
    const most = coCounts[0];
    const least = coCounts[coCounts.length - 1];
    if (most.checkouts - least.checkouts <= 1) break;

    const mostRooms = assignments.get(most.id)!;
    const leastRooms = assignments.get(least.id)!;
    const movableCheckouts = mostRooms.filter(r => r.is_checkout_room);
    
    // Pick best-fit checkout to move (zone is secondary, fairness is primary)
    const scored = movableCheckouts.map(room => {
      const fit = zoneFitScore(room, leastRooms);
      const prox = roomProximityScore(room, leastRooms);
      return { room, score: fit + prox * 0.5 };
    }).sort((a, b) => a.score - b.score);

    if (scored.length === 0) break;
    moveRoomInternal(scored[0].room, most.id, least.id);
  }

  // 4b: Ensure daily equality (max diff of 2)
  for (let iter = 0; iter < 30; iter++) {
    const dailyCounts = staff.map(s => ({
      id: s.id,
      daily: assignments.get(s.id)!.filter(r => !r.is_checkout_room).length
    })).sort((a, b) => b.daily - a.daily);
    
    const most = dailyCounts[0];
    const least = dailyCounts[dailyCounts.length - 1];
    if (most.daily - least.daily <= 2) break;

    const mostRooms = assignments.get(most.id)!;
    const leastRooms = assignments.get(least.id)!;
    
    // Move a daily room - allow cross-zone if needed for fairness
    const movable = mostRooms
      .filter(r => !r.is_checkout_room)
      .map(room => ({
        room,
        score: zoneFitScore(room, leastRooms) + roomProximityScore(room, leastRooms) * 0.3
      }))
      .sort((a, b) => a.score - b.score);

    if (movable.length === 0) break;
    // No hard zone-block: fairness always wins
    moveRoomInternal(movable[0].room, most.id, least.id);
  }

  // 4c: Ensure total room count balance (max diff of 2)
  for (let iter = 0; iter < 30; iter++) {
    const counts = staff.map(s => ({
      id: s.id, count: assignments.get(s.id)!.length
    })).sort((a, b) => b.count - a.count);
    
    const most = counts[0];
    const least = counts[counts.length - 1];
    if (most.count - least.count <= 2) break;

    const mostRooms = assignments.get(most.id)!;
    const leastRooms = assignments.get(least.id)!;
    
    // Prefer moving daily rooms; fallback to any room
    const movable = mostRooms
      .map(room => ({
        room,
        isCheckout: room.is_checkout_room || room.pms_metadata?.scheduledDepartureToday === true,
        score: ((room.is_checkout_room || room.pms_metadata?.scheduledDepartureToday === true) ? 100 : 0) + zoneFitScore(room, leastRooms) + roomProximityScore(room, leastRooms) * 0.3
      }))
      .sort((a, b) => a.score - b.score);

    if (movable.length === 0) break;
    
    // Check that moving a checkout wouldn't break checkout balance
    const candidate = movable[0];
    if (candidate.isCheckout) {
      const mostCO = mostRooms.filter(r => r.is_checkout_room || r.pms_metadata?.scheduledDepartureToday === true).length;
      const leastCO = leastRooms.filter(r => r.is_checkout_room || r.pms_metadata?.scheduledDepartureToday === true).length;
      if (leastCO + 1 - (mostCO - 1) > 1) {
        // Moving this checkout would break CO balance; try next non-checkout
        const dailyCandidate = movable.find(m => !m.isCheckout);
        if (!dailyCandidate) break;
        moveRoomInternal(dailyCandidate.room, most.id, least.id);
        continue;
      }
    }
    
    moveRoomInternal(candidate.room, most.id, least.id);
  }

  // 4d: Time spread rebalancing via swaps
  // If time spread > 75 min, try swapping rooms between heaviest and lightest
  for (let iter = 0; iter < 20; iter++) {
    const sorted = staff.map(s => ({
      id: s.id, minutes: staffMinutes.get(s.id)!
    })).sort((a, b) => b.minutes - a.minutes);
    
    const heavy = sorted[0];
    const light = sorted[sorted.length - 1];
    if (heavy.minutes - light.minutes <= 75) break;

    const heavyRooms = assignments.get(heavy.id)!;
    const lightRooms = assignments.get(light.id)!;

    // Try to find a swap: move heavy daily room to light, and light daily room to heavy
    // that reduces the time spread
    let bestSwap: { heavyRoom: RoomForAssignment; lightRoom: RoomForAssignment; newSpread: number } | null = null;
    
    for (const hRoom of heavyRooms) {
      if (hRoom.is_checkout_room || hRoom.pms_metadata?.scheduledDepartureToday === true) continue;
      const hTime = calculateRoomTime(hRoom);
      for (const lRoom of lightRooms) {
        if (lRoom.is_checkout_room || lRoom.pms_metadata?.scheduledDepartureToday === true) continue;
        const lTime = calculateRoomTime(lRoom);
        if (hTime <= lTime) continue; // swap must reduce heavy's time
        
        const newHeavyMin = heavy.minutes - hTime + lTime;
        const newLightMin = light.minutes + hTime - lTime;
        const newSpread = Math.abs(newHeavyMin - newLightMin);
        
        if (newSpread < heavy.minutes - light.minutes) {
          if (!bestSwap || newSpread < bestSwap.newSpread) {
            bestSwap = { heavyRoom: hRoom, lightRoom: lRoom, newSpread };
          }
        }
      }
    }

    if (!bestSwap) {
      // Fallback: try simple move of a daily room from heavy to light
      const movable = heavyRooms.filter(r => !(r.is_checkout_room || r.pms_metadata?.scheduledDepartureToday === true));
      if (movable.length === 0) break;
      // Find room whose time would best reduce spread
      const best = movable.map(room => {
        const t = calculateRoomTime(room);
        const newSpread = Math.abs((heavy.minutes - t) - (light.minutes + t));
        return { room, newSpread };
      }).sort((a, b) => a.newSpread - b.newSpread)[0];
      
      if (best.newSpread >= heavy.minutes - light.minutes) break;
      
      // Check it doesn't break daily/total balance
      const heavyDaily = heavyRooms.filter(r => !(r.is_checkout_room || r.pms_metadata?.scheduledDepartureToday === true)).length;
      const lightDaily = lightRooms.filter(r => !(r.is_checkout_room || r.pms_metadata?.scheduledDepartureToday === true)).length;
      if (heavyDaily - 1 < lightDaily + 1 - 2) break; // would create daily imbalance
      
      moveRoomInternal(best.room, heavy.id, light.id);
      continue;
    }

    // Execute swap
    moveRoomInternal(bestSwap.heavyRoom, heavy.id, light.id);
    moveRoomInternal(bestSwap.lightRoom, light.id, heavy.id);
  }

  // ─── BUILD FINAL PREVIEW ───
  return staff.map(s => {
    const staffRooms = sortRoomsOptimally(assignments.get(s.id) || []);
    const timeEstimate = calculateTimeEstimation(staffRooms);
    return {
      staffId: s.id,
      staffName: s.full_name,
      rooms: staffRooms,
      totalWeight: staffRooms.reduce((sum, r) => sum + calculateRoomWeight(r), 0),
      checkoutCount: staffRooms.filter(r => r.is_checkout_room || r.pms_metadata?.scheduledDepartureToday === true).length,
      dailyCount: staffRooms.filter(r => !(r.is_checkout_room || r.pms_metadata?.scheduledDepartureToday === true)).length,
      ...timeEstimate
    };
  });
}

// Move a room from one staff to another (drag-and-drop)
export function moveRoom(
  previews: AssignmentPreview[],
  roomId: string,
  fromStaffId: string,
  toStaffId: string
): AssignmentPreview[] {
  const newPreviews = previews.map(p => ({ ...p, rooms: [...p.rooms] }));
  const fromPreview = newPreviews.find(p => p.staffId === fromStaffId);
  const toPreview = newPreviews.find(p => p.staffId === toStaffId);
  if (!fromPreview || !toPreview) return previews;

  const roomIndex = fromPreview.rooms.findIndex(r => r.id === roomId);
  if (roomIndex === -1) return previews;

  const room = fromPreview.rooms[roomIndex];
  const roomWeight = calculateRoomWeight(room);

  fromPreview.rooms.splice(roomIndex, 1);
  fromPreview.totalWeight -= roomWeight;
  if (room.is_checkout_room || room.pms_metadata?.scheduledDepartureToday === true) fromPreview.checkoutCount--;
  else fromPreview.dailyCount--;

  toPreview.rooms.push(room);
  toPreview.totalWeight += roomWeight;
  if (room.is_checkout_room || room.pms_metadata?.scheduledDepartureToday === true) toPreview.checkoutCount++;
  else toPreview.dailyCount++;

  toPreview.rooms = sortRoomsOptimally(toPreview.rooms);

  const fromTime = calculateTimeEstimation(fromPreview.rooms);
  const toTime = calculateTimeEstimation(toPreview.rooms);
  Object.assign(fromPreview, fromTime);
  Object.assign(toPreview, toTime);

  return newPreviews;
}

// Export zone data for visual map
export const MEMORIES_BUDAPEST_ZONES = MEMORIES_ZONES;
