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
  return room.is_checkout_room ? CHECKOUT_MINUTES : DAILY_MINUTES;
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
  // Base weight: checkout rooms require more work
  let weight = room.is_checkout_room ? 1.5 : 1.0;
  
  // Size factor based on room_size_sqm
  const size = room.room_size_sqm || 20; // default 20 sqm if unknown
  
  if (size >= 40) {
    weight += 0.5; // XXL rooms (quadruple)
  } else if (size >= 28) {
    weight += 0.3; // Large rooms (30+ sqm)
  } else if (size >= 22) {
    weight += 0.15; // Medium-large rooms (22-28 sqm)
  }
  // Standard rooms (16-22 sqm) get no bonus
  
  // Capacity factor for triple/quad rooms
  const capacity = room.room_capacity || 2;
  if (capacity >= 4) {
    weight += 0.2;
  } else if (capacity >= 3) {
    weight += 0.1;
  }
  
  return weight;
}

// Get floor number from room number (first digit(s) before last 2 digits)
export function getFloorFromRoomNumber(roomNumber: string): number {
  const num = parseInt(roomNumber, 10);
  if (isNaN(num)) return 0;
  return Math.floor(num / 100);
}

// Group rooms by floor
function groupRoomsByFloor(rooms: RoomForAssignment[]): Map<number, RoomForAssignment[]> {
  const floorMap = new Map<number, RoomForAssignment[]>();
  
  rooms.forEach(room => {
    const floor = room.floor_number ?? getFloorFromRoomNumber(room.room_number);
    if (!floorMap.has(floor)) {
      floorMap.set(floor, []);
    }
    floorMap.get(floor)!.push(room);
  });
  
  return floorMap;
}

// Main auto-assignment algorithm
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

  // Calculate weights for all rooms
  const weightedRooms = rooms.map(room => ({
    ...room,
    weight: calculateRoomWeight(room),
    floor: room.floor_number ?? getFloorFromRoomNumber(room.room_number)
  }));

  // Calculate total weight and target weight per housekeeper
  const totalWeight = weightedRooms.reduce((sum, r) => sum + r.weight, 0);
  const targetWeight = totalWeight / staff.length;

  // Initialize assignments for each staff member
  const assignments: Map<string, (RoomForAssignment & { weight: number; floor: number })[]> = new Map();
  const staffWeights: Map<string, number> = new Map();
  
  staff.forEach(s => {
    assignments.set(s.id, []);
    staffWeights.set(s.id, 0);
  });

  // Group rooms by floor
  const roomsByFloor = groupRoomsByFloor(weightedRooms as RoomForAssignment[]);
  
  // Sort floors by total room count (largest first for better distribution)
  const sortedFloors = Array.from(roomsByFloor.entries())
    .sort((a, b) => b[1].length - a[1].length);

  // First pass: Assign entire floors to housekeepers when possible
  // This keeps housekeepers working on the same floor
  for (const [floor, floorRooms] of sortedFloors) {
    const floorWeight = floorRooms.reduce((sum, r) => sum + calculateRoomWeight(r), 0);
    
    // Find the housekeeper with the lowest current weight
    const sortedStaff = Array.from(staffWeights.entries())
      .sort((a, b) => a[1] - b[1]);
    
    const [bestStaffId, currentWeight] = sortedStaff[0];
    
    // If assigning this entire floor would make this housekeeper have too much,
    // split the floor among multiple housekeepers
    if (floorRooms.length > Math.ceil(rooms.length / staff.length) + 2) {
      // Split floor - add rooms one by one to balance
      const sortedFloorRooms = floorRooms
        .map(r => ({ ...r, weight: calculateRoomWeight(r), floor }))
        .sort((a, b) => {
          // Checkout rooms first, then by room number
          if (a.is_checkout_room !== b.is_checkout_room) {
            return a.is_checkout_room ? -1 : 1;
          }
          return parseInt(a.room_number) - parseInt(b.room_number);
        });
      
      for (const room of sortedFloorRooms) {
        // Find staff with lowest weight
        const minStaff = Array.from(staffWeights.entries())
          .sort((a, b) => a[1] - b[1])[0];
        
        assignments.get(minStaff[0])!.push(room);
        staffWeights.set(minStaff[0], minStaff[1] + room.weight);
      }
    } else {
      // Assign entire floor to one housekeeper
      const floorRoomsWithWeight = floorRooms
        .map(r => ({ ...r, weight: calculateRoomWeight(r), floor }))
        .sort((a, b) => {
          if (a.is_checkout_room !== b.is_checkout_room) {
            return a.is_checkout_room ? -1 : 1;
          }
          return parseInt(a.room_number) - parseInt(b.room_number);
        });
      
      assignments.get(bestStaffId)!.push(...floorRoomsWithWeight);
      staffWeights.set(bestStaffId, currentWeight + floorWeight);
    }
  }

  // Rebalancing pass: If any housekeeper has >25% more weight than average, redistribute
  const avgWeight = totalWeight / staff.length;
  const threshold = avgWeight * 0.25;
  
  let rebalanced = true;
  let iterations = 0;
  const maxIterations = 20;
  
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
      
      // Find the best room to move (smallest weight that helps balance)
      const targetDiff = (heaviestWeight - lightestWeight) / 2;
      
      let bestRoomToMove: typeof heaviestRooms[0] | null = null;
      let bestDiff = Infinity;
      
      for (const room of heaviestRooms) {
        const diff = Math.abs(room.weight - targetDiff);
        if (diff < bestDiff && room.weight <= targetDiff + 0.5) {
          bestDiff = diff;
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

  // Build final preview with sorted rooms (checkout first, then by room number)
  return staff.map(s => {
    const staffRooms = assignments.get(s.id) || [];
    const sortedRooms = staffRooms.sort((a, b) => {
      // Sort by floor first
      if (a.floor !== b.floor) return a.floor - b.floor;
      // Then checkout rooms first
      if (a.is_checkout_room !== b.is_checkout_room) {
        return a.is_checkout_room ? -1 : 1;
      }
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
    if (floorA !== floorB) return floorA - floorB;
    if (a.is_checkout_room !== b.is_checkout_room) {
      return a.is_checkout_room ? -1 : 1;
    }
    return parseInt(a.room_number) - parseInt(b.room_number);
  });
  
  // Recalculate time estimates for both
  const fromTimeEstimate = calculateTimeEstimation(fromPreview.rooms);
  const toTimeEstimate = calculateTimeEstimation(toPreview.rooms);
  
  Object.assign(fromPreview, fromTimeEstimate);
  Object.assign(toPreview, toTimeEstimate);
  
  return newPreviews;
}
