export type GozsduTransferCounts = {
  plan_rooms: number;
  plan_areas: number;
  property_areas: number;
  live_rooms: number;
  live_areas: number;
};

export type GozsduTransferReplacement = {
  id: string;
  name: string;
  nickname: string | null;
};

export type GozsduTransferPreview = {
  token: string;
  blocked_started_or_completed: number;
  release_locked: boolean;
  already_laundryner: boolean;
  counts: GozsduTransferCounts;
  replacement_staff: GozsduTransferReplacement[];
  work: {
    employee: string;
    work_date: string;
    hotel: string;
    plan_rooms: Array<{ id: string; room: string }>;
    plan_areas: Array<{ id: string; name: string }>;
    property_areas: Array<{ id: string; name: string }>;
    live_rooms: Array<{ id: string; room: string }>;
    live_areas: Array<{ id: string; name: string }>;
  };
};

export const transferRoomCount = (preview: GozsduTransferPreview): number =>
  preview.counts.plan_rooms + preview.counts.live_rooms;

export const transferAreaCount = (preview: GozsduTransferPreview): number =>
  preview.counts.plan_areas + preview.counts.property_areas + preview.counts.live_areas;

/** Never offer an unsafe confirmation just because a button was tapped. */
export function canConfirmGozsduLaundryTransfer(
  preview: GozsduTransferPreview | null,
  replacementId: string,
  explicitlyConfirmed: boolean,
): boolean {
  if (!preview || !explicitlyConfirmed || !/^[a-f0-9]{32}$/i.test(preview.token)) return false;
  if (preview.work.hotel !== 'gozsdu-court' || preview.release_locked
    || preview.already_laundryner || preview.blocked_started_or_completed > 0) return false;
  if (replacementId === preview.work.employee || !preview.replacement_staff.some(s => s.id === replacementId)) return false;
  return transferRoomCount(preview) + transferAreaCount(preview) > 0;
}
