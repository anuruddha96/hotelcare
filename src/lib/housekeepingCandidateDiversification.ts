import type { AssignmentPreview, RoomAffinityMap, RoomForAssignment } from './roomAssignmentAlgorithmCore';
import { AVAILABLE_WORK_MINUTES } from './roomAssignmentAlgorithmCore';
import { calculateRoomTime, computeFairnessMetrics, moveRoom } from './roomAssignmentAlgorithmGozsduLegacy';
import { gozsduRoomsCanShare } from './gozsduBuildingAssignment';

/**
 * This pass is pure: it only explores the currently eligible rooms and staff.
 * It never reads another property's data, persists a plan, or relaxes Gozsdu's
 * manager-configured building routes. The caller still decides which candidate
 * to preview and requires a manager confirmation before saving.
 */
type Options = {
  randomSeed?: number;
  affinityMap?: RoomAffinityMap;
  enforceGozsduRoutes: boolean;
};

const isCheckout = (room: RoomForAssignment) => room.is_checkout_room === true
  || room.pms_metadata?.scheduledDepartureToday === true;

function signature(previews: AssignmentPreview[]): string {
  // Include room ownership, rather than just counts or the employee order.
  return previews.map(person => `${person.staffId}:${person.rooms.map(room => room.id).sort().join(',')}`)
    .sort().join('|');
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function affinityPenalty(previews: AssignmentPreview[], affinityMap?: RoomAffinityMap): number {
  if (!affinityMap?.size) return 0;
  let reward = 0;
  for (const person of previews) {
    for (let a = 0; a < person.rooms.length; a += 1) {
      for (let b = a + 1; b < person.rooms.length; b += 1) {
        const left = person.rooms[a].room_number;
        const right = person.rooms[b].room_number;
        reward += affinityMap.get(left < right ? `${left}|${right}` : `${right}|${left}`) || 0;
      }
    }
  }
  // Manager-observed room pairings are a soft preference; fairness dominates.
  return -Math.min(200, reward * 16);
}

function objective(previews: AssignmentPreview[], affinityMap?: RoomAffinityMap): number {
  const overage = previews.reduce((sum, person) =>
    sum + Math.max(0, person.estimatedMinutes - AVAILABLE_WORK_MINUTES), 0);
  return computeFairnessMetrics(previews).score + overage * 1000 + affinityPenalty(previews, affinityMap);
}

function isCompleteAndUnique(previews: AssignmentPreview[]): boolean {
  const roomIds = previews.flatMap(person => person.rooms.map(room => room.id));
  const staffIds = previews.map(person => person.staffId);
  return roomIds.every(Boolean) && new Set(roomIds).size === roomIds.length
    && staffIds.every(Boolean) && new Set(staffIds).size === staffIds.length;
}

/**
 * Search real one-for-one exchanges, not a permutation of whole staff schedules.
 * Exchange like-for-like service types so checkout/daily numbers stay fair.
 * Accept only comparable workloads, and never introduce a new shift overrun.
 * The seeded near-equal alternatives give the existing best-of-N caller actual
 * room configurations to compare rather than ten employee-name rotations.
 */
export function diversifyHousekeepingCandidate(
  original: AssignmentPreview[],
  options: Options,
): AssignmentPreview[] {
  if (original.length < 2 || !isCompleteAndUnique(original)) return original;
  if (options.enforceGozsduRoutes && !original.every(person =>
    person.rooms.length === 0 || gozsduRoomsCanShare(person.rooms))) return original;
  const baseline = objective(original, options.affinityMap);
  if (!Number.isFinite(baseline)) return original;

  const seed = Math.abs(Math.trunc(options.randomSeed ?? 0));
  let current = original;
  const visited = new Set([signature(original)]);
  // Two exchanges can redistribute four actual rooms while retaining section,
  // daily/checkout, shift and building constraints. Bound the work for large hotels.
  for (let pass = 0; pass < 2; pass += 1) {
    const currentScore = objective(current, options.affinityMap);
    const tolerance = Math.min(220, Math.max(35, computeFairnessMetrics(original).score * 0.012));
    let chosen: AssignmentPreview[] | null = null;
    let chosenScore = Number.POSITIVE_INFINITY;
    let chosenTie = Number.POSITIVE_INFINITY;
    let evaluated = 0;
    const people = current.filter(person => person.rooms.length > 0);
    const pairs: Array<{ from: number; to: number; left: RoomForAssignment; right: RoomForAssignment; rank: number }> = [];
    for (let a = 0; a < people.length; a += 1) {
      for (let b = a + 1; b < people.length; b += 1) {
        for (const left of people[a].rooms) for (const right of people[b].rooms) {
          if (isCheckout(left) !== isCheckout(right)) continue;
          pairs.push({ from: a, to: b, left, right,
            rank: stableHash(`${seed}:${pass}:${left.id}:${right.id}`) });
        }
      }
    }
    pairs.sort((a, b) => a.rank - b.rank);
    for (const { from, to, left, right, rank } of pairs) {
      if (evaluated++ >= 220) break;
      const source = people[from];
      const target = people[to];
      if (options.enforceGozsduRoutes && (
        !gozsduRoomsCanShare([...source.rooms.filter(room => room.id !== left.id), right])
        || !gozsduRoomsCanShare([...target.rooms.filter(room => room.id !== right.id), left])
      )) continue;
      const afterFirst = moveRoom(current, left.id, source.staffId, target.staffId);
      const candidate = moveRoom(afterFirst, right.id, target.staffId, source.staffId);
      if (candidate === current || !isCompleteAndUnique(candidate)) continue;
      const key = signature(candidate);
      if (visited.has(key)) continue;
      if (candidate.some((person, index) => {
        const prior = current[index];
        const oldOvertime = Math.max(0, prior.estimatedMinutes - AVAILABLE_WORK_MINUTES);
        const newOvertime = Math.max(0, person.estimatedMinutes - AVAILABLE_WORK_MINUTES);
        return newOvertime > oldOvertime;
      })) continue;
      const score = objective(candidate, options.affinityMap);
      if (score > baseline + tolerance) continue;
      // The global best-of-N selector handles quality; seed breaks near-ties
      // to make multiple *room-based* plans discoverable on regeneration.
      const tie = stableHash(`${seed}:${pass}:${key}:${rank}`);
      if (score < chosenScore - 0.001 || (Math.abs(score - chosenScore) < 0.001 && tie < chosenTie)) {
        chosen = candidate;
        chosenScore = score;
        chosenTie = tie;
      }
    }
    if (!chosen) break;
    // A near-equal exchange is permitted, but a substantial regression is not.
    if (chosenScore > currentScore + tolerance) break;
    current = chosen;
    visited.add(signature(current));
  }
  return current;
}

export function sameHousekeepingRoomGroups(
  left: AssignmentPreview[], right: AssignmentPreview[],
): boolean {
  // Detect room-group equivalence independent of the employee names/IDs.
  const groupKeys = (plan: AssignmentPreview[]) => plan
    .map(person => person.rooms.map(room => room.id).sort().join('|'))
    .sort().join('::');
  return groupKeys(left) === groupKeys(right);
}
