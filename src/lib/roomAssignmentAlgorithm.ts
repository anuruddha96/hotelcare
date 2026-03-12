// Room Assignment Algorithm - FAIRNESS-FIRST approach
// Priority: 1) Equal checkout distribution 2) Fair C/daily distribution 3) Floor proximity

// Time constants (in minutes)
export const CHECKOUT_MINUTES = 45;
export const DAILY_MINUTES = 15;
export const TOWEL_CHANGE_MINUTES = 10;
export const LINEN_CHANGE_MINUTES = 10;
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

// Calculate estimated time for a room in minutes
export function calculateRoomTime(room: RoomForAssignment): number {
  if (room.towel_change_required && !room.is_checkout_room && !room.linen_change_required) {
    return TOWEL_CHANGE_MINUTES;
  }
  const size = room.room_size_sqm || 20;
  let baseTime: number;
  if (room.is_checkout_room) {
    if (size >= 40) baseTime = 60;
    else if (size >= 28) baseTime = 55;
    else baseTime = 45;
  } else {
    if (size >= 40) baseTime = 20;
    else if (size >= 28) baseTime = 18;
    else baseTime = 15;
  }
  if (room.linen_change_required && !room.is_checkout_room) {
    baseTime += LINEN_CHANGE_MINUTES;
  }
  return baseTime;
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
  let weight = room.is_checkout_room ? 1.5 : 1.0;
  if (room.linen_change_required && !room.is_checkout_room) {
    weight += 0.5; // Clean Room (C) adds significant weight
  }
  if (room.towel_change_required && !room.is_checkout_room) {
    weight += 0.2;
  }
  const size = room.room_size_sqm || 20;
  if (size >= 40) weight += 1.0;
  else if (size >= 28) weight += 0.6;
  else if (size >= 22) weight += 0.3;
  const capacity = room.room_capacity || 2;
  if (capacity >= 4) weight += 0.3;
  else if (capacity >= 3) weight += 0.15;
  return weight;
}

export function getFloorFromRoomNumber(roomNumber: string): number {
  const num = parseInt(roomNumber, 10);
  if (isNaN(num)) return 0;
  return Math.floor(num / 100);
}

// Wing proximity map type
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
}

// ─── HELPER FUNCTIONS ───

function getFloor(room: RoomForAssignment): number {
  return room.floor_number ?? getFloorFromRoomNumber(room.room_number);
}

function getWing(room: RoomForAssignment): string {
  return room.wing || `floor-${getFloor(room)}`;
}

function getStaffFloors(rooms: RoomForAssignment[]): Set<number> {
  const floors = new Set<number>();
  rooms.forEach(r => floors.add(getFloor(r)));
  return floors;
}

// Score how well a room fits with a staff member's existing rooms (lower = better)
function floorFitScore(room: RoomForAssignment, staffRooms: RoomForAssignment[]): number {
  if (staffRooms.length === 0) return 0;
  const roomFloor = getFloor(room);
  const floors = getStaffFloors(staffRooms);
  
  if (floors.has(roomFloor)) return 0; // Same floor = perfect
  
  // Penalty for each additional floor
  const floorCount = floors.size + 1;
  if (floorCount >= 4) return 1000; // Never allow 4+ floors
  if (floorCount >= 3) return 200;  // Very strongly avoid 3 floors
  
  // For 2 floors: penalize based on distance between floors
  const existingFloors = Array.from(floors);
  const minFloorDist = Math.min(...existingFloors.map(f => Math.abs(f - roomFloor)));
  return 20 + minFloorDist * 10; // Adjacent floors = 30, 2-apart = 40, etc.
}

// Room proximity score (lower = closer, better)
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

// Affinity bonus for placing a room with existing rooms
function getAffinityBonus(
  roomNumber: string, existingRoomNumbers: string[], affinityMap?: RoomAffinityMap
): number {
  if (!affinityMap || affinityMap.size === 0) return 0;
  let bonus = 0;
  for (const existing of existingRoomNumbers) {
    const score = affinityMap.get(affinityKey(roomNumber, existing));
    if (score) bonus += score;
  }
  return bonus;
}

// Sort rooms optimally for display: checkouts first, then by floor, then room number
function sortRoomsOptimally(rooms: RoomForAssignment[]): RoomForAssignment[] {
  return [...rooms].sort((a, b) => {
    if (a.is_checkout_room && !b.is_checkout_room) return -1;
    if (!a.is_checkout_room && b.is_checkout_room) return 1;
    const floorA = getFloor(a);
    const floorB = getFloor(b);
    if (floorA !== floorB) return floorA - floorB;
    return parseInt(a.room_number) - parseInt(b.room_number);
  });
}

// ─── MAIN ALGORITHM: FAIRNESS-FIRST ───

export function autoAssignRooms(
  rooms: RoomForAssignment[],
  staff: StaffForAssignment[],
  wingProximityMap?: WingProximityMap,
  affinityMap?: RoomAffinityMap,
  hotelConfig?: HotelAssignmentConfig
): AssignmentPreview[] {
  const config = { ...{ affinityBonusMultiplier: 15 }, ...hotelConfig };
  
  if (staff.length === 0 || rooms.length === 0) {
    return staff.map(s => ({
      staffId: s.id, staffName: s.full_name, rooms: [],
      totalWeight: 0, checkoutCount: 0, dailyCount: 0,
      estimatedMinutes: 0, totalWithBreak: BREAK_TIME_MINUTES,
      exceedsShift: false, overageMinutes: 0
    }));
  }

  // Apply wing zone mapping if provided
  let allRooms = [...rooms];
  if (config.wingZoneMapping) {
    allRooms = allRooms.map(room => {
      if (room.wing && config.wingZoneMapping![room.wing]) {
        return { ...room, wing: config.wingZoneMapping![room.wing] };
      }
      return room;
    });
  }

  // Initialize per-staff state
  const assignments = new Map<string, RoomForAssignment[]>();
  const staffWeights = new Map<string, number>();
  staff.forEach(s => {
    assignments.set(s.id, []);
    staffWeights.set(s.id, 0);
  });

  // ─── CATEGORIZE ROOMS ───
  const checkoutRooms = allRooms.filter(r => r.is_checkout_room);
  const dailyRooms = allRooms.filter(r => !r.is_checkout_room);
  const dailyCleanRooms = dailyRooms.filter(r => r.linen_change_required); // C rooms (heavier)
  const dailyNormalRooms = dailyRooms.filter(r => !r.linen_change_required); // T or normal rooms

  const staffCount = staff.length;

  // ─── PHASE 1: DISTRIBUTE CHECKOUTS EVENLY ───
  // Group checkouts by floor, then distribute round-robin
  const checkoutsByFloor = new Map<number, RoomForAssignment[]>();
  checkoutRooms.forEach(r => {
    const f = getFloor(r);
    if (!checkoutsByFloor.has(f)) checkoutsByFloor.set(f, []);
    checkoutsByFloor.get(f)!.push(r);
  });

  // Sort floor groups by size (largest first) for better distribution
  const checkoutFloorGroups = Array.from(checkoutsByFloor.entries())
    .sort((a, b) => b[1].length - a[1].length);

  // Target checkouts per person
  const targetCheckouts = Math.ceil(checkoutRooms.length / staffCount);
  
  // Assign checkout floor groups to staff, keeping floors together
  for (const [floor, floorRooms] of checkoutFloorGroups) {
    // Sort rooms within floor by room number
    floorRooms.sort((a, b) => parseInt(a.room_number) - parseInt(b.room_number));
    
    for (const room of floorRooms) {
      // Find best staff: fewest checkouts first, then best floor fit
      const candidates = staff.map(s => {
        const sRooms = assignments.get(s.id)!;
        const sCheckouts = sRooms.filter(r => r.is_checkout_room).length;
        const fitScore = floorFitScore(room, sRooms);
        const proxScore = roomProximityScore(room, sRooms);
        const affinityBonus = getAffinityBonus(
          room.room_number, sRooms.map(r => r.room_number), affinityMap
        ) * (config.affinityBonusMultiplier || 15);
        
        // Primary: checkout count (heavily weighted to enforce equality)
        // Secondary: floor fit
        // Tertiary: proximity within floor
        return {
          id: s.id,
          checkouts: sCheckouts,
          score: sCheckouts * 1000 + fitScore * 10 + proxScore - affinityBonus
        };
      }).sort((a, b) => a.score - b.score);

      const bestId = candidates[0].id;
      assignments.get(bestId)!.push(room);
      staffWeights.set(bestId, staffWeights.get(bestId)! + calculateRoomWeight(room));
    }
  }

  // ─── PHASE 2: DISTRIBUTE CLEAN ROOM (C) DAILY ROOMS FAIRLY ───
  // Staff with fewer checkouts should get more C rooms to balance workload
  // Group C rooms by floor
  const cleanByFloor = new Map<number, RoomForAssignment[]>();
  dailyCleanRooms.forEach(r => {
    const f = getFloor(r);
    if (!cleanByFloor.has(f)) cleanByFloor.set(f, []);
    cleanByFloor.get(f)!.push(r);
  });

  const cleanFloorGroups = Array.from(cleanByFloor.entries())
    .sort((a, b) => b[1].length - a[1].length);

  for (const [floor, floorRooms] of cleanFloorGroups) {
    floorRooms.sort((a, b) => parseInt(a.room_number) - parseInt(b.room_number));
    
    for (const room of floorRooms) {
      // Find best staff: lightest total weight first, then floor fit
      const candidates = staff.map(s => {
        const sRooms = assignments.get(s.id)!;
        const weight = staffWeights.get(s.id)!;
        const fitScore = floorFitScore(room, sRooms);
        const proxScore = roomProximityScore(room, sRooms);
        const affinityBonus = getAffinityBonus(
          room.room_number, sRooms.map(r => r.room_number), affinityMap
        ) * (config.affinityBonusMultiplier || 15);
        
        // Primary: total weight (balance workload)
        // Secondary: floor fit (keep on same floors)
        return {
          id: s.id,
          score: weight * 5 + fitScore * 10 + proxScore - affinityBonus
        };
      }).sort((a, b) => a.score - b.score);

      const bestId = candidates[0].id;
      assignments.get(bestId)!.push(room);
      staffWeights.set(bestId, staffWeights.get(bestId)! + calculateRoomWeight(room));
    }
  }

  // ─── PHASE 3: DISTRIBUTE REMAINING DAILY ROOMS (T and normal) ───
  // Group by floor, assign to lightest staff respecting floor proximity
  const normalByFloor = new Map<number, RoomForAssignment[]>();
  dailyNormalRooms.forEach(r => {
    const f = getFloor(r);
    if (!normalByFloor.has(f)) normalByFloor.set(f, []);
    normalByFloor.get(f)!.push(r);
  });

  const normalFloorGroups = Array.from(normalByFloor.entries())
    .sort((a, b) => b[1].length - a[1].length);

  for (const [floor, floorRooms] of normalFloorGroups) {
    floorRooms.sort((a, b) => parseInt(a.room_number) - parseInt(b.room_number));
    
    for (const room of floorRooms) {
      const candidates = staff.map(s => {
        const sRooms = assignments.get(s.id)!;
        const weight = staffWeights.get(s.id)!;
        const fitScore = floorFitScore(room, sRooms);
        const proxScore = roomProximityScore(room, sRooms);
        const affinityBonus = getAffinityBonus(
          room.room_number, sRooms.map(r => r.room_number), affinityMap
        ) * (config.affinityBonusMultiplier || 15);
        
        return {
          id: s.id,
          score: weight * 5 + fitScore * 10 + proxScore - affinityBonus
        };
      }).sort((a, b) => a.score - b.score);

      const bestId = candidates[0].id;
      assignments.get(bestId)!.push(room);
      staffWeights.set(bestId, staffWeights.get(bestId)! + calculateRoomWeight(room));
    }
  }

  // ─── PHASE 4: FINAL REBALANCING ───
  // 4a: Ensure checkout equality (max diff of 1)
  let eqIter = 0;
  while (eqIter < 20) {
    eqIter++;
    const coCounts = staff.map(s => ({
      id: s.id,
      checkouts: assignments.get(s.id)!.filter(r => r.is_checkout_room).length
    })).sort((a, b) => b.checkouts - a.checkouts);
    
    const most = coCounts[0];
    const least = coCounts[coCounts.length - 1];
    if (most.checkouts - least.checkouts <= 1) break;

    // Move a checkout from most to least, preferring one on a floor least already has
    const mostRooms = assignments.get(most.id)!;
    const leastRooms = assignments.get(least.id)!;
    const movableCheckouts = mostRooms.filter(r => r.is_checkout_room);
    
    const scored = movableCheckouts.map(room => {
      const fit = floorFitScore(room, leastRooms);
      const prox = roomProximityScore(room, leastRooms);
      return { room, score: fit + prox };
    }).sort((a, b) => a.score - b.score);

    if (scored.length === 0) break;
    const roomToMove = scored[0].room;
    const rw = calculateRoomWeight(roomToMove);
    
    mostRooms.splice(mostRooms.indexOf(roomToMove), 1);
    leastRooms.push(roomToMove);
    staffWeights.set(most.id, staffWeights.get(most.id)! - rw);
    staffWeights.set(least.id, staffWeights.get(least.id)! + rw);
  }

  // 4b: Room count rebalancing (max diff of 2 total rooms)
  let countIter = 0;
  while (countIter < 20) {
    countIter++;
    const counts = staff.map(s => ({
      id: s.id, count: assignments.get(s.id)!.length
    })).sort((a, b) => b.count - a.count);
    
    const most = counts[0];
    const least = counts[counts.length - 1];
    if (most.count - least.count <= 2) break;

    const mostRooms = assignments.get(most.id)!;
    const leastRooms = assignments.get(least.id)!;
    
    // Prefer moving daily rooms that fit the target's floors
    const movable = mostRooms
      .filter(r => !r.is_checkout_room) // prefer not moving checkouts
      .map(room => ({
        room,
        score: floorFitScore(room, leastRooms) + roomProximityScore(room, leastRooms)
      }))
      .sort((a, b) => a.score - b.score);

    if (movable.length === 0) break;
    const roomToMove = movable[0].room;
    const rw = calculateRoomWeight(roomToMove);

    mostRooms.splice(mostRooms.indexOf(roomToMove), 1);
    leastRooms.push(roomToMove);
    staffWeights.set(most.id, staffWeights.get(most.id)! - rw);
    staffWeights.set(least.id, staffWeights.get(least.id)! + rw);
  }

  // 4c: Weight rebalancing - if weight diff > 25%, swap rooms between heavy/light staff
  const totalWeight = Array.from(staffWeights.values()).reduce((a, b) => a + b, 0);
  const avgWeight = totalWeight / staffCount;
  let weightIter = 0;
  while (weightIter < 15) {
    weightIter++;
    const sorted = Array.from(staffWeights.entries()).sort((a, b) => b[1] - a[1]);
    const [heavyId, heavyW] = sorted[0];
    const [lightId, lightW] = sorted[sorted.length - 1];
    if (heavyW - lightW < avgWeight * 0.25) break;

    const heavyRooms = assignments.get(heavyId)!;
    const lightRooms = assignments.get(lightId)!;

    // Find best daily room to move (don't move checkouts to preserve checkout equality)
    let bestRoom: RoomForAssignment | null = null;
    let bestScore = Infinity;

    for (const room of heavyRooms) {
      if (room.is_checkout_room) continue;
      const w = calculateRoomWeight(room);
      const newDiff = Math.abs((heavyW - w) - (lightW + w));
      if (newDiff >= heavyW - lightW) continue; // Must improve

      const fit = floorFitScore(room, lightRooms);
      if (fit >= 200) continue; // Don't add 3rd floor
      
      const score = newDiff + fit;
      if (score < bestScore) {
        bestScore = score;
        bestRoom = room;
      }
    }

    if (!bestRoom) break;
    const rw = calculateRoomWeight(bestRoom);
    heavyRooms.splice(heavyRooms.indexOf(bestRoom), 1);
    lightRooms.push(bestRoom);
    staffWeights.set(heavyId, heavyW - rw);
    staffWeights.set(lightId, lightW + rw);
  }

  // ─── BUILD FINAL PREVIEW ───
  return staff.map(s => {
    const staffRooms = sortRoomsOptimally(assignments.get(s.id) || []);
    const timeEstimate = calculateTimeEstimation(staffRooms);
    return {
      staffId: s.id,
      staffName: s.full_name,
      rooms: staffRooms,
      totalWeight: staffWeights.get(s.id) || 0,
      checkoutCount: staffRooms.filter(r => r.is_checkout_room).length,
      dailyCount: staffRooms.filter(r => !r.is_checkout_room).length,
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
  if (room.is_checkout_room) fromPreview.checkoutCount--;
  else fromPreview.dailyCount--;

  toPreview.rooms.push(room);
  toPreview.totalWeight += roomWeight;
  if (room.is_checkout_room) toPreview.checkoutCount++;
  else toPreview.dailyCount++;

  toPreview.rooms = sortRoomsOptimally(toPreview.rooms);

  const fromTime = calculateTimeEstimation(fromPreview.rooms);
  const toTime = calculateTimeEstimation(toPreview.rooms);
  Object.assign(fromPreview, fromTime);
  Object.assign(toPreview, toTime);

  return newPreviews;
}
