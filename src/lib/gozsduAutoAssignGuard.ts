// Pure guard for Gozsdu's date-scoped Laundryner duty. Never changes another
// property's assignment policy. The database remains the authorization boundary.
type Preview = { staffId: string; rooms: readonly unknown[] };

export function gozsduCanReviewAssignment(
  previews: readonly Preview[],
  selectedCleaningIds: ReadonlySet<string>,
  isLaundryner: (staffId: string) => boolean,
): boolean {
  return selectedCleaningIds.size > 0 && previews.length > 0
    && previews.some(preview => preview.rooms.length > 0)
    && previews.every(preview => selectedCleaningIds.has(preview.staffId) && !isLaundryner(preview.staffId));
}

export function gozsduPreviewCoversWork(
  previews: readonly Preview[],
  expectedRoomCount: number,
  selectedCleaningIds: ReadonlySet<string>,
  isLaundryner: (staffId: string) => boolean,
): boolean {
  return expectedRoomCount > 0
    && gozsduCanReviewAssignment(previews, selectedCleaningIds, isLaundryner)
    && previews.reduce((total, preview) => total + preview.rooms.length, 0) === expectedRoomCount;
}
