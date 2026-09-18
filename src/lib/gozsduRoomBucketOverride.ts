export type GozsduRoomBucket = 'checkout' | 'service' | 'other';
export type GozsduRoomOverride = { date: string; bucket: GozsduRoomBucket; service: 'none' | 'towel_change' | 'change_room'; reason: string; changedBy: string; changedAt: string };
export const GOZSDU_ROOM_OVERRIDE_KEY = 'hotelcareHousekeepingOverride';

export function readGozsduRoomOverride(metadata: unknown, date: string): GozsduRoomOverride | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>)[GOZSDU_ROOM_OVERRIDE_KEY] as GozsduRoomOverride | undefined;
  if (!value || value.date !== date || !['checkout', 'service', 'other'].includes(value.bucket)) return null;
  if (value.bucket === 'service' && !['towel_change', 'change_room'].includes(value.service)) return null;
  if (value.bucket !== 'service' && value.service !== 'none') return null;
  return value;
}
