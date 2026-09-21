import { GOZSDU_ROOM_OVERRIDE_KEY } from '@/lib/gozsduRoomBucketOverride';

export type RoomCleaningType = 'checkout' | 'daily';
export type RoomTypeNotice = {
  date: string;
  at: string;
  from: RoomCleaningType;
  to: RoomCleaningType;
  by: string;
  message: string;
};

/** Keep prior housekeeping instructions intact and replace only today's own notice. */
export function upsertRoomTypeNote(previous: string | null, date: string, message: string): string {
  const marker = `[ROOM TYPE ${date}]`;
  const retained = (previous || '').split('\n').filter(line => !line.startsWith(marker)).join('\n').trim();
  return [retained, `${marker} ${message}`].filter(Boolean).join('\n');
}

/** This changes HotelCare's cleaning plan, NEVER a Previo reservation or departure. */
export function buildRoomTypeTransition(params: {
  metadata: Record<string, unknown> | null;
  target: RoomCleaningType;
  date: string;
  roomNumber: string;
  actorId: string;
  actorName: string;
  nowIso: string;
  gozsduPlan?: { bucket: 'checkout' | 'service' | 'other'; service: 'none' | 'towel_change' | 'change_room' };
  previousRoomNotes: string | null;
}): { metadata: Record<string, unknown>; note: string; notice: RoomTypeNotice } {
  const { metadata, target, date, roomNumber, actorId, actorName, nowIso, gozsduPlan, previousRoomNotes } = params;
  const old = metadata || {};
  const checkout = target === 'checkout';
  const message = checkout
    ? `Room ${roomNumber} changed from Daily to Checkout cleaning. Confirm departure with reception before entering; wait for Ready to Clean.`
    : `Room ${roomNumber} changed from Checkout to Daily cleaning. Possible stay extension: reception must verify the reservation. Follow this hotel's towel/linen service rules.`;
  const notice: RoomTypeNotice = {
    date, at: nowIso, from: checkout ? 'daily' : 'checkout', to: target, by: actorName, message,
  };
  const next: Record<string, unknown> = {
    ...old,
    manual_checkout: checkout,
    manual_daily: !checkout,
    manual_moved_date: date,
    manual_moved_at: nowIso,
    manual_moved_by: actorId,
    roomTypeChangeNotice: notice,
    ...(checkout
      ? { manual_checkout_at: nowIso, manual_checkout_by: actorId, manualReadyToCleanAt: null, manualReadyToCleanBy: null }
      : { manual_daily_at: nowIso, manual_daily_by: actorId, scheduledDepartureToday: false, departureTime: null, checkedOutToday: false }),
  };
  if (gozsduPlan) {
    const overrides = old[GOZSDU_ROOM_OVERRIDE_KEY];
    const prior = overrides && typeof overrides === 'object' && !Array.isArray(overrides)
      ? overrides as Record<string, unknown> : {};
    next[GOZSDU_ROOM_OVERRIDE_KEY] = {
      ...prior,
      [date]: {
        date,
        bucket: gozsduPlan.bucket,
        service: gozsduPlan.service,
        reason: checkout ? 'Manually changed from Daily to Checkout' : 'Possible stay extension; verify with reception',
        changedAt: nowIso,
        changedBy: actorId,
      },
    };
  }
  return {
    metadata: next,
    note: upsertRoomTypeNote(previousRoomNotes, date, message),
    notice,
  };
}
