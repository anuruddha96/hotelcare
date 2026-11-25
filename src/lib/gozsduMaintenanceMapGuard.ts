type Room = { id: string };
type Registry = { room_id: string; pms_room_name: string; service_status: string };
type Section = { id: string; name: string };
type Mapping = { room_id: string; section_id: string };

/** Gozsdu-only validation. Never infer a physical section from PMS prefixes or
 * the registry building_code. UUIDs disambiguate repeated local room numbers. */
export function validateGozsduMaintenanceMap(
  rooms: readonly Room[],
  registry: readonly Registry[],
  sections: readonly Section[],
  mappings: readonly Mapping[],
): void {
  if (!rooms.length) return;
  const roomIds = new Set(rooms.map(room => room.id));
  if (roomIds.size !== rooms.length) throw new Error('Duplicate Gozsdu room IDs in maintenance inventory.');
  const registryForRooms = registry.filter(entry => roomIds.has(entry.room_id));
  const mapsForRooms = mappings.filter(entry => roomIds.has(entry.room_id));
  if (registryForRooms.length !== rooms.length || mapsForRooms.length !== rooms.length) {
    throw new Error('Gozsdu room registry or physical Team View mapping is incomplete.');
  }
  const registryById = new Map(registryForRooms.map(entry => [entry.room_id, entry]));
  const mapById = new Map(mapsForRooms.map(entry => [entry.room_id, entry]));
  const sectionById = new Map(sections.map(section => [section.id, section]));
  if (registryById.size !== rooms.length || mapById.size !== rooms.length) {
    throw new Error('Duplicate Gozsdu registry or physical section mappings.');
  }
  for (const room of rooms) {
    const entry = registryById.get(room.id);
    const mapping = mapById.get(room.id);
    const section = mapping && sectionById.get(mapping.section_id);
    if (!entry?.pms_room_name?.trim() || !section?.name?.trim()) {
      throw new Error('Gozsdu room lacks an accessible PMS label or mapped Team View section.');
    }
    const excluded = ['not available', 'private apartment'].includes(section.name.trim().toLowerCase());
    if ((entry.service_status === 'operating') === excluded) {
      throw new Error('Gozsdu mapped room status disagrees with the operating-room registry.');
    }
  }
}
