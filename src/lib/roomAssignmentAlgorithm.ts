// Room Assignment Algorithm for fair distribution with wing-based grouping

// Time constants (in minutes)
export const CHECKOUT_MINUTES = 45;
export const DAILY_MINUTES = 15;
export const TOWEL_CHANGE_MINUTES = 5;
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
  // Towel-change-only rooms are much faster (5 min vs 15 min)
  if (room.towel_change_required && !room.is_checkout_room && !room.linen_change_required) {
    return TOWEL_CHANGE_MINUTES;
  }
  let baseTime = room.is_checkout_room ? CHECKOUT_MINUTES : DAILY_MINUTES;
  const size = room.room_size_sqm || 20;
  if (size >= 40) baseTime += 15;
  else if (size >= 28) baseTime += 10;
  else if (size >= 22) baseTime += 5;
  return baseTime;
}

// Calculate time estimation for a preview
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

// Format minutes to hours and minutes string
export function formatMinutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

// Weight calculation based on room characteristics
export function calculateRoomWeight(room: RoomForAssignment): number {
  // Towel-change-only rooms are lightweight
  if (room.towel_change_required && !room.is_checkout_room && !room.linen_change_required) {
    return 0.4;
  }
  let weight = room.is_checkout_room ? 1.5 : 1.0;
  const size = room.room_size_sqm || 20;
  if (size >= 40) weight += 1.0;
  else if (size >= 28) weight += 0.6;
  else if (size >= 22) weight += 0.3;
  const capacity = room.room_capacity || 2;
  if (capacity >= 4) weight += 0.3;
  else if (capacity >= 3) weight += 0.15;
  return weight;
}

// Get floor number from room number
export function getFloorFromRoomNumber(roomNumber: string): number {
  const num = parseInt(roomNumber, 10);
  if (isNaN(num)) return 0;
  return Math.floor(num / 100);
}

// Sequential room number bonus: rewards keeping adjacent rooms together
function getSequenceBonus(roomNumber: string, existingRooms: RoomForAssignment[]): number {
  const num = parseInt(roomNumber, 10);
  if (isNaN(num) || existingRooms.length === 0) return 0;
  let bonus = 0;
  for (const existing of existingRooms) {
    const existingNum = parseInt(existing.room_number, 10);
    if (isNaN(existingNum)) continue;
    const diff = Math.abs(num - existingNum);
    if (diff === 1) bonus += 3;       // Adjacent room - strong bonus
    else if (diff === 2) bonus += 2;   // Two apart - moderate bonus
    else if (diff <= 4) bonus += 1;    // Close by - small bonus
    // Same floor bonus (minimizes elevator trips)
    if (Math.floor(num / 100) === Math.floor(existingNum / 100)) bonus += 0.5;
  }
  return bonus;
}

// Group rooms by wing (falls back to floor if no wing assigned)
function groupRoomsByWing(rooms: RoomForAssignment[]): Map<string, RoomForAssignment[]> {
  const wingMap = new Map<string, RoomForAssignment[]>();
  rooms.forEach(room => {
    const key = room.wing || `floor-${room.floor_number ?? getFloorFromRoomNumber(room.room_number)}`;
    if (!wingMap.has(key)) wingMap.set(key, []);
    wingMap.get(key)!.push(room);
  });
  return wingMap;
}

// Get average elevator proximity for a group of rooms
function getAvgProximity(rooms: RoomForAssignment[]): number {
  const withProx = rooms.filter(r => r.elevator_proximity != null);
  if (withProx.length === 0) return 2;
  return withProx.reduce((sum, r) => sum + (r.elevator_proximity || 2), 0) / withProx.length;
}

// Get the set of wings assigned to a staff member
function getStaffWings(rooms: RoomForAssignment[]): Set<string> {
  const wings = new Set<string>();
  rooms.forEach(r => {
    wings.add(r.wing || `floor-${r.floor_number ?? getFloorFromRoomNumber(r.room_number)}`);
  });
  return wings;
}

// Wing proximity map type: maps "wingA" -> "wingB" -> distance
export type WingProximityMap = Record<string, Record<string, number>>;

// Compute average map distance from a staff member's assigned wings to a candidate wing
function getMapDistanceToAssignedWings(
  staffRooms: RoomForAssignment[],
  candidateWing: string,
  proximityMap?: WingProximityMap
): number {
  if (!proximityMap) return 0;
  const staffWings = new Set<string>();
  staffRooms.forEach(r => {
    staffWings.add(r.wing || `floor-${r.floor_number ?? getFloorFromRoomNumber(r.room_number)}`);
  });
  if (staffWings.size === 0) return 0;
  let totalDist = 0;
  let count = 0;
  staffWings.forEach(sw => {
    const dist = proximityMap[sw]?.[candidateWing] ?? proximityMap[candidateWing]?.[sw];
    if (dist != null) {
      totalDist += dist;
      count++;
    }
  });
  return count > 0 ? totalDist / count : 999;
}

// Build a wing proximity map from saved layout positions
export function buildWingProximityMap(
  layouts: Array<{ floor_number: number; wing: string; x: number; y: number }>
): WingProximityMap {
  const map: WingProximityMap = {};
  for (const a of layouts) {
    for (const b of layouts) {
      const keyA = a.wing;
      const keyB = b.wing;
      if (keyA === keyB) continue;
      const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
      if (!map[keyA]) map[keyA] = {};
      map[keyA][keyB] = Math.round(dist);
    }
  }
  return map;
}

// Room affinity map type: maps "roomA|roomB" key to affinity score (0-1)
export type RoomAffinityMap = Map<string, number>;

// Build affinity key (always sorted so A|B === B|A)
function affinityKey(roomA: string, roomB: string): string {
  return roomA < roomB ? `${roomA}|${roomB}` : `${roomB}|${roomA}`;
}

// Build affinity map from raw DB patterns
export function buildAffinityMap(
  patterns: Array<{ room_number_a: string; room_number_b: string; pair_count: number }>
): RoomAffinityMap {
  if (patterns.length === 0) return new Map();
  const maxCount = Math.max(...patterns.map(p => p.pair_count));
  if (maxCount === 0) return new Map();
  const map: RoomAffinityMap = new Map();
  for (const p of patterns) {
    const key = affinityKey(p.room_number_a, p.room_number_b);
    map.set(key, p.pair_count / maxCount);
  }
  return map;
}

// Calculate total affinity bonus for placing a room with a set of existing rooms
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
  return bonus;
}

// Calculate affinity loss if a room is removed from its current group
function getAffinityLoss(
  roomNumber: string,
  currentGroupRoomNumbers: string[],
  affinityMap?: RoomAffinityMap
): number {
  if (!affinityMap || affinityMap.size === 0) return 0;
  let loss = 0;
  for (const other of currentGroupRoomNumbers) {
    if (other === roomNumber) continue;
    const score = affinityMap.get(affinityKey(roomNumber, other));
    if (score) loss += score;
  }
  return loss;
}

// Sort rooms optimally: checkouts first, then by floor, then room number
function sortRoomsOptimally(rooms: RoomForAssignment[]): RoomForAssignment[] {
  return [...rooms].sort((a, b) => {
    // Checkouts always first
    if (a.is_checkout_room && !b.is_checkout_room) return -1;
    if (!a.is_checkout_room && b.is_checkout_room) return 1;
    // Within same type: sort by floor, then room number
    const floorA = getFloorFromRoomNumber(a.room_number);
    const floorB = getFloorFromRoomNumber(b.room_number);
    if (floorA !== floorB) return floorA - floorB;
    return parseInt(a.room_number) - parseInt(b.room_number);
  });
}

// Main auto-assignment algorithm: WING-FIRST grouping
export function autoAssignRooms(
  rooms: RoomForAssignment[],
  staff: StaffForAssignment[],
  wingProximityMap?: WingProximityMap,
  affinityMap?: RoomAffinityMap
): AssignmentPreview[] {
  if (staff.length === 0 || rooms.length === 0) {
    return staff.map(s => ({
      staffId: s.id,
      staffName: s.full_name,
      rooms: [],
      totalWeight: 0,
      checkoutCount: 0,
      dailyCount: 0,
      estimatedMinutes: 0,
      totalWithBreak: BREAK_TIME_MINUTES,
      exceedsShift: false,
      overageMinutes: 0
    }));
  }

  // Initialize assignments
  const assignments: Map<string, RoomForAssignment[]> = new Map();
  const staffWeights: Map<string, number> = new Map();
  staff.forEach(s => {
    assignments.set(s.id, []);
    staffWeights.set(s.id, 0);
  });

  // STEP 1: Group ALL rooms (checkout + daily) by wing
  const allByWing = groupRoomsByWing(rooms);

  // STEP 2: Sort wing groups by total weight (heaviest first for better distribution)
  const wingEntries = Array.from(allByWing.entries())
    .map(([wing, wingRooms]) => ({
      wing,
      rooms: wingRooms,
      totalWeight: wingRooms.reduce((sum, r) => sum + calculateRoomWeight(r), 0),
      avgProximity: getAvgProximity(wingRooms)
    }))
    .sort((a, b) => b.totalWeight - a.totalWeight);

  const totalAllWeight = wingEntries.reduce((s, w) => s + w.totalWeight, 0);
  const avgTargetWeight = totalAllWeight / staff.length;

  // STEP 3: Assign entire wing groups to housekeepers
  for (const wingEntry of wingEntries) {
    const { rooms: wingRooms, totalWeight, avgProximity } = wingEntry;

    // Find best housekeeper: lowest weight, with proximity tie-breaking
    const candidates = Array.from(staffWeights.entries())
      .sort((a, b) => {
        const weightDiff = a[1] - b[1];
        // If weights are close (within 1.5), prefer staff already working in nearby wings
        if (Math.abs(weightDiff) < 1.5) {
          const aRooms = assignments.get(a[0])!;
          const bRooms = assignments.get(b[0])!;
          
          // Use map-based distance if available
          if (wingProximityMap) {
            const aMapDist = getMapDistanceToAssignedWings(aRooms, wingEntry.wing, wingProximityMap);
            const bMapDist = getMapDistanceToAssignedWings(bRooms, wingEntry.wing, wingProximityMap);
            if (aMapDist !== bMapDist) return aMapDist - bMapDist;
          }
          
          const aProx = aRooms.length > 0 ? getAvgProximity(aRooms) : 99;
          const bProx = bRooms.length > 0 ? getAvgProximity(bRooms) : 99;
          // Prefer housekeeper whose current proximity is closer to this wing's proximity
          return Math.abs(aProx - avgProximity) - Math.abs(bProx - avgProximity);
        }
        return weightDiff;
      });

    const [lightestId, lightestWeight] = candidates[0];
    const wouldBe = lightestWeight + totalWeight;

    // If assigning whole wing would exceed 40% above average and wing has >3 rooms, split it
    if (wouldBe > avgTargetWeight * 1.4 && wingRooms.length > 3) {
      // Split: distribute rooms one by one, using affinity + sequence bonus
      const sorted = [...wingRooms].sort((a, b) => calculateRoomWeight(b) - calculateRoomWeight(a));
      for (const room of sorted) {
        // Find staff with lowest effective weight (weight minus affinity & sequence bonuses)
        const splitCandidates = Array.from(staffWeights.entries()).sort((a, b) => {
          const aRooms = assignments.get(a[0])!;
          const bRooms = assignments.get(b[0])!;
          const aAffinity = getAffinityBonus(room.room_number, aRooms.map(r => r.room_number), affinityMap);
          const bAffinity = getAffinityBonus(room.room_number, bRooms.map(r => r.room_number), affinityMap);
          const aSeqBonus = getSequenceBonus(room.room_number, aRooms);
          const bSeqBonus = getSequenceBonus(room.room_number, bRooms);
          // Lower effective weight = weight - bonuses (bonuses make staff more attractive)
          return (a[1] - aAffinity * 2 - aSeqBonus * 0.5) - (b[1] - bAffinity * 2 - bSeqBonus * 0.5);
        });
        const [bestId, bestWeight] = splitCandidates[0];
        assignments.get(bestId)!.push(room);
        staffWeights.set(bestId, bestWeight + calculateRoomWeight(room));
      }
    } else {
      // Assign entire wing to one housekeeper
      assignments.get(lightestId)!.push(...wingRooms);
      staffWeights.set(lightestId, lightestWeight + totalWeight);
    }
  }

  // STEP 4: Light rebalancing - only move rooms if it reduces imbalance without adding new wings
  const totalWeight = Array.from(staffWeights.values()).reduce((a, b) => a + b, 0);
  const avgWeight = totalWeight / staff.length;
  const threshold = avgWeight * 0.25;

  let iterations = 0;
  while (iterations < 20) {
    iterations++;
    const sorted = Array.from(staffWeights.entries()).sort((a, b) => b[1] - a[1]);
    const [heaviestId, heaviestW] = sorted[0];
    const [lightestId, lightestW] = sorted[sorted.length - 1];

    if (heaviestW - lightestW <= threshold) break;

    const heaviestRooms = assignments.get(heaviestId)!;
    const lightestRooms = assignments.get(lightestId)!;
    const lightestWings = getStaffWings(lightestRooms);

    // Find best room to move: prefer daily rooms from a wing the lightest already has
    let bestRoom: RoomForAssignment | null = null;
    let bestScore = Infinity;

    for (const room of heaviestRooms) {
      if (room.is_checkout_room) continue; // prefer not moving checkouts
      const roomWing = room.wing || `floor-${room.floor_number ?? getFloorFromRoomNumber(room.room_number)}`;
      const w = calculateRoomWeight(room);
      const newDiff = Math.abs((heaviestW - w) - (lightestW + w));
      const currentDiff = heaviestW - lightestW;
      if (newDiff >= currentDiff) continue; // must improve balance

      // Affinity penalty: penalize moving room away from high-affinity partners
      const affinityPenalty = getAffinityLoss(room.room_number, heaviestRooms.map(r => r.room_number), affinityMap) * 5;
      // Sequence penalty: penalize breaking up sequential rooms
      const seqPenalty = getSequenceBonus(room.room_number, heaviestRooms.filter(r => r.id !== room.id));
      // Sequence bonus for target: reward if room fits sequentially with lightest's rooms
      const seqBonusTarget = getSequenceBonus(room.room_number, lightestRooms);

      // Score: prefer rooms from wings the lightest already works in (score 0), else penalty (score 10)
      const wingPenalty = lightestWings.has(roomWing) ? 0 : 10;
      const score = newDiff + wingPenalty + affinityPenalty + seqPenalty * 0.5 - seqBonusTarget * 0.3;
      if (score < bestScore) {
        bestScore = score;
        bestRoom = room;
      }
    }

    if (!bestRoom) break;

    // Move the room
    const idx = heaviestRooms.indexOf(bestRoom);
    heaviestRooms.splice(idx, 1);
    assignments.get(lightestId)!.push(bestRoom);
    const w = calculateRoomWeight(bestRoom);
    staffWeights.set(heaviestId, heaviestW - w);
    staffWeights.set(lightestId, lightestW + w);
  }

  // STEP 5: Room count rebalancing (max diff of 2)
  let countIter = 0;
  while (countIter < 15) {
    countIter++;
    const byCount = Array.from(assignments.entries())
      .map(([id, r]) => ({ id, count: r.length, weight: staffWeights.get(id)! }))
      .sort((a, b) => b.count - a.count);
    const most = byCount[0];
    const least = byCount[byCount.length - 1];
    if (most.count - least.count <= 2) break;

    const mostRooms = assignments.get(most.id)!;
    const leastRooms = assignments.get(least.id)!;
    const leastWings = getStaffWings(leastRooms);
    // Pick lightest daily room, preferring one from a wing the least already has
    const dailyRooms = mostRooms.filter(r => !r.is_checkout_room);
    const sortedDaily = [...dailyRooms].sort((a, b) => {
      const aWing = a.wing || `floor-${a.floor_number ?? getFloorFromRoomNumber(a.room_number)}`;
      const bWing = b.wing || `floor-${b.floor_number ?? getFloorFromRoomNumber(b.room_number)}`;
      const aWingBonus = leastWings.has(aWing) ? 0 : 100;
      const bWingBonus = leastWings.has(bWing) ? 0 : 100;
      // Sequence bonus: prefer moving rooms that fit well with target
      const aSeqBonus = getSequenceBonus(a.room_number, leastRooms) * 10;
      const bSeqBonus = getSequenceBonus(b.room_number, leastRooms) * 10;
      // Add affinity penalty: rooms with high affinity to current group are harder to move
      const aAffinityPenalty = getAffinityLoss(a.room_number, mostRooms.map(r => r.room_number), affinityMap) * 50;
      const bAffinityPenalty = getAffinityLoss(b.room_number, mostRooms.map(r => r.room_number), affinityMap) * 50;
      return (calculateRoomWeight(a) + aWingBonus + aAffinityPenalty - aSeqBonus) - (calculateRoomWeight(b) + bWingBonus + bAffinityPenalty - bSeqBonus);
    });
    if (sortedDaily.length === 0) break;

    const room = sortedDaily[0];
    const rw = calculateRoomWeight(room);
    const newLeastW = least.weight + rw;
    if (Math.abs(newLeastW - avgWeight) > avgWeight * 0.3) break; // don't create weight imbalance

    const idx = mostRooms.indexOf(room);
    mostRooms.splice(idx, 1);
    assignments.get(least.id)!.push(room);
    staffWeights.set(most.id, most.weight - rw);
    staffWeights.set(least.id, newLeastW);
  }

  // STEP 6: Build final preview with optimally sorted rooms (checkout first, floor-grouped, sequential)
  return staff.map(s => {
    const staffRooms = assignments.get(s.id) || [];
    const sortedRooms = sortRoomsOptimally(staffRooms);

    const timeEstimate = calculateTimeEstimation(sortedRooms);

    return {
      staffId: s.id,
      staffName: s.full_name,
      rooms: sortedRooms,
      totalWeight: staffWeights.get(s.id) || 0,
      checkoutCount: sortedRooms.filter(r => r.is_checkout_room).length,
      dailyCount: sortedRooms.filter(r => !r.is_checkout_room).length,
      ...timeEstimate
    };
  });
}

// Move a room from one staff to another
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
  
  // Sort optimally: checkouts first, then by floor and room number
  toPreview.rooms = sortRoomsOptimally(toPreview.rooms);
  
  const fromTimeEstimate = calculateTimeEstimation(fromPreview.rooms);
  const toTimeEstimate = calculateTimeEstimation(toPreview.rooms);
  Object.assign(fromPreview, fromTimeEstimate);
  Object.assign(toPreview, toTimeEstimate);
  
  return newPreviews;
}
