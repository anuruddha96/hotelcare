// Tenant data is supplied by the authorized caller; this module performs NO queries or writes.
import {
  autoAssignRooms, calculateRoomTime, computeFairnessMetrics, moveRoom,
  type AssignmentPreview, type HotelAssignmentConfig, type RoomAffinityMap,
  type RoomForAssignment, type StaffForAssignment, type WingProximityMap,
} from './roomAssignmentAlgorithm';
import { AVAILABLE_WORK_MINUTES, BREAK_TIME_MINUTES } from './roomAssignmentAlgorithmCore';
import { gozsduAllocationRespectsBuildings } from './gozsduBuildingAssignment';
import { sameHousekeepingRoomGroups } from './housekeepingCandidateDiversification';
import { assignSectionTasksToStaff, sectionTaskMinutesForStaff,
  type HousekeepingSectionTaskTemplate } from './housekeepingSectionTasks';

export type HousekeepingPlanningGoal = 'rebalance' | 'locality' | 'checkouts' | 'alternative';
export interface SmartPlanningOptions {
  rooms: RoomForAssignment[];
  staff: StaffForAssignment[];
  organizationSlug: string;
  hotelId: string;
  hotelConfig: HotelAssignmentConfig;
  goal: HousekeepingPlanningGoal;
  previous?: AssignmentPreview[];
  lockedRoomIds?: ReadonlySet<string>;
  shiftMinutes?: ReadonlyMap<string, number>;
  publicAreaTemplates?: HousekeepingSectionTaskTemplate[];
  fixedAreaOwners?: ReadonlyMap<string, string>;
  wingProximity?: WingProximityMap;
  affinity?: RoomAffinityMap;
  historicalSampleCount?: number;
  gozsdu?: boolean;
  seed?: number;
}
export interface SmartPlanningResult {
  plan: AssignmentPreview[] | null;
  changed: boolean;
  reason: string;
  candidateCount: number;
  roomMoves: number;
  publicAreaMinutes: ReadonlyMap<string, number>;
}

function ownerOf(plan: AssignmentPreview[]): Map<string, string> {
  return new Map(plan.flatMap(person => person.rooms.map(room => [room.id, person.staffId] as const)));
}
function distinctRooms(plan: AssignmentPreview[], rooms: RoomForAssignment[], staff: StaffForAssignment[]): boolean {
  const actual = plan.flatMap(person => person.rooms.map(room => room.id));
  return actual.length === rooms.length && new Set(actual).size === actual.length
    && actual.every(id => rooms.some(room => room.id === id))
    && plan.length === staff.length && plan.every(person => staff.some(s => s.id === person.staffId));
}
function areaMinutesFor(plan: AssignmentPreview[], options: SmartPlanningOptions): Map<string, number> {
  const assigned = assignSectionTasksToStaff(plan, options.publicAreaTemplates || []);
  const effective = assigned.map(task => ({
    ...task,
    staff_id: options.fixedAreaOwners?.get(task.id) || task.staff_id,
  }));
  return new Map(plan.map(person => [person.staffId, sectionTaskMinutesForStaff(effective, person.staffId)]));
}
function withinLimits(plan: AssignmentPreview[], options: SmartPlanningOptions): boolean {
  const previousOwners = ownerOf(options.previous || []);
  const area = areaMinutesFor(plan, options);
  return plan.every(person => {
    const shift = options.shiftMinutes?.get(person.staffId);
    // Shift minutes include a break, so subtract the same break used by room estimates.
    const roomAllowance = shift === undefined ? AVAILABLE_WORK_MINUTES : Math.max(0, shift - BREAK_TIME_MINUTES);
    return person.estimatedMinutes + (area.get(person.staffId) || 0) <= roomAllowance
      && person.rooms.every(room => !options.lockedRoomIds?.has(room.id)
        || previousOwners.get(room.id) === person.staffId);
  });
}
function score(plan: AssignmentPreview[], options: SmartPlanningOptions): number {
  const metric = computeFairnessMetrics(plan);
  const area = areaMinutesFor(plan, options);
  const loads = plan.map(person => person.estimatedMinutes + (area.get(person.staffId) || 0));
  const areaSpread = loads.length ? Math.max(...loads) - Math.min(...loads) : 0;
  const factor = options.goal === 'rebalance' ? 12 : options.goal === 'checkouts' ? 4 : 6;
  const locality = options.goal === 'locality' ? 700 : 200;
  const checkout = options.goal === 'checkouts' ? 2300 : 600;
  const affinityPenalty = (() => {
    if (!options.affinity?.size) return 0;
    let affinity = 0;
    for (const person of plan) for (let i = 0; i < person.rooms.length; i++)
      for (let j = i + 1; j < person.rooms.length; j++) {
        const left = person.rooms[i].room_number;
        const right = person.rooms[j].room_number;
        affinity += options.affinity.get(left < right ? `${left}|${right}` : `${right}|${left}`) || 0;
      }
    return -Math.min(200, affinity * 15);
  })();
  return metric.score + areaSpread * factor + metric.splitFloorCount * locality
    + metric.checkoutDiff * checkout + affinityPenalty;
}
function valid(plan: AssignmentPreview[], options: SmartPlanningOptions): boolean {
  return distinctRooms(plan, options.rooms, options.staff)
    && (!options.gozsdu || gozsduAllocationRespectsBuildings(plan))
    && withinLimits(plan, options);
}
function roomMoves(before: AssignmentPreview[], after: AssignmentPreview[]): number {
  const owners = ownerOf(before);
  return after.reduce((sum, person) => sum + person.rooms.filter(room =>
    owners.has(room.id) && owners.get(room.id) !== person.staffId).length, 0);
}
/**
 * Bounded search over generated plans plus individual room transfers. A regenerated
 * plan MUST change the actual room partitions, not just which staff name owns a
 * bundle. Do not relax property rules, manual locks, staff eligibility or shifts
 * merely to manufacture a different result. No DB operation occurs here.
 */
export function generateSmartHousekeepingPlan(options: SmartPlanningOptions): SmartPlanningResult {
  const empty = new Map<string, number>();
  const fail = (reason: string, candidateCount = 0): SmartPlanningResult => ({
    plan: options.previous || null, changed: false, reason, candidateCount,
    roomMoves: 0, publicAreaMinutes: options.previous ? areaMinutesFor(options.previous, options) : empty,
  });
  if (!options.organizationSlug || !options.hotelId || !options.hotelConfig.hotelName) return fail('Property or organization context is missing. Refresh the board.');
  if (new Set(options.rooms.map(room => room.id)).size !== options.rooms.length
    || new Set(options.staff.map(staff => staff.id)).size !== options.staff.length
    || new Set(options.rooms.map(room => room.hotel)).size > 1) return fail('Mixed-property or duplicate inventory is not safe to assign. Refresh PMS.');
  if (!options.rooms.length || !options.staff.length) return fail('No eligible rooms or scheduled staff are available.');
  const previousValid = !!options.previous?.length && distinctRooms(options.previous, options.rooms, options.staff);
  if (options.lockedRoomIds?.size && !previousValid) return fail('A locked room is no longer available. Refresh the plan and review the manual changes.');
  const candidatePlans: AssignmentPreview[][] = [];
  const seen = new Set<string>();
  const add = (plan: AssignmentPreview[]) => {
    if (!valid(plan, options)) return;
    const key = plan.map(person => `${person.staffId}:${person.rooms.map(room => room.id).sort().join(',')}`).sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    candidatePlans.push(plan);
  };
  if (previousValid && options.previous) add(options.previous);
  const startSeed = options.seed || 1109;
  for (let attempt = 0; attempt < 8; attempt++) {
    const plan = autoAssignRooms(options.rooms, options.staff, options.wingProximity,
      options.affinity, { ...options.hotelConfig, randomSeed: startSeed + attempt * 7919 });
    add(plan);
  }
  // Local neighborhood: single-room moves (the first rollout already searches
  // reciprocal swaps), bounded for the portfolio's largest properties.
  const seeds = [...candidatePlans].slice(0, 5);
  let explored = 0;
  for (const candidate of seeds) {
    for (const source of candidate) {
      for (const room of source.rooms) {
        if (options.lockedRoomIds?.has(room.id)) continue;
        for (const destination of candidate) {
          if (explored++ >= 240) break;
          if (source.staffId === destination.staffId) continue;
          add(moveRoom(candidate, room.id, source.staffId, destination.staffId));
        }
        if (explored >= 240) break;
      }
      if (explored >= 240) break;
    }
    if (explored >= 240) break;
  }
  if (!candidatePlans.length) return fail('No feasible assignment: check shift lengths, public-area duties, staffing and configured building routes.');
  const ordered = [...candidatePlans].sort((a, b) => score(a, options) - score(b, options));
  const bestScore = score(ordered[0], options);
  if (!previousValid) {
    const best = ordered[0];
    return { plan: best, changed: true, reason: `Plan balanced across ${options.staff.length} cleaners; room sizes, checkouts, routes${options.historicalSampleCount && options.historicalSampleCount >= 5 ? ' and available hotel history' : ''} considered.`,
      candidateCount: candidatePlans.length, roomMoves: 0, publicAreaMinutes: areaMinutesFor(best, options) };
  }
  // A modest quality tolerance permits alternatives without compromising a
  // materially better workload. A different staff-only permutation is rejected.
  const tolerance = Math.max(120, Math.abs(bestScore) * 0.08);
  const different = ordered.filter(plan => !sameHousekeepingRoomGroups(plan, options.previous!)
    && score(plan, options) <= bestScore + tolerance);
  if (!different.length) return fail('No comparably balanced alternative satisfies the current rooms, shifts, building routes and locked assignments. The previous plan was kept.', candidatePlans.length);
  const currentKey = options.previous!.map(person => person.rooms.map(room => room.id).sort().join('|')).sort().join('::');
  const ranked = different.sort((a, b) => score(a, options) - score(b, options)
    || roomMoves(options.previous!, b) - roomMoves(options.previous!, a));
  const chosen = options.goal === 'alternative' ? ranked[Math.abs(startSeed) % Math.min(3, ranked.length)] : ranked[0];
  const changedCount = roomMoves(options.previous!, chosen);
  const oldMetric = computeFairnessMetrics(options.previous!);
  const newMetric = computeFairnessMetrics(chosen);
  const difference = `${changedCount} room reassignment(s); checkout gap ${oldMetric.checkoutDiff} → ${newMetric.checkoutDiff}; estimated cleaning-time spread ${oldMetric.timeSpreadMinutes} → ${newMetric.timeSpreadMinutes} min.`;
  return { plan: chosen, changed: true, reason: difference,
    candidateCount: candidatePlans.length, roomMoves: changedCount,
    publicAreaMinutes: areaMinutesFor(chosen, options) };
}
