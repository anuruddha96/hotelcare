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
  managerConfirmed?: boolean;
};

export type RoomTypeServiceSnapshot = {
  reservationId?: string | null;
  guestFingerprint?: string | null;
  guestIdentityStrength?: 'strong' | 'name' | 'none' | null;
  arrivalDate?: string | null;
  departureDate?: string | null;
  guestNightsStayed?: number | null;
  currentNight?: number | null;
  totalNights?: number | null;
  towelChangeRequired?: boolean | null;
  linenChangeRequired?: boolean | null;
};

function positive(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function roomServiceLabel(input: {
  towelChangeRequired?: boolean | null;
  linenChangeRequired?: boolean | null;
  routineDailyCleaning?: boolean;
}): string {
  const routineDailyCleaning = input.routineDailyCleaning !== false;
  if (input.linenChangeRequired) return 'Full Room Change';
  if (input.towelChangeRequired) return routineDailyCleaning ? 'Towel Change + Daily Cleaning' : 'Towel Change';
  return routineDailyCleaning ? 'Normal Daily Cleaning' : 'No scheduled stayover cleaning';
}

/** Remove old implementation/audit lines without touching human instructions. */
export function stripRoomTypeSystemNotes(previous: string | null | undefined): string | null {
  const retained = String(previous || '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*\[ROOM TYPE \d{4}-\d{2}-\d{2}\]/.test(line))
    .join('\n')
    .trim();
  return retained || null;
}

/**
 * Legacy helper retained for callers compiled against the previous API.
 * New room-type changes should store structured metadata/audit events instead
 * of adding system instructions to the human note field.
 */
export function upsertRoomTypeNote(previous: string | null, _date: string, _message: string): string {
  return stripRoomTypeSystemNotes(previous) || '';
}

export function buildDirectRoomTypeNotice(input: {
  date: string;
  at: string;
  from: RoomCleaningType;
  to: RoomCleaningType;
  by: string;
  serviceLabel?: string | null;
  nightsStayed?: number | null;
  continuousStayEnabled?: boolean;
}): RoomTypeNotice {
  const { date, at, from, to, by } = input;
  if (to === 'checkout') {
    return {
      date, at, from, to, by,
      managerConfirmed: true,
      message: `Checkout cleaning confirmed by ${by}. Wait for Guest Checked Out before entering.`,
    };
  }
  const serviceLabel = input.serviceLabel || 'Daily Cleaning';
  const nights = positive(input.nightsStayed);
  if (input.continuousStayEnabled === false) {
    return {
      date, at, from, to, by,
      serviceLabel,
      nightsStayed: null,
      managerConfirmed: true,
      message: `Daily cleaning confirmed by ${by}. Required today: ${serviceLabel}.`,
    };
  }
  return {
    date, at, from, to, by,
    serviceLabel,
    nightsStayed: nights || null,
    managerConfirmed: true,
    message: `Guest staying — Daily service. Changed from Checkout to Daily by ${by}. Required today: ${serviceLabel}.${nights ? ` Stay so far: ${nights} night${nights === 1 ? '' : 's'}.` : ''}`,
  };
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
  serviceSnapshot?: RoomTypeServiceSnapshot;
  continuousStayEnabled?: boolean;
  routineDailyCleaning?: boolean;
}): { metadata: Record<string, unknown>; note: string | null; notice: RoomTypeNotice; continuedNight: number | null } {
  const {
    metadata, target, date, actorId, actorName, nowIso,
    gozsduPlan, previousRoomNotes, serviceSnapshot,
    continuousStayEnabled = true,
    routineDailyCleaning = true,
  } = params;
  const old = metadata || {};
  const checkout = target === 'checkout';
  const priorSnapshotRaw = old.extensionServiceSnapshot;
  const priorSnapshot = priorSnapshotRaw && typeof priorSnapshotRaw === 'object' && !Array.isArray(priorSnapshotRaw)
    ? priorSnapshotRaw as Record<string, unknown>
    : null;
  const reuseSameDaySnapshot = priorSnapshot?.managerConfirmedDate === date;

  // Re-opening the same manager decision today must be idempotent. Once a
  // Checkout -> Daily bridge captured the completed checkout segment, use that
  // original segment again instead of incrementing the already-continued night.
  const priorCurrent = reuseSameDaySnapshot
    ? Math.max(
        positive(priorSnapshot?.guestNightsStayed),
        positive(priorSnapshot?.currentNight),
        positive(priorSnapshot?.totalNights),
      )
    : Math.max(
        positive(serviceSnapshot?.guestNightsStayed),
        positive(serviceSnapshot?.currentNight),
        positive(old.currentNight),
        // On a real checkout reservation the PMS may omit "Night / Total" from
        // today's housekeeping view even though the reservation total remains
        // available. For Checkout -> Daily, total nights are therefore a safe
        // fallback for the completed segment before the extension starts.
        target === 'daily' ? positive(serviceSnapshot?.totalNights) : 0,
        target === 'daily' ? positive(old.totalNights) : 0,
      );
  const priorTotal = reuseSameDaySnapshot
    ? Math.max(positive(priorSnapshot?.totalNights), priorCurrent)
    : Math.max(
        positive(serviceSnapshot?.totalNights),
        positive(old.totalNights),
        priorCurrent,
      );
  // A checkout changed to Daily means the guest will occupy the room for one
  // more night than the completed checkout segment. This temporary open-ended
  // counter is replaced by the real continuous total as soon as Previo sends
  // the extension reservation.
  const continuedNight = continuousStayEnabled && !checkout && priorCurrent
    ? priorCurrent + 1
    : null;
  const provisionalTotal = continuedNight
    ? Math.max(continuedNight, priorTotal + 1)
    : priorTotal || null;

  const notice = buildDirectRoomTypeNotice({
    date,
    at: nowIso,
    from: checkout ? 'daily' : 'checkout',
    to: target,
    by: actorName,
    serviceLabel: checkout ? null : roomServiceLabel({
      towelChangeRequired: serviceSnapshot?.towelChangeRequired,
      linenChangeRequired: serviceSnapshot?.linenChangeRequired,
      routineDailyCleaning,
    }),
    nightsStayed: continuousStayEnabled ? (continuedNight ?? priorCurrent) : null,
    continuousStayEnabled,
  });

  const next: Record<string, unknown> = {
    ...old,
    manual_checkout: checkout,
    manual_daily: !checkout,
    manual_moved_date: date,
    manual_moved_at: nowIso,
    manual_moved_by: actorId,
    roomTypeChangeNotice: notice,
    ...(checkout
      ? {
          manual_checkout_at: nowIso,
          manual_checkout_by: actorId,
          manualReadyToCleanAt: null,
          manualReadyToCleanBy: null,
        }
      : {
          manual_daily_at: nowIso,
          manual_daily_by: actorId,
          scheduledDepartureToday: false,
          scheduledDepartureTomorrow: false,
          departureTime: null,
          checkedOutToday: false,
          arrivalToday: false,
          notArrived: false,
          occupiedToday: true,
          stayThroughToday: true,
          ...(continuedNight ? { currentNight: continuedNight } : {}),
          ...(continuousStayEnabled && provisionalTotal ? { totalNights: provisionalTotal } : {}),
          ...(continuousStayEnabled ? { extensionServiceSnapshot: reuseSameDaySnapshot
            ? {
                ...priorSnapshot,
                capturedAt: priorSnapshot?.capturedAt ?? nowIso,
                managerConfirmedDate: date,
              }
            : {
                capturedAt: nowIso,
                managerConfirmedDate: date,
                reservationId: serviceSnapshot?.reservationId ?? old.reservationId ?? null,
                guestFingerprint: serviceSnapshot?.guestFingerprint ?? old.guestFingerprint ?? null,
                guestIdentityStrength: serviceSnapshot?.guestIdentityStrength ?? old.guestIdentityStrength ?? 'none',
                arrivalDate: serviceSnapshot?.arrivalDate ?? old.arrivalDate ?? null,
                // The source room is a checkout bucket, so today's business date is
                // a reliable bridge date even when the PMS omitted DepartureDate.
                departureDate: serviceSnapshot?.departureDate ?? old.departureDate ?? date,
                guestNightsStayed: positive(serviceSnapshot?.guestNightsStayed) || priorCurrent || null,
                currentNight: positive(serviceSnapshot?.currentNight) || priorCurrent || null,
                totalNights: positive(serviceSnapshot?.totalNights) || priorTotal || null,
                towelChangeRequired: serviceSnapshot?.towelChangeRequired === true,
                linenChangeRequired: serviceSnapshot?.linenChangeRequired === true,
              } } : {}),
        }),
  };

  if (gozsduPlan) {
    const overrides = old[GOZSDU_ROOM_OVERRIDE_KEY];
    const prior = overrides && typeof overrides === 'object' && !Array.isArray(overrides)
      ? overrides as Record<string, unknown>
      : {};
    next[GOZSDU_ROOM_OVERRIDE_KEY] = {
      ...prior,
      [date]: {
        date,
        bucket: gozsduPlan.bucket,
        service: gozsduPlan.service,
        reason: checkout
          ? 'Manager changed Daily to Checkout'
          : 'Manager confirmed guest staying',
        changedAt: nowIso,
        changedBy: actorId,
      },
    };
  }

  return {
    metadata: next,
    // Human notes stay human. Also clean up legacy technical lines when this
    // room is touched so Room 117-type confusion disappears immediately.
    note: stripRoomTypeSystemNotes(previousRoomNotes),
    notice,
    continuedNight,
  };
}
