/* Read-only display helpers exclusively for Gozsdu Court Budapest's overview.
 * Never rewrite room_number or guess a physical building from a PMS code. */
export type OverviewRoom = { id: string; room_number: string };
export type OverviewRegistryEntry = { pms_room_name: string };
export type OverviewBuilding = { id: string; name: string; sort_order: number };
export type OverviewMapping = { room_id: string; section_id: string };

/** Missing registry names must be conspicuous, never silently fall back to a
 * numeric suffix that could refer to a different Gozsdu apartment. */
export function canonicalGozsduOverviewName(
  room: OverviewRoom,
  registryByRoom: ReadonlyMap<string, OverviewRegistryEntry>,
): string {
  return registryByRoom.get(room.id)?.pms_room_name?.trim() || 'Unverified PMS room';
}

export type OverviewBuildingGroup<TRoom extends OverviewRoom> = {
  key: string;
  label: string;
  rooms: TRoom[];
};

/** Group by the manager's existing section-room mapping, not by room_number,
 * floor_number, or the Previo room-type prefix (1B/2B/etc.). */
export function groupGozsduOverviewByBuilding<TRoom extends OverviewRoom>(
  rooms: readonly TRoom[],
  mappings: readonly OverviewMapping[],
  buildings: readonly OverviewBuilding[],
  displayName: (room: TRoom) => string,
): OverviewBuildingGroup<TRoom>[] {
  const buildingById = new Map(buildings.map(section => [section.id, section]));
  const sectionByRoomId = new Map(mappings.map(mapping => [mapping.room_id, mapping.section_id]));
  const groups = new Map<string, OverviewBuildingGroup<TRoom>>();
  for (const room of rooms) {
    const sectionId = sectionByRoomId.get(room.id);
    const section = sectionId ? buildingById.get(sectionId) : undefined;
    const key = section?.id || 'unmapped';
    if (!groups.has(key)) groups.set(key, { key, label: section?.name || 'Unmapped building', rooms: [] });
    groups.get(key)!.rooms.push(room);
  }
  return [...groups.values()].sort((a, b) => {
    const first = buildingById.get(a.key);
    const second = buildingById.get(b.key);
    if (!first) return second ? 1 : 0;
    if (!second) return -1;
    return first.sort_order - second.sort_order || first.name.localeCompare(second.name);
  }).map(group => ({ ...group, rooms: [...group.rooms].sort((a, b) =>
    displayName(a).localeCompare(displayName(b), undefined, { numeric: true })) }));
}
