import type {
  AssignmentPreview,
  HotelAssignmentConfig,
  RoomAffinityMap,
  RoomForAssignment,
  StaffForAssignment,
  WingProximityMap,
} from './roomAssignmentAlgorithmCore';
import {
  AVAILABLE_WORK_MINUTES,
  calculateRoomTime,
  calculateRoomWeight,
  calculateTimeEstimation,
} from './roomAssignmentAlgorithmCore';

export type MemoriesSectionRelationType = 'nearby' | 'overflow' | 'avoid';
export type MemoriesRoomRelationType = 'together' | 'nearby' | 'far';

export interface MemoriesSectionLink {
  sourceSectionName: string;
  targetSectionName: string;
  relationType: MemoriesSectionRelationType;
  priority?: number;
  directional?: boolean;
  lowLoadThresholdMinutes?: number | null;
}

export interface MemoriesRoomLink {
  roomNumber: string;
  relatedRoomNumber: string;
  relationType: MemoriesRoomRelationType;
  priority?: number;
}

export interface MemoriesSpatialConfig {
  sectionLinks: MemoriesSectionLink[];
  roomLinks: MemoriesRoomLink[];
}

const DEFAULT_SECTION_LINKS: MemoriesSectionLink[] = [
  {
    sourceSectionName: 'Near the elevator',
    targetSectionName: '100 Side',
    relationType: 'nearby',
    priority: 90,
    directional: false,
  },
  {
    sourceSectionName: 'Near the elevator',
    targetSectionName: '130 - 140 Side',
    relationType: 'nearby',
    priority: 90,
    directional: false,
  },
  {
    sourceSectionName: 'Ground Floor',
    targetSectionName: '100 Side',
    relationType: 'overflow',
    priority: 80,
    directional: true,
    lowLoadThresholdMinutes: null,
  },
];

let spatialConfig: MemoriesSpatialConfig = {
  sectionLinks: DEFAULT_SECTION_LINKS,
  roomLinks: [],
};

const normalized = (value: string | null | undefined) => String(value || '').trim().toLocaleLowerCase();

function sectionLinkKey(link: MemoriesSectionLink): string {
  const a = normalized(link.sourceSectionName);
  const b = normalized(link.targetSectionName);
  return `${a}|${b}|${link.relationType}|${link.directional ? 'd' : 'u'}`;
}

export function setMemoriesSpatialConfig(config: Partial<MemoriesSpatialConfig> | null | undefined) {
  const supplied = config?.sectionLinks || [];
  const byKey = new Map<string, MemoriesSectionLink>();
  for (const link of DEFAULT_SECTION_LINKS) byKey.set(sectionLinkKey(link), link);
  for (const link of supplied) byKey.set(sectionLinkKey(link), link);
  spatialConfig = {
    sectionLinks: [...byKey.values()],
    roomLinks: config?.roomLinks || [],
  };
}

export function getMemoriesSpatialConfig(): MemoriesSpatialConfig {
  return spatialConfig;
}

type BaseAssign = (
  rooms: RoomForAssignment[],
  staff: StaffForAssignment[],
  wingProximityMap?: WingProximityMap,
  affinityMap?: RoomAffinityMap,
  hotelConfig?: HotelAssignmentConfig,
) => AssignmentPreview[];

type SeenZone = {
  staff: StaffForAssignment[];
  previews: AssignmentPreview[];
  averageMinutes: number;
};

let lastPlanningCall = 0;
const seenZones = new Map<string, SeenZone>();

function resetPlanningSessionIfNeeded(sectionName: string) {
  const now = Date.now();
  // Calls made by one Generate plan click happen synchronously, while separate
  // previews are separated by human interaction. Repeating a section also means
  // a new pass has started. This keeps cross-zone context bounded to one plan.
  if (now - lastPlanningCall > 250 || seenZones.has(normalized(sectionName))) seenZones.clear();
  lastPlanningCall = now;
}

function relationTouches(link: MemoriesSectionLink, currentName: string, seenName: string): boolean {
  const current = normalized(currentName);
  const seen = normalized(seenName);
  const source = normalized(link.sourceSectionName);
  const target = normalized(link.targetSectionName);
  if (link.directional) return source === seen && target === current;
  return (source === current && target === seen) || (source === seen && target === current);
}

function leastLoadedStaff(zone: SeenZone): StaffForAssignment | null {
  const byId = new Map(zone.staff.map(member => [member.id, member]));
  const ranked = zone.previews
    .filter(preview => byId.has(preview.staffId))
    .sort((a, b) => a.estimatedMinutes - b.estimatedMinutes || a.staffName.localeCompare(b.staffName));
  return ranked.length ? byId.get(ranked[0].staffId) || null : zone.staff[0] || null;
}

function affinityKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function configuredAffinity(existing?: RoomAffinityMap): RoomAffinityMap {
  const result = new Map(existing || []);
  for (const link of spatialConfig.roomLinks) {
    if (link.relationType === 'far') continue;
    const strength = link.relationType === 'together' ? 3 : 1.5;
    const priority = Math.max(1, Math.min(100, Number(link.priority || 50))) / 100;
    result.set(affinityKey(link.roomNumber, link.relatedRoomNumber), strength * priority);
  }
  return result;
}

function previewFor(staff: StaffForAssignment, rooms: RoomForAssignment[]): AssignmentPreview {
  const sorted = [...rooms].sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
  const estimate = calculateTimeEstimation(sorted);
  const checkout = (room: RoomForAssignment) => room.is_checkout_room || room.pms_metadata?.scheduledDepartureToday === true;
  return {
    staffId: staff.id,
    staffName: staff.full_name,
    rooms: sorted,
    totalWeight: sorted.reduce((sum, room) => sum + calculateRoomWeight(room), 0),
    checkoutCount: sorted.filter(checkout).length,
    dailyCount: sorted.filter(room => !checkout(room)).length,
    ...estimate,
  };
}

function enforceFarRoomPairs(previews: AssignmentPreview[], allStaff: StaffForAssignment[]): AssignmentPreview[] {
  if (previews.length < 2) return previews;
  const farLinks = spatialConfig.roomLinks.filter(link => link.relationType === 'far');
  if (!farLinks.length) return previews;

  const staffById = new Map(allStaff.map(member => [member.id, member]));
  const roomsByStaff = new Map(previews.map(preview => [preview.staffId, [...preview.rooms]]));

  for (const link of farLinks) {
    const owner = [...roomsByStaff.entries()].find(([, rooms]) => {
      const numbers = new Set(rooms.map(room => room.room_number));
      return numbers.has(link.roomNumber) && numbers.has(link.relatedRoomNumber);
    });
    if (!owner) continue;
    const [fromId, sourceRooms] = owner;
    const moving = sourceRooms.find(room => room.room_number === link.relatedRoomNumber);
    if (!moving) continue;
    const destination = [...roomsByStaff.entries()]
      .filter(([staffId, rooms]) => staffId !== fromId && !rooms.some(room => room.room_number === link.roomNumber))
      .map(([staffId, rooms]) => ({
        staffId,
        minutes: rooms.reduce((sum, room) => sum + calculateRoomTime(room), 0),
      }))
      .sort((a, b) => a.minutes - b.minutes)[0];
    if (!destination) continue;
    roomsByStaff.set(fromId, sourceRooms.filter(room => room.id !== moving.id));
    roomsByStaff.set(destination.staffId, [...(roomsByStaff.get(destination.staffId) || []), moving]);
  }

  return [...roomsByStaff.entries()].map(([staffId, rooms]) => {
    const person = staffById.get(staffId) || { id: staffId, full_name: `Staff ${staffId.slice(0, 6)}`, nickname: null };
    return previewFor(person, rooms);
  });
}

/**
 * Hotel Memories extension around the shared algorithm. The manager's section
 * map remains authoritative; configured links only allow one physically nearby
 * helper to participate across a section boundary. This prevents the former
 * hard zone rule from treating adjacent rooms as unrelated while avoiding a
 * hotel-wide free-for-all.
 */
export function autoAssignMemoriesSpatially(
  baseAssign: BaseAssign,
  rooms: RoomForAssignment[],
  nativeStaff: StaffForAssignment[],
  wingProximityMap?: WingProximityMap,
  affinityMap?: RoomAffinityMap,
  hotelConfig?: HotelAssignmentConfig,
): AssignmentPreview[] {
  const sectionName = rooms.find(room => room.housekeeping_section_name)?.housekeeping_section_name || '';
  if (!sectionName || !rooms.length || !nativeStaff.length) {
    return baseAssign(rooms, nativeStaff, wingProximityMap, affinityMap, hotelConfig);
  }

  resetPlanningSessionIfNeeded(sectionName);
  const candidates = new Map(nativeStaff.map(member => [member.id, member]));
  const currentMinutes = rooms.reduce((sum, room) => sum + calculateRoomTime(room), 0);
  const currentAverage = currentMinutes / Math.max(1, nativeStaff.length);

  for (const link of spatialConfig.sectionLinks
    .slice()
    .sort((a, b) => Number(b.priority || 50) - Number(a.priority || 50))) {
    for (const [seenName, seen] of seenZones.entries()) {
      if (!relationTouches(link, sectionName, seenName)) continue;
      if (link.relationType === 'avoid') continue;

      if (link.relationType === 'overflow') {
        const thresholdOk = link.lowLoadThresholdMinutes == null
          || seen.averageMinutes <= link.lowLoadThresholdMinutes;
        // Without a manager-set threshold, "light" is relative: only help the
        // target when the source has at least 25% less work per native worker.
        const materiallyLighter = seen.averageMinutes <= currentAverage * 0.75;
        if (!thresholdOk || !materiallyLighter || seen.averageMinutes >= AVAILABLE_WORK_MINUTES) continue;
      }

      const helper = leastLoadedStaff(seen);
      if (helper) candidates.set(helper.id, helper);
    }
  }

  const expandedStaff = [...candidates.values()];
  const result = baseAssign(
    rooms,
    expandedStaff,
    wingProximityMap,
    configuredAffinity(affinityMap),
    {
      ...hotelConfig,
      // User-mapped room relationships should matter more than accidental
      // numeric closeness, while fairness and shift penalties still dominate.
      affinityBonusMultiplier: Math.max(120, hotelConfig?.affinityBonusMultiplier || 0),
    },
  );
  const separated = enforceFarRoomPairs(result, expandedStaff);
  seenZones.set(normalized(sectionName), {
    staff: expandedStaff,
    previews: separated,
    averageMinutes: currentAverage,
  });
  return separated;
}
