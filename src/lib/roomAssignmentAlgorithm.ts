// Room Assignment Algorithm for fair distribution

// Time constants (in minutes)
export const CHECKOUT_MINUTES = 45;
export const DAILY_MINUTES = 15;
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
  // Time estimation fields
  estimatedMinutes: number;
  totalWithBreak: number;
  exceedsShift: boolean;
  overageMinutes: number;
}

// Calculate estimated time for a room in minutes
export function calculateRoomTime(room: RoomForAssignment): number {
  let baseTime = room.is_checkout_room ? CHECKOUT_MINUTES : DAILY_MINUTES;
  
  // Add extra time for larger rooms
  const size = room.room_size_sqm || 20;
  if (size >= 40) {
    baseTime += 15; // XXL rooms need more time
  } else if (size >= 28) {
    baseTime += 10; // Large rooms
  } else if (size >= 22) {
    baseTime += 5; // Medium-large rooms
  }
  
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

// Weight calculation based on room characteristics - considers room size
export function calculateRoomWeight(room: RoomForAssignment): number {
  // Base weight: checkout rooms require more work
  let weight = room.is_checkout_room ? 1.5 : 1.0;
  
  // Size factor based on room_size_sqm - MORE SIGNIFICANT IMPACT
  const size = room.room_size_sqm || 20; // default 20 sqm if unknown
  
  if (size >= 40) {
    weight += 1.0; // XXL rooms (quadruple) - significant extra weight
  } else if (size >= 28) {
    weight += 0.6; // Large rooms (30+ sqm)
  } else if (size >= 22) {
    weight += 0.3; // Medium-large rooms (22-28 sqm)
  }
  // Standard rooms (16-22 sqm) get no bonus
  
  // Capacity factor for triple/quad rooms
  const capacity = room.room_capacity || 2;
  if (capacity >= 4) {
    weight += 0.3;
  } else if (capacity >= 3) {
    weight += 0.15;
  }
  
  return weight;
}

// Get floor number from room number (first digit(s) before last 2 digits)
export function getFloorFromRoomNumber(roomNumber: string): number {
  const num = parseInt(roomNumber, 10);
  if (isNaN(num)) return 0;
  return Math.floor(num / 100);
}

// Group rooms by wing (falls back to floor if no wing assigned)
function groupRoomsByWing(rooms: RoomForAssignment[]): Map<string, RoomForAssignment[]> {
  const wingMap = new Map<string, RoomForAssignment[]>();
  
  rooms.forEach(room => {
    const key = room.wing || `floor-${room.floor_number ?? getFloorFromRoomNumber(room.room_number)}`;
    if (!wingMap.has(key)) {
      wingMap.set(key, []);
    }
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

// Main auto-assignment algorithm with FAIR checkout distribution
export function autoAssignRooms(
  rooms: RoomForAssignment[],
  staff: StaffForAssignment[]
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

  // STEP 1: Separate checkout rooms from daily rooms
  const checkoutRooms = rooms.filter(r => r.is_checkout_room);
  const dailyRooms = rooms.filter(r => !r.is_checkout_room);

  // Initialize assignments for each staff member
  const assignments: Map<string, (RoomForAssignment & { weight: number; floor: number })[]> = new Map();
  const staffWeights: Map<string, number> = new Map();
  
  staff.forEach(s => {
    assignments.set(s.id, []);
    staffWeights.set(s.id, 0);
  });

  // STEP 2: Distribute checkout rooms FIRST using round-robin for fairness
  // Sort checkout rooms by weight (heavier rooms first for better distribution)
  const weightedCheckouts = checkoutRooms
    .map(room => ({
      ...room,
      weight: calculateRoomWeight(room),
      floor: room.floor_number ?? getFloorFromRoomNumber(room.room_number)
    }))
    .sort((a, b) => b.weight - a.weight); // Heaviest first
  
  // Round-robin assignment of checkout rooms
  weightedCheckouts.forEach((room, index) => {
    // Find the staff member with the lowest current weight
    const sortedStaff = Array.from(staffWeights.entries())
      .sort((a, b) => a[1] - b[1]);
    const [staffId, currentWeight] = sortedStaff[0];
    
    assignments.get(staffId)!.push(room);
    staffWeights.set(staffId, currentWeight + room.weight);
  });

  // STEP 3: Now distribute daily rooms, prioritizing keeping wings together
  const dailyWeightedRooms = dailyRooms.map(room => ({
    ...room,
    weight: calculateRoomWeight(room),
    floor: room.floor_number ?? getFloorFromRoomNumber(room.room_number)
  }));

  // Group daily rooms by wing (physical proximity)
  const dailyByWing = groupRoomsByWing(dailyWeightedRooms as RoomForAssignment[]);
  
  // Sort wings by total weight (heaviest first for better distribution)
  const sortedWings = Array.from(dailyByWing.entries())
    .map(([wing, wingRooms]) => ({
      wing,
      rooms: wingRooms,
      totalWeight: wingRooms.reduce((sum, r) => sum + calculateRoomWeight(r), 0),
      avgProximity: getAvgProximity(wingRooms)
    }))
    .sort((a, b) => b.totalWeight - a.totalWeight);

  // Track proximity per staff for smart assignment
  const staffProximity: Map<string, number[]> = new Map();
  staff.forEach(s => staffProximity.set(s.id, []));

  // Assign wings to housekeepers based on current weight balance + proximity
  for (const { wing, rooms: wingRooms, totalWeight, avgProximity } of sortedWings) {
    const floor = wingRooms[0]?.floor_number ?? getFloorFromRoomNumber(wingRooms[0]?.room_number || '0');
    const roomsWithWeight = wingRooms.map(r => ({
      ...r,
      weight: calculateRoomWeight(r),
      floor
    }));

    // Calculate average weight target
    const totalCurrentWeight = Array.from(staffWeights.values()).reduce((a, b) => a + b, 0);
    const avgTarget = (totalCurrentWeight + totalWeight) / staff.length;
    
    // Find staff with lowest current weight, preferring those with similar proximity
    const sortedStaff = Array.from(staffWeights.entries())
      .sort((a, b) => {
        const weightDiff = a[1] - b[1];
        // If weights are close, prefer staff already working near this wing's elevator
        if (Math.abs(weightDiff) < 1) {
          const aProx = staffProximity.get(a[0]) || [];
          const bProx = staffProximity.get(b[0]) || [];
          const aAvg = aProx.length > 0 ? aProx.reduce((s, v) => s + v, 0) / aProx.length : 99;
          const bAvg = bProx.length > 0 ? bProx.reduce((s, v) => s + v, 0) / bProx.length : 99;
          return Math.abs(aAvg - avgProximity) - Math.abs(bAvg - avgProximity);
        }
        return weightDiff;
      });
    
    // If assigning entire wing to one person would exceed 30% above average,
    // split the wing among multiple housekeepers
    const [lightestId, lightestWeight] = sortedStaff[0];
    const wouldBe = lightestWeight + totalWeight;
    
    if (wouldBe > avgTarget * 1.3 && wingRooms.length > 2) {
      // Split wing - distribute rooms one by one to balance weights
      roomsWithWeight.sort((a, b) => b.weight - a.weight); // Heaviest first
      
      for (const room of roomsWithWeight) {
        const minStaff = Array.from(staffWeights.entries())
          .sort((a, b) => a[1] - b[1])[0];
        
        assignments.get(minStaff[0])!.push(room);
        staffWeights.set(minStaff[0], minStaff[1] + room.weight);
        staffProximity.get(minStaff[0])!.push(avgProximity);
      }
    } else {
      // Assign entire wing to one housekeeper
      assignments.get(lightestId)!.push(...roomsWithWeight);
      staffWeights.set(lightestId, lightestWeight + totalWeight);
      staffProximity.get(lightestId)!.push(avgProximity);
    }
  }

  // STEP 4: Rebalancing pass - if any housekeeper has >20% more weight than average, redistribute
  const totalWeight = Array.from(staffWeights.values()).reduce((a, b) => a + b, 0);
  const avgWeight = totalWeight / staff.length;
  const threshold = avgWeight * 0.20;
  
  let rebalanced = true;
  let iterations = 0;
  const maxIterations = 30;
  
  while (rebalanced && iterations < maxIterations) {
    rebalanced = false;
    iterations++;
    
    const sortedByWeight = Array.from(staffWeights.entries())
      .sort((a, b) => b[1] - a[1]); // Highest weight first
    
    const [heaviestId, heaviestWeight] = sortedByWeight[0];
    const [lightestId, lightestWeight] = sortedByWeight[sortedByWeight.length - 1];
    
    // If difference is significant, try to move a room
    if (heaviestWeight - lightestWeight > threshold) {
      const heaviestRooms = assignments.get(heaviestId)!;
      
      // Find the best daily room to move (prefer daily over checkout for balance)
      // Don't move checkout rooms to preserve fair checkout distribution
      const targetDiff = (heaviestWeight - lightestWeight) / 2;
      
      let bestRoomToMove: typeof heaviestRooms[0] | null = null;
      let bestDiff = Infinity;
      
      for (const room of heaviestRooms) {
        // Prefer moving daily rooms over checkout rooms
        if (room.is_checkout_room) continue;
        
        // Check if moving this room would actually improve balance
        const newHeaviest = heaviestWeight - room.weight;
        const newLightest = lightestWeight + room.weight;
        const newDiff = Math.abs(newHeaviest - newLightest);
        const currentDiff = heaviestWeight - lightestWeight;
        
        if (newDiff < currentDiff && newDiff < bestDiff) {
          bestDiff = newDiff;
          bestRoomToMove = room;
        }
      }
      
      if (bestRoomToMove) {
        // Move room from heaviest to lightest
        const idx = heaviestRooms.indexOf(bestRoomToMove);
        heaviestRooms.splice(idx, 1);
        assignments.get(lightestId)!.push(bestRoomToMove);
        
        staffWeights.set(heaviestId, heaviestWeight - bestRoomToMove.weight);
        staffWeights.set(lightestId, lightestWeight + bestRoomToMove.weight);
        
        rebalanced = true;
      }
    }
  }

  // STEP 5: Room count rebalancing - ensure no housekeeper has >2 more rooms than another
  let countRebalanced = true;
  let countIterations = 0;
  while (countRebalanced && countIterations < 20) {
    countRebalanced = false;
    countIterations++;
    
    const byCount = Array.from(assignments.entries())
      .map(([id, rooms]) => ({ id, count: rooms.length, weight: staffWeights.get(id)! }))
      .sort((a, b) => b.count - a.count);
    
    const most = byCount[0];
    const least = byCount[byCount.length - 1];
    
    if (most.count - least.count > 2) {
      const mostRooms = assignments.get(most.id)!;
      const dailyRooms = mostRooms.filter(r => !r.is_checkout_room);
      
      // Pick lightest daily room
      const sorted = [...dailyRooms].sort((a, b) => a.weight - b.weight);
      if (sorted.length > 0) {
        const room = sorted[0];
        const newLeastWeight = least.weight + room.weight;
        const newAvg = totalWeight / staff.length;
        
        // Only move if it doesn't create excessive weight imbalance (25%)
        if (Math.abs(newLeastWeight - newAvg) <= newAvg * 0.25) {
          const idx = mostRooms.indexOf(room);
          mostRooms.splice(idx, 1);
          assignments.get(least.id)!.push(room);
          
          staffWeights.set(most.id, most.weight - room.weight);
          staffWeights.set(least.id, newLeastWeight);
          
          countRebalanced = true;
        }
      }
    }
  }

  // Build final preview with sorted rooms (checkout first, then by floor and room number)
  return staff.map(s => {
    const staffRooms = assignments.get(s.id) || [];
    const sortedRooms = staffRooms.sort((a, b) => {
      // Checkout rooms first (so housekeepers can start with them)
      if (a.is_checkout_room !== b.is_checkout_room) {
        return a.is_checkout_room ? -1 : 1;
      }
      // Then by floor
      if (a.floor !== b.floor) return a.floor - b.floor;
      // Then by room number
      return parseInt(a.room_number) - parseInt(b.room_number);
    });

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
  
  // Remove from source
  fromPreview.rooms.splice(roomIndex, 1);
  fromPreview.totalWeight -= roomWeight;
  if (room.is_checkout_room) {
    fromPreview.checkoutCount--;
  } else {
    fromPreview.dailyCount--;
  }
  
  // Add to target
  toPreview.rooms.push(room);
  toPreview.totalWeight += roomWeight;
  if (room.is_checkout_room) {
    toPreview.checkoutCount++;
  } else {
    toPreview.dailyCount++;
  }
  
  // Re-sort target rooms
  toPreview.rooms.sort((a, b) => {
    const floorA = a.floor_number ?? getFloorFromRoomNumber(a.room_number);
    const floorB = b.floor_number ?? getFloorFromRoomNumber(b.room_number);
    if (a.is_checkout_room !== b.is_checkout_room) {
      return a.is_checkout_room ? -1 : 1;
    }
    if (floorA !== floorB) return floorA - floorB;
    return parseInt(a.room_number) - parseInt(b.room_number);
  });
  
  // Recalculate time estimates for both
  const fromTimeEstimate = calculateTimeEstimation(fromPreview.rooms);
  const toTimeEstimate = calculateTimeEstimation(toPreview.rooms);
  
  Object.assign(fromPreview, fromTimeEstimate);
  Object.assign(toPreview, toTimeEstimate);
  
  return newPreviews;
}
