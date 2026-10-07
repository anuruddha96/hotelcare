import { GOZSDU_ROOM_OVERRIDE_KEY } from '@/lib/gozsduRoomBucketOverride';

export type RoomCleaningType = 'checkout' | 'daily';
export type RoomTypeNotice = {
  date: string;
  at: string;
  from: RoomCleaningType;
  to: RoomCleaningType;
  by: string;
  message: string;
  serviceLabel?: string;
  nightsStayed?: number | null;
};

export type ExtensionServiceSnapshot = {
  reservationId?: string | null;
  guestNightsStayed?: number | null;
  currentNight?: number | null;
  totalNights?: number | null;
  towelChangeRequired?: boolean;
  linenChangeRequired?: boolean;
};

export function extensionServiceLabel(snapshot?: ExtensionServiceSnapshot): string {
  if (snapshot?.linenChangeRequired) return 'Full Room Change';
  if (snapshot?.towelChangeRequired) return 'Towel Change + Daily Cleaning';
  return 'Normal Daily Cleaning';
}

/** Preserve real housekeeping instructions, but show only the latest type-change notice. */
export function upsertRoomTypeNote(previous: string | null, date: string, message: string): string {
  const marker = `[ROOM TYPE ${date}]`;
  const retained = (previous || '').split('\n')
    .filter(line => !/^\[ROOM TYPE \d{4}-\d{2}-\d{2}\]/.test(line)).join('\n').trim();
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
  serviceSnapshot?: ExtensionServiceSnapshot;
}): { metadata: Record<string, unknown>; note: string; notice: RoomTypeNotice } {
  const { metadata, target, date, roomNumber, actorId, actorName, nowIso, gozsduPlan, previousRoomNotes, serviceSnapshot } = params;
  const old = metadata || {};
  const checkout = target === 'checkout';
  const nightsStayed = serviceSnapshot?.guestNightsStayed ?? serviceSnapshot?.currentNight ?? null;
  const serviceLabel = extensionServiceLabel(serviceSnapshot);
  const message = checkout
    ? `Room ${roomNumber} changed from Daily to Checkout cleaning. Confirm departure before entering; wait for Guest Checked Out.`
    : `Guest staying — Daily service. Changed from Checkout to Daily by ${actorName}. Required today: ${serviceLabel}.${nightsStayed != null ? ` Stay so far: ${nightsStayed} night${nightsStayed === 1 ? '' : 's'}.` : ''}`;
  const notice: RoomTypeNotice = {
    date, at: nowIso, from: checkout ? 'daily' : 'checkout', to: target, by: actorName, message,
    serviceLabel: checkout ? undefined : serviceLabel,
    nightsStayed: checkout ? undefined : nightsStayed,
  };
  const next: Record<string, unknown> = {
    ...old,
    manual_checkout: checkout,
    manual_daily: !checkout,
    manual_moved_date: date,
    manual_moved_at: nowIso,
    manual_moved_by: actorId,
    roomTypeChangeNotice: notice,
    ...(checkout ? {} : {
      extensionServiceSnapshot: {
        capturedAt: nowIso,
        reservationId: serviceSnapshot?.reservationId ?? old.reservationId ?? null,
        guestNightsStayed: serviceSnapshot?.guestNightsStayed ?? null,
        currentNight: serviceSnapshot?.currentNight ?? old.currentNight ?? null,
        totalNights: serviceSnapshot?.totalNights ?? old.totalNights ?? null,
        towelChangeRequired: serviceSnapshot?.towelChangeRequired === true,
        linenChangeRequired: serviceSnapshot?.linenChangeRequired === true,
      },
    }),
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
        reason: checkout ? 'Manually changed from Daily to Checkout' : `Manager confirmed guest staying; ${serviceLabel}`,
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
