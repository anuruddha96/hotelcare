export type PropertyArea = {
  id: string;
  name: string;
  task_type: string;
  is_active: boolean;
};

export type LegacyAreaTask = {
  task_name: string;
  task_type: string;
  assigned_to: string;
  source: string;
};

const normalize = (value: string) => value.trim().toLocaleLowerCase();

/** An old one-off task might call a reception "Reception" and the catalog
 * "Recepció". Treat a shared non-generic task type as POSSIBLY overlapping;
 * never silently delete, duplicate or override either assignment. */
export function legacyOverlapsArea(area: PropertyArea, task: LegacyAreaTask): boolean {
  return normalize(area.name) === normalize(task.task_name)
    || (normalize(area.task_type) !== 'public_area_cleaning'
      && normalize(area.task_type) === normalize(task.task_type));
}

export function findLegacyAreaConflicts(
  areas: readonly PropertyArea[],
  assignments: ReadonlyMap<string, string>,
  legacy: readonly LegacyAreaTask[],
): string[] {
  return areas.filter(area => area.is_active && assignments.has(area.id)
    && legacy.some(task => legacyOverlapsArea(area, task))).map(area => area.name);
}

/** Comparing all persisted IDs prevents an older browser tab from overwriting
 * the other manager's work via the existing replace-all RPC. */
export function sameAreaAssignments(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
): boolean {
  return left.size === right.size
    && [...left].every(([areaId, owner]) => right.get(areaId) === owner);
}

/** Retain existing assignments for archived catalog entries during an unrelated
 * edit. Never delete them just because they are hidden from the active list. */
export function planAreaPayload(
  areas: readonly PropertyArea[],
  assignments: ReadonlyMap<string, string>,
): { public_area_id: string; assigned_to: string }[] {
  const knownIds = new Set(areas.map(area => area.id));
  return [...assignments].filter(([id]) => knownIds.has(id))
    .map(([public_area_id, assigned_to]) => ({ public_area_id, assigned_to }));
}
