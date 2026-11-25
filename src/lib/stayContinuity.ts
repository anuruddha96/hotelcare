export type GuestIdentityStrength = 'strong' | 'name' | 'none';

export type ContinuousStaySegment = {
  reservationId: string | null;
  arrivalDate: string;
  departureDate: string;
  nights: number;
};

export type ContinuousStay = {
  originalArrivalDate: string | null;
  finalDepartureDate: string | null;
  currentNight: number;
  totalNights: number;
  guestFingerprint: string | null;
  guestIdentityStrength: GuestIdentityStrength;
  reservationIds: string[];
  segments: ContinuousStaySegment[];
  linkedBy: 'previo_chain' | 'manager_confirmed' | 'pms_snapshot';
  confidence: 'strong' | 'probable' | 'manager_confirmed';
  updatedAt: string;
};

export type ExtensionServiceSnapshot = {
  capturedAt?: string | null;
  managerConfirmedDate?: string | null;
  reservationId?: string | null;
  guestFingerprint?: string | null;
  guestIdentityStrength?: GuestIdentityStrength | null;
  arrivalDate?: string | null;
  departureDate?: string | null;
  guestNightsStayed?: number | null;
  currentNight?: number | null;
  totalNights?: number | null;
};

export type IncomingStayRow = {
  ReservationId?: unknown;
  GuestFingerprint?: unknown;
  GuestIdentityStrength?: unknown;
  ArrivalDate?: unknown;
  DepartureDate?: unknown;
  CurrentNight?: unknown;
  TotalNights?: unknown;
  ContinuousStayOriginalArrival?: unknown;
  ContinuousStayFinalDeparture?: unknown;
  ContinuousStayCurrentNight?: unknown;
  ContinuousStayTotalNights?: unknown;
  ContinuousStayReservationIds?: unknown;
  ContinuousStaySegments?: unknown;
  ContinuousStaySegmentCount?: unknown;
  ContinuousStayConfidence?: unknown;
  ExtensionLinked?: unknown;
  SameDayTurnover?: unknown;
  SameDayTurnoverConfidence?: unknown;
  NextArrivalReservationId?: unknown;
  NextArrivalGuestFingerprint?: unknown;
  NextArrivalGuestIdentityStrength?: unknown;
  NextArrivalArrivalDate?: unknown;
  NextArrivalDepartureDate?: unknown;
};

export type ReconciledStay = {
  currentNight: number;
  totalNights: number;
  continuousStay: ContinuousStay | null;
  linkedExtension: boolean;
  resetForDifferentGuest: boolean;
  managerConfirmedContinuation: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function iso(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return ISO_DATE.test(text) ? text : null;
}

function positive(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function stringOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function identityStrength(value: unknown): GuestIdentityStrength {
  return value === 'strong' || value === 'name' ? value : 'none';
}

function asReservationIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(stringOrNull).filter((item): item is string => !!item)));
}

function dayDiff(from: string | null, to: string | null): number {
  if (!from || !to) return 0;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function parseSegments(value: unknown): ContinuousStaySegment[] {
  if (!Array.isArray(value)) return [];
  const out: ContinuousStaySegment[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;
    const arrivalDate = iso(record.arrivalDate ?? record.arrival_date);
    const departureDate = iso(record.departureDate ?? record.departure_date);
    if (!arrivalDate || !departureDate || departureDate <= arrivalDate) continue;
    out.push({
      reservationId: stringOrNull(record.reservationId ?? record.reservation_id),
      arrivalDate,
      departureDate,
      nights: positive(record.nights) || dayDiff(arrivalDate, departureDate),
    });
  }
  return out;
}

function parseStoredContinuousStay(value: unknown): ContinuousStay | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const currentNight = positive(raw.currentNight);
  const totalNights = positive(raw.totalNights);
  if (!currentNight || !totalNights) return null;
  const linkedBy = raw.linkedBy === 'manager_confirmed' || raw.linkedBy === 'previo_chain'
    ? raw.linkedBy
    : 'pms_snapshot';
  const confidence = raw.confidence === 'strong' || raw.confidence === 'manager_confirmed'
    ? raw.confidence
    : 'probable';
  return {
    originalArrivalDate: iso(raw.originalArrivalDate),
    finalDepartureDate: iso(raw.finalDepartureDate),
    currentNight,
    totalNights: Math.max(totalNights, currentNight),
    guestFingerprint: stringOrNull(raw.guestFingerprint),
    guestIdentityStrength: identityStrength(raw.guestIdentityStrength),
    reservationIds: asReservationIds(raw.reservationIds),
    segments: parseSegments(raw.segments),
    linkedBy,
    confidence,
    updatedAt: stringOrNull(raw.updatedAt) || new Date(0).toISOString(),
  };
}

function edgeContinuousStay(row: IncomingStayRow, nowIso: string): ContinuousStay | null {
  const currentNight = positive(row.ContinuousStayCurrentNight);
  const totalNights = positive(row.ContinuousStayTotalNights);
  if (!currentNight || !totalNights) return null;

  const segmentCount = positive(row.ContinuousStaySegmentCount);
  const confidence = row.ContinuousStayConfidence === 'strong' ? 'strong' : 'probable';
  return {
    originalArrivalDate: iso(row.ContinuousStayOriginalArrival) ?? iso(row.ArrivalDate),
    finalDepartureDate: iso(row.ContinuousStayFinalDeparture) ?? iso(row.DepartureDate),
    currentNight,
    totalNights: Math.max(totalNights, currentNight),
    guestFingerprint: stringOrNull(row.GuestFingerprint),
    guestIdentityStrength: identityStrength(row.GuestIdentityStrength),
    reservationIds: asReservationIds(row.ContinuousStayReservationIds),
    segments: parseSegments(row.ContinuousStaySegments),
    linkedBy: segmentCount > 1 || row.ExtensionLinked === true ? 'previo_chain' : 'pms_snapshot',
    confidence,
    updatedAt: nowIso,
  };
}

function hasStrongConflict(previousFingerprint: string | null, previousStrength: GuestIdentityStrength, nextFingerprint: string | null, nextStrength: GuestIdentityStrength): boolean {
  return previousStrength === 'strong'
    && nextStrength === 'strong'
    && !!previousFingerprint
    && !!nextFingerprint
    && previousFingerprint !== nextFingerprint;
}

/**
 * Reconcile reservation-local Previo night counters with HotelCare's room-local
 * continuity state. Same-room manager-confirmed extensions may bridge a new
 * reservation ID, but a strong guest-identity conflict or a date gap never does.
 */
export function reconcileContinuousStay(input: {
  row: IncomingStayRow;
  existingMetadata?: Record<string, unknown> | null;
  storedGuestNights?: number | null;
  manualDailyOverride: boolean;
  businessDate: string;
  nowIso: string;
}): ReconciledStay {
  const { row, existingMetadata, storedGuestNights, manualDailyOverride, businessDate, nowIso } = input;
  const localCurrent = positive(row.CurrentNight);
  const localTotal = positive(row.TotalNights);
  const edge = edgeContinuousStay(row, nowIso);

  const stored = parseStoredContinuousStay(existingMetadata?.continuousStay);
  const snapshotRaw = existingMetadata?.extensionServiceSnapshot;
  const snapshot = snapshotRaw && typeof snapshotRaw === 'object' && !Array.isArray(snapshotRaw)
    ? snapshotRaw as ExtensionServiceSnapshot
    : null;

  const incomingReservationId = stringOrNull(row.ReservationId);
  const incomingFingerprint = stringOrNull(row.GuestFingerprint);
  const incomingStrength = identityStrength(row.GuestIdentityStrength);
  const incomingArrival = iso(row.ArrivalDate);
  const incomingDeparture = iso(row.DepartureDate);

  const previousFingerprint = stringOrNull(snapshot?.guestFingerprint) ?? stored?.guestFingerprint ?? null;
  const previousStrength = identityStrength(snapshot?.guestIdentityStrength ?? stored?.guestIdentityStrength);
  const strongConflict = hasStrongConflict(
    previousFingerprint,
    previousStrength,
    incomingFingerprint,
    incomingStrength,
  );
  const definitiveTurnover = row.SameDayTurnover === true
    && row.SameDayTurnoverConfidence === 'strong';

  // A proven different guest always ends the previous continuity. The edge
  // intentionally keeps the old checkout reservation as the housekeeping
  // source for same-day turnover, so retain its night facts while clearing the
  // manager extension marker.
  if (strongConflict || definitiveTurnover) {
    if (edge) {
      return {
        currentNight: edge.currentNight,
        totalNights: edge.totalNights,
        continuousStay: edge,
        linkedExtension: false,
        resetForDifferentGuest: true,
        managerConfirmedContinuation: false,
      };
    }
    const single = localCurrent && localTotal ? {
      originalArrivalDate: incomingArrival,
      finalDepartureDate: incomingDeparture,
      currentNight: localCurrent,
      totalNights: Math.max(localCurrent, localTotal),
      guestFingerprint: incomingFingerprint,
      guestIdentityStrength: incomingStrength,
      reservationIds: incomingReservationId ? [incomingReservationId] : [],
      segments: incomingArrival && incomingDeparture ? [{
        reservationId: incomingReservationId,
        arrivalDate: incomingArrival,
        departureDate: incomingDeparture,
        nights: dayDiff(incomingArrival, incomingDeparture),
      }] : [],
      linkedBy: 'pms_snapshot' as const,
      confidence: 'strong' as const,
      updatedAt: nowIso,
    } : null;
    return {
      currentNight: localCurrent,
      totalNights: localTotal,
      continuousStay: single,
      linkedExtension: false,
      resetForDifferentGuest: true,
      managerConfirmedContinuation: false,
    };
  }

  // A multi-segment chain was proven server-side from contiguous same-room,
  // same-guest reservations. This is stronger than any browser-local fallback.
  if (edge?.linkedBy === 'previo_chain') {
    return {
      currentNight: edge.currentNight,
      totalNights: edge.totalNights,
      continuousStay: edge,
      linkedExtension: true,
      resetForDifferentGuest: false,
      managerConfirmedContinuation: false,
    };
  }

  const snapshotDate = iso(snapshot?.managerConfirmedDate);
  const previousDeparture = iso(snapshot?.departureDate) ?? snapshotDate;

  // If the edge kept checkout cleaning because the new reservation identity
  // was ambiguous (missing id / spelling change), an explicit manager
  // Checkout -> Daily decision is the authority that safely bridges it.
  const useCompetingArrival = manualDailyOverride
    && row.SameDayTurnover === true
    && row.SameDayTurnoverConfidence === 'ambiguous'
    && !!iso(row.NextArrivalArrivalDate);

  const bridgeReservationId = useCompetingArrival
    ? stringOrNull(row.NextArrivalReservationId)
    : incomingReservationId;
  const bridgeFingerprint = useCompetingArrival
    ? stringOrNull(row.NextArrivalGuestFingerprint)
    : incomingFingerprint;
  const bridgeStrength = useCompetingArrival
    ? identityStrength(row.NextArrivalGuestIdentityStrength)
    : incomingStrength;
  const bridgeArrival = useCompetingArrival
    ? iso(row.NextArrivalArrivalDate)
    : incomingArrival;
  const bridgeDeparture = useCompetingArrival
    ? iso(row.NextArrivalDepartureDate)
    : incomingDeparture;
  const bridgeCurrent = useCompetingArrival ? 1 : localCurrent;
  const bridgeTotal = useCompetingArrival
    ? dayDiff(bridgeArrival, bridgeDeparture)
    : localTotal;

  const managerBridge = manualDailyOverride
    && !!snapshot
    && snapshotDate === businessDate
    && !!bridgeArrival
    && previousDeparture === bridgeArrival;

  if (managerBridge) {
    const previousNights = Math.max(
      positive(snapshot?.guestNightsStayed),
      positive(snapshot?.currentNight),
      positive(snapshot?.totalNights),
      positive(storedGuestNights),
    );
    const incomingNights = bridgeTotal || dayDiff(bridgeArrival, bridgeDeparture);
    const currentNight = previousNights + Math.max(1, bridgeCurrent || 1);
    const totalNights = Math.max(currentNight, previousNights + Math.max(1, incomingNights));

    const reservationIds = Array.from(new Set([
      stringOrNull(snapshot?.reservationId),
      ...(stored?.reservationIds || []),
      bridgeReservationId,
    ].filter((item): item is string => !!item)));

    const segments: ContinuousStaySegment[] = [...(stored?.segments || [])];
    const priorArrival = iso(snapshot?.arrivalDate) ?? stored?.originalArrivalDate ?? null;
    if (priorArrival && previousDeparture && previousDeparture > priorArrival) {
      const previousReservationId = stringOrNull(snapshot?.reservationId);
      if (!segments.some(segment =>
        segment.arrivalDate === priorArrival
        && segment.departureDate === previousDeparture
        && segment.reservationId === previousReservationId
      )) {
        segments.push({
          reservationId: previousReservationId,
          arrivalDate: priorArrival,
          departureDate: previousDeparture,
          nights: previousNights || dayDiff(priorArrival, previousDeparture),
        });
      }
    }
    if (bridgeArrival && bridgeDeparture && bridgeDeparture > bridgeArrival) {
      if (!segments.some(segment =>
        segment.arrivalDate === bridgeArrival
        && segment.departureDate === bridgeDeparture
        && segment.reservationId === bridgeReservationId
      )) {
        segments.push({
          reservationId: bridgeReservationId,
          arrivalDate: bridgeArrival,
          departureDate: bridgeDeparture,
          nights: incomingNights || dayDiff(bridgeArrival, bridgeDeparture),
        });
      }
    }

    return {
      currentNight,
      totalNights,
      continuousStay: {
        originalArrivalDate: priorArrival ?? bridgeArrival,
        finalDepartureDate: bridgeDeparture,
        currentNight,
        totalNights,
        guestFingerprint: bridgeFingerprint ?? previousFingerprint,
        guestIdentityStrength: bridgeStrength !== 'none' ? bridgeStrength : previousStrength,
        reservationIds,
        segments,
        linkedBy: 'manager_confirmed',
        confidence: 'manager_confirmed',
        updatedAt: nowIso,
      },
      linkedExtension: true,
      resetForDifferentGuest: false,
      managerConfirmedContinuation: true,
    };
  }

  // While the manager-confirmed stay is waiting for the replacement Previo
  // reservation, advance one continuous stay-night rather than reverting to the
  // old checkout reservation's final-night counter.
  if (manualDailyOverride && snapshotDate === businessDate && snapshot) {
    // The snapshot stores the completed checkout segment before the manager
    // confirmed the guest is staying. Repeated PMS refreshes must be
    // idempotent: guest_nights_stayed / stored continuousStay may already hold
    // the provisional +1 night, so never add another night on top of them.
    // If a previously linked extension disappeared/cancelled, its old total
    // must also be pruned rather than kept as an 8-night stale plan.
    const snapshotCompletedNights = Math.max(
      positive(snapshot.guestNightsStayed),
      positive(snapshot.currentNight),
      positive(snapshot.totalNights),
    );
    const persistedCurrentNight = Math.max(
      positive(storedGuestNights),
      stored?.currentNight || 0,
    );
    const currentNight = snapshotCompletedNights
      ? snapshotCompletedNights + 1
      : Math.max(1, persistedCurrentNight);
    const totalNights = currentNight;
    return {
      currentNight,
      totalNights,
      continuousStay: {
        originalArrivalDate: iso(snapshot.arrivalDate) ?? stored?.originalArrivalDate ?? null,
        finalDepartureDate: stored?.finalDepartureDate ?? null,
        currentNight,
        totalNights,
        guestFingerprint: previousFingerprint,
        guestIdentityStrength: previousStrength,
        // If a previously linked Previo extension disappears (cancelled,
        // deleted or replaced), do not keep that reservation in the active
        // continuity merely because it existed in an earlier sync. Keep the
        // manager-confirmed provisional stay anchored to the original checkout
        // segment until a new contiguous reservation is observed.
        reservationIds: Array.from(new Set([
          ...(edge?.reservationIds || []),
          stringOrNull(snapshot.reservationId),
        ].filter((item): item is string => !!item))),
        segments: edge?.segments?.length ? edge.segments : [],
        linkedBy: 'manager_confirmed',
        confidence: 'manager_confirmed',
        updatedAt: nowIso,
      },
      linkedExtension: false,
      resetForDifferentGuest: false,
      managerConfirmedContinuation: true,
    };
  }

  // No manager bridge is active: a single-reservation edge snapshot is the
  // canonical current PMS fact.
  if (edge) {
    return {
      currentNight: edge.currentNight,
      totalNights: edge.totalNights,
      continuousStay: edge,
      linkedExtension: false,
      resetForDifferentGuest: false,
      managerConfirmedContinuation: false,
    };
  }

  if (stored && incomingReservationId && stored.reservationIds.includes(incomingReservationId)) {
    return {
      currentNight: Math.max(localCurrent, stored.currentNight),
      totalNights: Math.max(localTotal, stored.totalNights, localCurrent, stored.currentNight),
      continuousStay: {
        ...stored,
        currentNight: Math.max(localCurrent, stored.currentNight),
        totalNights: Math.max(localTotal, stored.totalNights, localCurrent, stored.currentNight),
        updatedAt: nowIso,
      },
      linkedExtension: stored.reservationIds.length > 1,
      resetForDifferentGuest: false,
      managerConfirmedContinuation: stored.linkedBy === 'manager_confirmed',
    };
  }

  const currentNight = localCurrent || positive(storedGuestNights);
  const totalNights = Math.max(localTotal, currentNight);
  const single: ContinuousStay | null = currentNight && totalNights ? {
    originalArrivalDate: incomingArrival,
    finalDepartureDate: incomingDeparture,
    currentNight,
    totalNights,
    guestFingerprint: incomingFingerprint,
    guestIdentityStrength: incomingStrength,
    reservationIds: incomingReservationId ? [incomingReservationId] : [],
    segments: incomingArrival && incomingDeparture ? [{
      reservationId: incomingReservationId,
      arrivalDate: incomingArrival,
      departureDate: incomingDeparture,
      nights: dayDiff(incomingArrival, incomingDeparture),
    }] : [],
    linkedBy: 'pms_snapshot',
    confidence: incomingStrength === 'strong' ? 'strong' : 'probable',
    updatedAt: nowIso,
  } : null;

  return {
    currentNight,
    totalNights,
    continuousStay: single,
    linkedExtension: false,
    resetForDifferentGuest: false,
    managerConfirmedContinuation: false,
  };
}
