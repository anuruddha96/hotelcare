import { supabase } from '@/integrations/supabase/client';
import { GOZSDU_COURT_HOTEL_ID, GOZSDU_COURT_HOTEL_NAME } from '@/lib/gozsdu-housekeeping';
import { canonicalGozsduOverviewName } from '@/lib/gozsduRoomOverviewDisplay';
import { validateGozsduMaintenanceMap } from '@/lib/gozsduMaintenanceMapGuard';

export type MaintenanceRoomOption = {
  id: string;
  hotel: string;
  roomNumber: string;
  label: string;
  building: string | null;
};

type RoomRow = {
  id: string;
  hotel: string;
  room_number: string;
  status: string | null;
  room_name: string | null;
  wing: string | null;
};
type RegistryRow = {
  room_id: string;
  pms_room_name: string;
  service_status: string;
  building_code: string | null;
};
type SectionRow = { id: string; name: string };
type MappingRow = { room_id: string; section_id: string };

const UNAVAILABLE_STATUSES = new Set(['out_of_order', 'unavailable', 'decommissioned']);

/** Mirrors GozsduCourtRoomOverview's room-ID registry predicate. Never infer
 * eligibility from cleaning status or truncate an apartment's PMS room code. */
export function eligibleMaintenanceRooms(
  rooms: readonly RoomRow[],
  registry: readonly RegistryRow[],
  sections: readonly SectionRow[] = [],
  mappings: readonly MappingRow[] = [],
): MaintenanceRoomOption[] {
  const byId = new Map(registry.map(entry => [entry.room_id, entry]));
  const sectionById = new Map(sections.map(section => [section.id, section.name]));
  const sectionByRoomId = new Map(mappings.map(mapping => [mapping.room_id, mapping.section_id]));
  const seen = new Set<string>();
  const result: MaintenanceRoomOption[] = [];
  for (const room of rooms) {
    if (seen.has(room.id)) continue;
    seen.add(room.id);
    const isGozsdu = room.hotel === GOZSDU_COURT_HOTEL_ID || room.hotel === GOZSDU_COURT_HOTEL_NAME;
    const registered = byId.get(room.id);
    if (isGozsdu && (registered?.service_status !== 'operating' || !registered.pms_room_name?.trim())) continue;
    if (!isGozsdu && UNAVAILABLE_STATUSES.has((room.status || '').toLowerCase())) continue;
    const label = isGozsdu
      ? canonicalGozsduOverviewName(room, byId as ReadonlyMap<string, { pms_room_name: string }>)
      : (room.room_number || '').trim();
    if (!label) continue;
    const sectionId = sectionByRoomId.get(room.id);
    result.push({
      id: room.id,
      hotel: room.hotel,
      roomNumber: label,
      label,
      // A registry building_code is a PMS grouping, not proof of a physical building.
      // The Gozsdu loader first verifies one active Team View section per room.
      building: isGozsdu
        ? ((sectionId && sectionById.get(sectionId)) || null)
        : (room.wing || null),
    });
  }
  return result.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }) || a.id.localeCompare(b.id));
}

/** A hotel is supplied ONLY through this tenant's authorized hotel configuration.
 * Fail closed if its aliases or the session's organisation are missing. */
export async function loadMaintenanceRoomOptions(
  hotelKeys: readonly string[],
  organizationSlug: string | null | undefined,
): Promise<MaintenanceRoomOption[]> {
  const keys = [...new Set(hotelKeys.filter(Boolean))];
  if (!organizationSlug || !keys.length) throw new Error('Hotel or organization is unavailable');
  const { data, error } = await supabase.from('rooms')
    .select('id,hotel,room_number,status,room_name,wing')
    .eq('organization_slug', organizationSlug)
    .in('hotel', keys)
    .order('room_number');
  if (error) throw error;
  const rooms = (data || []) as RoomRow[];
  const gozsduIds = rooms.filter(room => room.hotel === GOZSDU_COURT_HOTEL_ID || room.hotel === GOZSDU_COURT_HOTEL_NAME).map(room => room.id);
  if (!gozsduIds.length) return eligibleMaintenanceRooms(rooms, []);
  const { data: registry, error: registryError } = await (supabase as any)
    .from('gozsdu_housekeeping_room_registry')
    .select('room_id,pms_room_name,service_status,building_code')
    .in('room_id', gozsduIds);
  if (registryError) throw registryError; // Never fall back to an unfiltered Gozsdu room list.
  const { data: sections, error: sectionError } = await (supabase as any)
    .from('hotel_housekeeping_sections')
    .select('id,name')
    .eq('hotel_name', GOZSDU_COURT_HOTEL_NAME)
    .eq('is_active', true);
  if (sectionError) throw sectionError;
  const { data: mapped, error: mappingError } = await (supabase as any)
    .from('hotel_housekeeping_section_rooms')
    .select('room_id,section_id')
    .in('room_id', gozsduIds);
  if (mappingError) throw mappingError;
  const safeRegistry = (registry || []) as RegistryRow[];
  const safeSections = (sections || []) as SectionRow[];
  const safeMappings = (mapped || []) as MappingRow[];
  validateGozsduMaintenanceMap(
    rooms.filter(room => gozsduIds.includes(room.id)),
    safeRegistry, safeSections, safeMappings,
  );
  return eligibleMaintenanceRooms(rooms, safeRegistry, safeSections, safeMappings);
}

/** Repeat lookup immediately before insert: stale selections never pass client validation. */
export async function validateMaintenanceRoomOption(
  roomId: string,
  hotelKeys: readonly string[],
  organizationSlug: string | null | undefined,
): Promise<MaintenanceRoomOption> {
  const options = await loadMaintenanceRoomOptions(hotelKeys, organizationSlug);
  const selected = options.find(option => option.id === roomId);
  if (!selected) throw new Error('This room is no longer available for this hotel. Refresh and choose another room.');
  return selected;
}

export function searchMaintenanceRooms(options: readonly MaintenanceRoomOption[], term: string, limit = 30): MaintenanceRoomOption[] {
  const value = term.trim().toLocaleLowerCase();
  if (!value) return options.slice(0, limit);
  const compact = value.replace(/[^\p{L}\p{N}]/gu, '');
  return options.filter(option => {
    const haystack = `${option.label} ${option.roomNumber} ${option.building || ''}`.toLocaleLowerCase();
    return haystack.includes(value) || (!!compact && haystack.replace(/[^\p{L}\p{N}]/gu, '').includes(compact));
  }).slice(0, limit);
}
