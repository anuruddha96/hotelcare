import { supabase } from '@/integrations/supabase/client';
import { GOZSDU_COURT_HOTEL_ID, GOZSDU_COURT_HOTEL_NAME } from './gozsdu-housekeeping';

export type GozsduMappedOperatingRoom = {
  id: string;
  room_number: string;
  hotel: string;
  pms_room_name: string;
  section_name: string;
  label: string;
};

type RoomRow = { id: string; room_number: string; hotel: string };
type RegistryRow = { room_id: string; pms_room_name: string; service_status: string };
type SectionRow = { id: string; name: string; is_active: boolean };
type MappingRow = { room_id: string; section_id: string };

/**
 * Read the same manager-maintained Team View mapping and Gozsdu operating
 * registry used by GozsduCourtRoomOverview. Do not infer physical buildings
 * from Previo prefixes or a room number, and do not use reservation status
 * as a proxy for operating inventory.
 *
 * Fail closed on missing/ambiguous mapping or RLS errors: an incomplete
 * lookup must never silently offer unrelated or unavailable apartments.
 * This is a picker read model, not permission to release or resell a room.
 */
export function reconcileGozsduOperatingRooms(
  rooms: RoomRow[],
  registry: RegistryRow[],
  sections: SectionRow[],
  mappings: MappingRow[],
): GozsduMappedOperatingRoom[] {
  if (!rooms.length || registry.length !== rooms.length || mappings.length !== rooms.length) {
    throw new Error('Gozsdu Team View mapping is incomplete. Refresh the map before selecting a room.');
  }
  const roomIds = new Set(rooms.map(room => room.id));
  const registryById = new Map(registry.map(entry => [entry.room_id, entry]));
  const sectionsById = new Map(sections.filter(section => section.is_active).map(section => [section.id, section]));
  const mappingById = new Map(mappings.map(mapping => [mapping.room_id, mapping]));
  if (roomIds.size !== rooms.length || registryById.size !== registry.length || mappingById.size !== mappings.length) {
    throw new Error('Gozsdu Team View contains duplicate room mappings.');
  }

  const result: GozsduMappedOperatingRoom[] = [];
  const numbers = new Set<string>();
  for (const room of rooms) {
    const entry = registryById.get(room.id);
    const mapping = mappingById.get(room.id);
    const section = mapping && sectionsById.get(mapping.section_id);
    if (!entry || !mapping || !section || !room.room_number || !entry.pms_room_name) {
      throw new Error('Gozsdu Team View has an unmapped room, inaccessible section or PMS label.');
    }
    const excludedSection = section.name.trim().toLowerCase() === 'not available'
      || section.name.trim().toLowerCase() === 'private apartment';
    if ((entry.service_status === 'operating') === excludedSection) {
      throw new Error(`Gozsdu Team View and operating registry disagree for ${entry.pms_room_name}.`);
    }
    if (entry.service_status !== 'operating') continue;
    if (numbers.has(room.room_number)) {
      throw new Error(`Gozsdu room number ${room.room_number} is ambiguous. Review the mapping.`);
    }
    numbers.add(room.room_number);
    result.push({
      id: room.id, room_number: room.room_number, hotel: room.hotel,
      pms_room_name: entry.pms_room_name, section_name: section.name,
      label: `${entry.pms_room_name} · ${section.name}`,
    });
  }
  return result.sort((a, b) => a.section_name.localeCompare(b.section_name)
    || a.pms_room_name.localeCompare(b.pms_room_name, undefined, { numeric: true }));
}

export async function loadGozsduMappedOperatingRooms(organizationSlug: string): Promise<GozsduMappedOperatingRoom[]> {
  if (!organizationSlug) throw new Error('Your hotel access could not be verified.');
  const [{ data: rooms, error: roomsError }, { data: registry, error: registryError }, { data: sections, error: sectionsError }] = await Promise.all([
    supabase.from('rooms').select('id, room_number, hotel')
      .eq('organization_slug', organizationSlug).in('hotel', [GOZSDU_COURT_HOTEL_ID, GOZSDU_COURT_HOTEL_NAME]),
    (supabase as any).from('gozsdu_housekeeping_room_registry').select('room_id, pms_room_name, service_status'),
    (supabase as any).from('hotel_housekeeping_sections').select('id, name, is_active')
      .eq('hotel_name', GOZSDU_COURT_HOTEL_NAME).eq('is_active', true),
  ]);
  if (roomsError || registryError || sectionsError) {
    throw roomsError || registryError || sectionsError || new Error('Could not read Gozsdu Team View.');
  }
  const ids = (rooms || []).map(room => room.id);
  if (!ids.length) throw new Error('No authorized Gozsdu rooms are visible.');
  const { data: mappings, error: mappingsError } = await (supabase as any)
    .from('hotel_housekeeping_section_rooms').select('room_id, section_id').in('room_id', ids);
  if (mappingsError) throw mappingsError;
  return reconcileGozsduOperatingRooms(
    (rooms || []) as RoomRow[], (registry || []) as RegistryRow[],
    (sections || []) as SectionRow[], (mappings || []) as MappingRow[],
  );
}
