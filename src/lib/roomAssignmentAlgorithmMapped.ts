import {
  AVAILABLE_WORK_MINUTES,
  type AssignmentPreview,
  type FairnessMetrics,
  type HotelAssignmentConfig,
  type RoomAffinityMap,
  type RoomForAssignment,
  type StaffForAssignment,
  type WingProximityMap,
  autoAssignRooms as baseAutoAssignRooms,
  calculateRoomTime,
  calculateRoomWeight,
  calculateTimeEstimation,
  computeFairnessMetrics as baseComputeFairnessMetrics,
  getFloorFromRoomNumber,
  isHotelMemoriesBudapest,
} from './roomAssignmentAlgorithm';

export * from './roomAssignmentAlgorithm';

/**
 * Hotel Memories uses manager-configured operational sections as the physical
 * cleaning map. The generic allocator deliberately treats zones as a soft
 * preference so it can maximize global fairness; at Memories that can scatter
 * one mapped side across many housekeepers. This adapter keeps the generic
 * behavior everywhere else, but makes the configured section the primary unit
 * of work at Hotel Memories.
 */

function seededRandom(seed: number): () => number {
  let value = Math.abs(Math.trunc(seed)) || 1;
  return () => {
    value = (value * 1664525 + 1013904223) & 0x7fffffff;
    return value / 0x7fffffff;
  };
}

function isCheckoutLike(room: RoomForAssignment): boolean {
  return room.is_checkout_room === true || room.pms_metadata?.scheduledDepartureToday === true;
}

function roomOrdinal(roomNumber: string): number {
  const values = String(roomNumber || '').match(/\d+/g);
  return values?.length ? Number(values[values.length - 1]) : Number.MAX_SAFE_INTEGER;
}

function sortSectionRooms(rooms: RoomForAssignment[]): RoomForAssignment[] {
  return [...rooms].sort((a, b) => {
    const checkoutDiff = Number(isCheckoutLike(b)) - Number(isCheckoutLike(a));
    if (checkoutDiff !== 0) return checkoutDiff;
    const timeDiff = calculateRoomTime(b) - calculateRoomTime(a);
    if (timeDiff !== 0) return timeDiff;
    const floorA = a.floor_number ?? getFloorFromRoomNumber(a.room_number);
    const floorB = b.floor_number ?? getFloorFromRoomNumber(b.room_number);
    if (floorA !== floorB) return floorA - floorB;
    return roomOrdinal(a.room_number) - roomOrdinal(b.room_number)
      || a.room_number.localeCompare(b.room_number);
  });
}

function previewFromRooms(staff: StaffForAssignment, rooms: RoomForAssignment[]): AssignmentPreview {
  const sorted = sortSectionRooms(rooms);
  const estimate = calculateTimeEstimation(sorted);
  return {
    staffId: staff.id,
    staffName: staff.full_name,
    rooms: sorted,
    totalWeight: sorted.reduce((sum, room) => sum + calculateRoomWeight(room), 0),
    checkoutCount: sorted.filter(isCheckoutLike).length,
    dailyCount: sorted.filter(room => !isCheckoutLike(room)).length,
    ...estimate,
  };
}

function sectionShares(workerCount: number): number[] {
  if (workerCount <= 1) return [1];
  if (workerCount === 2) return [0.62, 0.38];
  if (workerCount === 3) return [0.52, 0.24, 0.24];
  const primary = 0.46;
  const helper = (1 - primary) / (workerCount - 1);
  return [primary, ...Array.from({ length: workerCount - 1 }, () => helper)];
}

type SectionGroup = {
  id: string;
  rooms: RoomForAssignment[];
  minutes: number;
};

function autoAssignMappedSections(
  rooms: RoomForAssignment[],
  staff: StaffForAssignment[],
  randomSeed: number,
): AssignmentPreview[] {
  const rand = seededRandom(randomSeed);
  const assignments = new Map<string, RoomForAssignment[]>(staff.map(member => [member.id, []]));
  const actualMinutes = new Map<string, number>(staff.map(member => [member.id, 0]));
  const actualCheckoutCount = new Map<string, number>(staff.map(member => [member.id, 0]));
  const plannedMinutes = new Map<string, number>(staff.map(member => [member.id, 0]));
  const primarySectionCount = new Map<string, number>(staff.map(member => [member.id, 0]));
  const tieRank = new Map<string, number>(staff.map(member => [member.id, rand()]));

  const grouped = new Map<string, RoomForAssignment[]>();
  const unmapped: RoomForAssignment[] = [];
  for (const room of rooms) {
    const sectionId = room.housekeeping_section_id;
    if (!sectionId) {
      unmapped.push(room);
      continue;
    }
    const list = grouped.get(sectionId) || [];
    list.push(room);
    grouped.set(sectionId, list);
  }

  const sections: SectionGroup[] = Array.from(grouped.entries())
    .map(([id, sectionRooms]) => ({
      id,
      rooms: sectionRooms,
      minutes: sectionRooms.reduce((sum, room) => sum + calculateRoomTime(room), 0),
    }))
    .sort((a, b) => b.minutes - a.minutes || b.rooms.length - a.rooms.length || a.id.localeCompare(b.id));

  if (sections.length === 0) {
    return baseAutoAssignRooms(rooms, staff, undefined, undefined, {
      hotelName: 'Hotel Memories Budapest',
      randomSeed,
    });
  }

  const totalMinutes = rooms.reduce((sum, room) => sum + calculateRoomTime(room), 0);
  const targetMinutes = Math.max(1, totalMinutes / Math.max(1, staff.length));

  // Start with one owner per configured section. When more housekeepers than
  // sections are working, add helpers to the busiest sections rather than
  // scattering every section across everybody.
  const slots = new Map<string, number>(sections.map(section => [section.id, 1]));
  let spareWorkers = Math.max(0, staff.length - sections.length);
  while (spareWorkers > 0) {
    const target = sections
      .filter(section => (slots.get(section.id) || 1) < Math.min(staff.length, section.rooms.length))
      .sort((a, b) => {
        const loadA = a.minutes / (slots.get(a.id) || 1);
        const loadB = b.minutes / (slots.get(b.id) || 1);
        return loadB - loadA || b.rooms.length - a.rooms.length || rand() - 0.5;
      })[0];
    if (!target) break;
    slots.set(target.id, (slots.get(target.id) || 1) + 1);
    spareWorkers -= 1;
  }

  // Safety override: a very heavy section may need a helper even when every
  // cleaner already owns another section. The helper still receives only this
  // mapped section's overflow, so locality remains explicit and understandable.
  for (const section of sections) {
    let workerCount = slots.get(section.id) || 1;
    while (
      section.minutes / workerCount > AVAILABLE_WORK_MINUTES
      && workerCount < Math.min(staff.length, section.rooms.length)
    ) {
      workerCount += 1;
    }
    slots.set(section.id, workerCount);
  }

  const sectionStaff = new Map<string, StaffForAssignment[]>();

  // Pass 1: choose one primary owner for every section. Prefer a housekeeper who
  // does not already own another section, then the lightest planned route. A
  // seeded tie rank means Regenerate can rotate who receives a side without
  // changing the hotel's physical mapping.
  for (const section of sections) {
    const unused = staff.filter(member => (primarySectionCount.get(member.id) || 0) === 0);
    const pool = unused.length > 0 ? unused : staff;
    const primary = [...pool].sort((a, b) =>
      (plannedMinutes.get(a.id) || 0) - (plannedMinutes.get(b.id) || 0)
      || (primarySectionCount.get(a.id) || 0) - (primarySectionCount.get(b.id) || 0)
      || (tieRank.get(a.id) || 0) - (tieRank.get(b.id) || 0)
      || a.full_name.localeCompare(b.full_name)
    )[0];

    sectionStaff.set(section.id, [primary]);
    primarySectionCount.set(primary.id, (primarySectionCount.get(primary.id) || 0) + 1);
    const primaryShare = sectionShares(slots.get(section.id) || 1)[0];
    plannedMinutes.set(primary.id, (plannedMinutes.get(primary.id) || 0) + section.minutes * primaryShare);
  }

  // Pass 2: place helper slots. If there is an otherwise unused housekeeper,
  // use them before making someone cover two zones.
  for (const section of sections) {
    const wanted = slots.get(section.id) || 1;
    const selected = sectionStaff.get(section.id)!;
    const shares = sectionShares(wanted);
    for (let index = 1; index < wanted; index++) {
      const remaining = staff.filter(member => !selected.some(candidate => candidate.id === member.id));
      if (remaining.length === 0) break;
      const helper = [...remaining].sort((a, b) =>
        Number((primarySectionCount.get(a.id) || 0) > 0) - Number((primarySectionCount.get(b.id) || 0) > 0)
        || (plannedMinutes.get(a.id) || 0) - (plannedMinutes.get(b.id) || 0)
        || (tieRank.get(a.id) || 0) - (tieRank.get(b.id) || 0)
        || a.full_name.localeCompare(b.full_name)
      )[0];
      selected.push(helper);
      plannedMinutes.set(helper.id, (plannedMinutes.get(helper.id) || 0) + section.minutes * shares[index]);
    }
  }

  // Assign rooms only inside the section's selected team. The primary receives
  // the largest share (62% when two people cover a section); helpers receive the
  // overflow. Workload and checkout weight are still considered inside the zone.
  for (const section of sections) {
    const candidates = sectionStaff.get(section.id) || [];
    if (candidates.length === 0) continue;
    const shares = sectionShares(candidates.length);
    const localMinutes = new Map<string, number>(candidates.map(member => [member.id, 0]));
    const localCount = new Map<string, number>(candidates.map(member => [member.id, 0]));
    const localCheckouts = new Map<string, number>(candidates.map(member => [member.id, 0]));
    const checkoutTotal = section.rooms.filter(isCheckoutLike).length;

    for (const room of sortSectionRooms(section.rooms)) {
      const roomMinutes = calculateRoomTime(room);
      const checkout = isCheckoutLike(room);
      const winner = candidates
        .map((member, index) => {
          const share = shares[index] || 1 / candidates.length;
          const minuteTarget = Math.max(roomMinutes, section.minutes * share);
          const countTarget = Math.max(1, section.rooms.length * share);
          const checkoutTarget = Math.max(0.75, checkoutTotal * share);
          const projectedGlobal = (actualMinutes.get(member.id) || 0) + roomMinutes;
          const shiftPenalty = projectedGlobal > AVAILABLE_WORK_MINUTES
            ? (projectedGlobal - AVAILABLE_WORK_MINUTES) * 8
            : 0;
          const score =
            (((localMinutes.get(member.id) || 0) + roomMinutes) / minuteTarget) * 100
            + (((localCount.get(member.id) || 0) + 1) / countTarget) * 60
            + (checkout ? (((localCheckouts.get(member.id) || 0) + 1) / checkoutTarget) * 30 : 0)
            + (projectedGlobal / targetMinutes) * 24
            + shiftPenalty
            + rand() * 1.25;
          return { member, score };
        })
        .sort((a, b) => a.score - b.score || a.member.full_name.localeCompare(b.member.full_name))[0].member;

      assignments.get(winner.id)!.push(room);
      actualMinutes.set(winner.id, (actualMinutes.get(winner.id) || 0) + roomMinutes);
      localMinutes.set(winner.id, (localMinutes.get(winner.id) || 0) + roomMinutes);
      localCount.set(winner.id, (localCount.get(winner.id) || 0) + 1);
      if (checkout) {
        actualCheckoutCount.set(winner.id, (actualCheckoutCount.get(winner.id) || 0) + 1);
        localCheckouts.set(winner.id, (localCheckouts.get(winner.id) || 0) + 1);
      }
    }

    // Best-effort majority invariant. If rounding/heavy checkouts left the
    // primary with too few rooms, move the lightest safe rooms from helpers
    // until the primary visibly owns most of the mapped section.
    if (candidates.length > 1) {
      const primary = candidates[0];
      const majorityShare = candidates.length === 2 ? 0.56 : 0.46;
      const minimumPrimaryRooms = Math.ceil(section.rooms.length * majorityShare);
      const countPrimaryRooms = () => assignments.get(primary.id)!
        .filter(room => room.housekeeping_section_id === section.id).length;

      while (countPrimaryRooms() < minimumPrimaryRooms) {
        const donors = candidates.slice(1)
          .map(member => ({
            member,
            rooms: assignments.get(member.id)!
              .filter(room => room.housekeeping_section_id === section.id)
              .sort((a, b) =>
                Number(isCheckoutLike(a)) - Number(isCheckoutLike(b))
                || calculateRoomTime(a) - calculateRoomTime(b)
                || roomOrdinal(a.room_number) - roomOrdinal(b.room_number)
              ),
          }))
          .filter(entry => entry.rooms.length > 0)
          .sort((a, b) => b.rooms.length - a.rooms.length);
        const donor = donors[0];
        if (!donor) break;
        const movable = donor.rooms.find(room =>
          (actualMinutes.get(primary.id) || 0) + calculateRoomTime(room) <= AVAILABLE_WORK_MINUTES
        );
        if (!movable) break;

        const donorRooms = assignments.get(donor.member.id)!;
        const index = donorRooms.findIndex(room => room.id === movable.id);
        if (index < 0) break;
        donorRooms.splice(index, 1);
        assignments.get(primary.id)!.push(movable);
        const minutes = calculateRoomTime(movable);
        actualMinutes.set(primary.id, (actualMinutes.get(primary.id) || 0) + minutes);
        actualMinutes.set(donor.member.id, (actualMinutes.get(donor.member.id) || 0) - minutes);
        if (isCheckoutLike(movable)) {
          actualCheckoutCount.set(primary.id, (actualCheckoutCount.get(primary.id) || 0) + 1);
          actualCheckoutCount.set(donor.member.id, Math.max(0, (actualCheckoutCount.get(donor.member.id) || 0) - 1));
        }
      }
    }
  }

  // Any room that has not yet been mapped stays assignable, but it never causes
  // mapped sections to be broken apart. Put only these exceptions onto the
  // lightest route and flag them naturally in the existing room UI.
  for (const room of sortSectionRooms(unmapped)) {
    const minutes = calculateRoomTime(room);
    const checkout = isCheckoutLike(room);
    const winner = [...staff].sort((a, b) => {
      const scoreA = (actualMinutes.get(a.id) || 0)
        + (assignments.get(a.id)?.length || 0) * 4
        + (checkout ? (actualCheckoutCount.get(a.id) || 0) * 28 : 0)
        + (tieRank.get(a.id) || 0);
      const scoreB = (actualMinutes.get(b.id) || 0)
        + (assignments.get(b.id)?.length || 0) * 4
        + (checkout ? (actualCheckoutCount.get(b.id) || 0) * 28 : 0)
        + (tieRank.get(b.id) || 0);
      return scoreA - scoreB || a.full_name.localeCompare(b.full_name);
    })[0];
    assignments.get(winner.id)!.push(room);
    actualMinutes.set(winner.id, (actualMinutes.get(winner.id) || 0) + minutes);
    if (checkout) actualCheckoutCount.set(winner.id, (actualCheckoutCount.get(winner.id) || 0) + 1);
  }

  return staff.map(member => previewFromRooms(member, assignments.get(member.id) || []));
}

export function autoAssignRooms(
  rooms: RoomForAssignment[],
  staff: StaffForAssignment[],
  wingProximityMap?: WingProximityMap,
  affinityMap?: RoomAffinityMap,
  hotelConfig?: HotelAssignmentConfig,
): AssignmentPreview[] {
  const hasConfiguredSections = rooms.some(room => !!room.housekeeping_section_id);
  if (!isHotelMemoriesBudapest(hotelConfig?.hotelName) || !hasConfiguredSections) {
    return baseAutoAssignRooms(rooms, staff, wingProximityMap, affinityMap, hotelConfig);
  }
  if (staff.length === 0 || rooms.length === 0) {
    return staff.map(member => previewFromRooms(member, []));
  }
  return autoAssignMappedSections(
    rooms,
    staff,
    hotelConfig?.randomSeed ?? Date.now(),
  );
}

/**
 * In mapped hotels, locality means the configured operational section, not the
 * apparent floor number. This matters for Hotel Memories' "202 - 308 Middle"
 * section, which intentionally contains rooms whose numbers look like different
 * floors. Keep the public metric field name for compatibility, but score section
 * splits when section mappings are present.
 */
export function computeFairnessMetrics(previews: AssignmentPreview[]): FairnessMetrics {
  const base = baseComputeFairnessMetrics(previews);
  const mappedRooms = previews.flatMap(preview => preview.rooms)
    .filter(room => !!room.housekeeping_section_id);
  if (mappedRooms.length === 0) return base;

  const owners = new Map<string, Set<string>>();
  for (const preview of previews) {
    for (const room of preview.rooms) {
      if (!room.housekeeping_section_id) continue;
      if (!owners.has(room.housekeeping_section_id)) owners.set(room.housekeeping_section_id, new Set());
      owners.get(room.housekeeping_section_id)!.add(preview.staffId);
    }
  }
  const splitSections = Array.from(owners.values())
    .reduce((sum, sectionOwners) => sum + Math.max(0, sectionOwners.size - 1), 0);

  return {
    ...base,
    splitFloorCount: splitSections,
    score: base.score - base.splitFloorCount * 500 + splitSections * 900,
  };
}
