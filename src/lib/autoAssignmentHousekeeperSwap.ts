import type { AssignmentPreview } from './roomAssignmentAlgorithm';

/**
 * Swap the housekeepers attached to two complete Auto Assign workload bundles.
 *
 * The room arrays and calculated workload values deliberately stay in the same
 * preview positions. Only the staff identity attached to each bundle changes,
 * which lets a manager hand an entire mapped zone/workload to another cleaner
 * without moving every room one by one.
 */
export function swapAssignmentPreviewOwners(
  previews: AssignmentPreview[],
  firstStaffId: string,
  secondStaffId: string,
): AssignmentPreview[] {
  if (!firstStaffId || !secondStaffId || firstStaffId === secondStaffId) return previews;

  const first = previews.find(preview => preview.staffId === firstStaffId);
  const second = previews.find(preview => preview.staffId === secondStaffId);
  if (!first || !second) return previews;

  return previews.map(preview => {
    if (preview.staffId === firstStaffId) {
      return {
        ...preview,
        staffId: second.staffId,
        staffName: second.staffName,
      };
    }
    if (preview.staffId === secondStaffId) {
      return {
        ...preview,
        staffId: first.staffId,
        staffName: first.staffName,
      };
    }
    return preview;
  });
}

/** Swap an owner id through the same two-person exchange. */
export function swapAssignmentOwnerId(
  ownerId: string,
  firstStaffId: string,
  secondStaffId: string,
): string {
  if (ownerId === firstStaffId) return secondStaffId;
  if (ownerId === secondStaffId) return firstStaffId;
  return ownerId;
}
