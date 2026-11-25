import {
  autoAssignRooms,
  buildAffinityMap,
  computeFairnessMetrics,
  type AssignmentPreview,
  type RoomAffinityMap,
  type RoomForAssignment,
  type StaffForAssignment,
} from '@/lib/roomAssignmentAlgorithm';

export type HousekeepingAssignmentSignals = {
  affinityMap: RoomAffinityMap;
  staffPreferences: Record<string, string[]>;
  affinityPairCount: number;
  learningConfidence: number;
  correctionCount: number;
  sampleCount: number;
  modelVersion: string | null;
};

export const EMPTY_HOUSEKEEPING_ASSIGNMENT_SIGNALS: HousekeepingAssignmentSignals = {
  affinityMap: new Map(),
  staffPreferences: {},
  affinityPairCount: 0,
  learningConfidence: 0,
  correctionCount: 0,
  sampleCount: 0,
  modelVersion: null,
};

export function sanitizeStaffPreferences(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string[]> = {};

  for (const [staffId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(raw)) continue;
    const preferences = [...new Set(
      raw
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean),
    )].slice(0, 10);
    if (preferences.length) result[staffId] = preferences;
  }

  return result;
}

function finiteRatio(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(0.95, number));
}

/**
 * Load hotel-specific evidence without making AI a hard dependency.
 *
 * 1. assignment_patterns = historical room pairs actually kept together.
 * 2. learning profile = repeated explicit manager corrections only.
 * 3. configured housekeeping sections = the strongest hotel-locality signal.
 *
 * If any optional signal is unavailable, the caller still receives a valid
 * empty signal set and the existing fair/locality algorithm remains usable.
 */
export async function loadHousekeepingAssignmentSignals(options: {
  supabase: any;
  organizationSlug: string;
  hotelId: string;
  hotelKeys: string[];
  rooms: RoomForAssignment[];
}): Promise<{ rooms: RoomForAssignment[]; signals: HousekeepingAssignmentSignals }> {
  const { supabase, organizationSlug, hotelId, hotelKeys, rooms } = options;

  const [patternsResult, profileResult, sectionsResult] = await Promise.all([
    supabase
      .from('assignment_patterns')
      .select('room_number_a,room_number_b,pair_count')
      .eq('organization_slug', organizationSlug)
      .in('hotel', hotelKeys)
      .order('pair_count', { ascending: false })
      .limit(250),
    supabase
      .from('housekeeping_assignment_learning_profiles')
      .select('model_version,sample_count,correction_count,confidence_score,staff_preferences')
      .eq('organization_slug', organizationSlug)
      .eq('hotel_id', hotelId)
      .maybeSingle(),
    supabase
      .from('hotel_housekeeping_sections')
      .select('id,name,hotel_name,is_active')
      .in('hotel_name', hotelKeys)
      .eq('is_active', true),
  ]);

  // These are enhancement signals. A missing migration or restrictive RLS must
  // never block tomorrow's operational plan, so failures degrade gracefully.
  if (patternsResult.error) {
    console.warn('[HousekeepingLearning] historical affinity unavailable:', patternsResult.error);
  }
  if (profileResult.error) {
    console.warn('[HousekeepingLearning] learned profile unavailable:', profileResult.error);
  }
  if (sectionsResult.error) {
    console.warn('[HousekeepingLearning] housekeeping sections unavailable:', sectionsResult.error);
  }

  const patterns = (patternsResult.data || []) as Array<{
    room_number_a: string;
    room_number_b: string;
    pair_count: number;
  }>;

  const sections = (sectionsResult.data || []) as Array<{
    id: string;
    name: string;
    hotel_name: string;
    is_active: boolean;
  }>;
  const sectionById = new Map(sections.map(section => [section.id, section]));
  const sectionIds = sections.map(section => section.id);

  let roomSectionRows: Array<{ room_id: string; section_id: string }> = [];
  if (sectionIds.length) {
    const { data, error } = await supabase
      .from('hotel_housekeeping_section_rooms')
      .select('room_id,section_id')
      .in('section_id', sectionIds);
    if (error) {
      console.warn('[HousekeepingLearning] room section mapping unavailable:', error);
    } else {
      roomSectionRows = (data || []) as Array<{ room_id: string; section_id: string }>;
    }
  }

  const sectionByRoom = new Map(roomSectionRows.map(row => [row.room_id, row.section_id]));
  const enrichedRooms = rooms.map(room => {
    const sectionId = sectionByRoom.get(room.id);
    const section = sectionId ? sectionById.get(sectionId) : undefined;
    if (!sectionId || !section) return room;
    return {
      ...room,
      housekeeping_section_id: sectionId,
      housekeeping_section_name: section.name,
    };
  });

  const profile = profileResult.data as any;
  const signals: HousekeepingAssignmentSignals = {
    affinityMap: buildAffinityMap(patterns),
    staffPreferences: sanitizeStaffPreferences(profile?.staff_preferences),
    affinityPairCount: patterns.length,
    learningConfidence: finiteRatio(profile?.confidence_score),
    correctionCount: Math.max(0, Number(profile?.correction_count) || 0),
    sampleCount: Math.max(0, Number(profile?.sample_count) || 0),
    modelVersion: typeof profile?.model_version === 'string' ? profile.model_version : null,
  };

  return { rooms: enrichedRooms, signals };
}

/**
 * Best-of-N generation with historical affinity and manager-learned soft
 * preferences. Fairness remains the final candidate selector, and the base
 * algorithm still owns hard workload/shift/locality safeguards.
 */
export function generateLearnedHousekeepingPreview(
  rooms: RoomForAssignment[],
  staff: StaffForAssignment[],
  hotelName: string,
  signals: HousekeepingAssignmentSignals,
): AssignmentPreview[] {
  let best: AssignmentPreview[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = autoAssignRooms(
      rooms,
      staff,
      undefined,
      signals.affinityMap,
      {
        hotelName,
        staffPreferences: signals.staffPreferences,
        randomSeed: 1109 + attempt * 7919,
      },
    );
    const score = computeFairnessMetrics(candidate).score;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best || autoAssignRooms(
    rooms,
    staff,
    undefined,
    signals.affinityMap,
    { hotelName, staffPreferences: signals.staffPreferences },
  );
}
