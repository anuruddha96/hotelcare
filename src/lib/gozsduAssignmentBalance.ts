import type { AssignmentPreview, RoomForAssignment } from './roomAssignmentAlgorithmCore';
import { calculateRoomTime, calculateRoomWeight, moveRoom } from './roomAssignmentAlgorithmGozsduLegacy';
import { gozsduRoomsCanShare } from './gozsduBuildingAssignment';

/** The first pass keeps small mapped sections together; that may leave one
 * cleaner with a heavy section and another with mostly light rooms. This
 * second pass permits a section split only if it materially improves fairness.
 * Every candidate is checked against the full pairwise building policy. */
function objective(previews: AssignmentPreview[]): number {
  const loads = previews.map(person => person.rooms.reduce((sum, room) => sum + calculateRoomTime(room), 0));
  const efforts = previews.map(person => person.rooms.reduce((sum, room) => sum + calculateRoomWeight(room), 0));
  const checkouts = previews.map(person => person.checkoutCount);
  const range = (values: number[]) => Math.max(...values) - Math.min(...values);
  const overtime = loads.reduce((sum, load) => sum + Math.max(0, load - 450), 0);
  const sections = new Map<string, Set<string>>();
  for (const person of previews) for (const room of person.rooms) {
    const section = room.housekeeping_section_id || room.id;
    if (!sections.has(section)) sections.set(section, new Set());
    sections.get(section)!.add(person.staffId);
  }
  const additionalSectionOwners = [...sections.values()].reduce((sum, owners) => sum + owners.size - 1, 0);
  return range(loads) * 20 + range(efforts) * 12 + range(checkouts) * 25
    + overtime * 500 + additionalSectionOwners * 30;
}

export function rebalanceGozsduAssignments(previews: AssignmentPreview[]): AssignmentPreview[] {
  if (previews.length < 2 || !previews.some(person => person.rooms.length > 1)) return previews;
  let current = previews;
  for (let iteration = 0; iteration < 28; iteration++) {
    const before = objective(current);
    let best = current;
    let bestCost = before;
    const fromStaff = [...current].sort((a, b) => b.estimatedMinutes - a.estimatedMinutes);
    const toStaff = [...current].sort((a, b) => a.estimatedMinutes - b.estimatedMinutes);
    for (const source of fromStaff) {
      if (source.rooms.length <= 1) continue;
      const candidates = [...source.rooms].sort((a: RoomForAssignment, b: RoomForAssignment) =>
        calculateRoomTime(b) - calculateRoomTime(a));
      for (const room of candidates) {
        for (const destination of toStaff) {
          if (destination.staffId === source.staffId
            || !gozsduRoomsCanShare([...destination.rooms, room])) continue;
          const next = moveRoom(current, room.id, source.staffId, destination.staffId);
          if (next === current) continue;
          const cost = objective(next);
          if (cost + 1 < bestCost) {
            best = next;
            bestCost = cost;
          }
        }
      }
    }
    if (best === current) break;
    current = best;
  }
  return current;
}
