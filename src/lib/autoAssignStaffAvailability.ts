export interface AutoAssignPreviewStaff {
  staffId: string;
}

export interface AutoAssignActiveWorkRow {
  room_id: string;
  assigned_to: string;
  status: string;
}

/**
 * Checked-in/scheduled staff are only the default selection. Managers may
 * deliberately change the available cleaner pool before regenerating.
 */
export function hasAutoAssignStaffPoolChanged(
  previews: readonly AutoAssignPreviewStaff[],
  selectedStaffIds: ReadonlySet<string>,
): boolean {
  if (!previews.length) return false;
  const previous = new Set(previews.map(preview => preview.staffId));
  if (previous.size !== selectedStaffIds.size) return true;
  for (const id of previous) if (!selectedStaffIds.has(id)) return true;
  return false;
}

/**
 * Work that has already started is not safe to silently move just because a
 * manager deselected that employee from Auto Assign.
 */
export function activeWorkOwnedByExcludedStaff(
  rows: readonly AutoAssignActiveWorkRow[],
  selectedStaffIds: ReadonlySet<string>,
): AutoAssignActiveWorkRow[] {
  return rows.filter(row =>
    (row.status === 'in_progress' || row.status === 'dnd_pending_retry')
    && !selectedStaffIds.has(row.assigned_to)
  );
}

export function selectedOwnerOverrides(
  owners: ReadonlyMap<string, string>,
  selectedStaffIds: ReadonlySet<string>,
): Map<string, string> {
  return new Map([...owners].filter(([, staffId]) => selectedStaffIds.has(staffId)));
}
