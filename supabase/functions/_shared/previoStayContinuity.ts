export type PrevioGuestIdentityStrength = 'strong' | 'name' | 'none';

export type PrevioStayCandidate = {
  objId: number | null;
  roomName: string;
  reservationId: string | null;
  arrivalDate: string;
  departureDate: string;
  statusId: number;
  guestKeys: string[];
  guestFingerprint: string | null;
  guestIdentityStrength: PrevioGuestIdentityStrength;
};

export type PrevioContinuousStay<T extends PrevioStayCandidate> = {
  effective: T | null;
  segments: T[];
  originalArrivalDate: string | null;
  finalDepartureDate: string | null;
  currentNight: number;
  totalNights: number;
  reservationIds: string[];
  guestFingerprint: string | null;
  guestIdentityStrength: PrevioGuestIdentityStrength;
  confidence: 'strong' | 'probable' | 'single';
  extensionLinked: boolean;
};

const CANCELLED = new Set([7, 8]);
const IN_HOUSE = new Set([3, 5]);

export function normalizePrevioIdentity(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ');
}

/**
 * Stable opaque key for browser-side continuity comparison. Only use this for
 * strong identifiers (PMS guest id, email, phone), never as an authentication
 * or security primitive.
 */
export function opaquePrevioFingerprint(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `pms-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function diffPrevioNights(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function uniqueCandidates<T extends PrevioStayCandidate>(candidates: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const candidate of candidates) {
    if (!candidate.arrivalDate || !candidate.departureDate || candidate.departureDate <= candidate.arrivalDate) continue;
    const identity = candidate.reservationId
      ? `id:${candidate.reservationId}`
      : [
          candidate.objId ?? '',
          candidate.roomName,
          candidate.arrivalDate,
          candidate.departureDate,
          candidate.statusId,
          candidate.guestFingerprint ?? candidate.guestKeys.join('|'),
        ].join('::');
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push(candidate);
  }
  return out;
}

function keySets(candidate: PrevioStayCandidate) {
  const strong = new Set(candidate.guestKeys.filter((key) => key.startsWith('strong:')));
  const name = new Set(candidate.guestKeys.filter((key) => key.startsWith('name:')));
  return { strong, name };
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const key of a) if (b.has(key)) return true;
  return false;
}

/**
 * Strong identifiers are authoritative when both reservations have them.
 * Name matching is a fallback only when at least one segment lacks a strong id.
 */
export function isSamePrevioGuest(a: PrevioStayCandidate, b: PrevioStayCandidate): boolean {
  const left = keySets(a);
  const right = keySets(b);
  if (left.strong.size && right.strong.size) return intersects(left.strong, right.strong);
  if (left.name.size && right.name.size) return intersects(left.name, right.name);
  return false;
}

function chooseEffective<T extends PrevioStayCandidate>(candidates: T[], today: string): T | null {
  const eligible = candidates.filter((candidate) => !CANCELLED.has(candidate.statusId));
  const active = eligible.filter((candidate) =>
    candidate.arrivalDate <= today && candidate.departureDate > today,
  );
  const checkouts = eligible.filter((candidate) => candidate.departureDate === today);

  const mostSpecific = (list: T[]) => [...list].sort((a, b) => {
    const inHouseDiff = Number(IN_HOUSE.has(b.statusId)) - Number(IN_HOUSE.has(a.statusId));
    if (inHouseDiff) return inHouseDiff;
    const start = b.arrivalDate.localeCompare(a.arrivalDate);
    if (start) return start;
    return a.departureDate.localeCompare(b.departureDate);
  })[0] ?? null;

  // Same-day turnover and same-guest extension both produce two reservations
  // for one room. Only let the new reservation supersede checkout cleaning
  // when identity proves they are one continuous guest stay. Otherwise the old
  // guest's checkout clean must still happen before the new arrival.
  const extensionActive = active.filter((candidate) =>
    checkouts.some((checkout) =>
      checkout.departureDate === candidate.arrivalDate
      && isSamePrevioGuest(checkout, candidate),
    ),
  );
  if (extensionActive.length) return mostSpecific(extensionActive);
  if (checkouts.length) return mostSpecific(checkouts);

  const arrivals = active.filter((candidate) => candidate.arrivalDate === today);
  return mostSpecific(arrivals) ?? mostSpecific(active);
}

function bestPrevious<T extends PrevioStayCandidate>(all: T[], current: T, used: Set<T>): T | null {
  const matches = all.filter((candidate) =>
    !used.has(candidate)
    && !CANCELLED.has(candidate.statusId)
    && candidate.departureDate === current.arrivalDate
    && isSamePrevioGuest(candidate, current),
  );
  return [...matches].sort((a, b) => b.arrivalDate.localeCompare(a.arrivalDate))[0] ?? null;
}

function bestNext<T extends PrevioStayCandidate>(all: T[], current: T, used: Set<T>): T | null {
  const matches = all.filter((candidate) =>
    !used.has(candidate)
    && !CANCELLED.has(candidate.statusId)
    && candidate.arrivalDate === current.departureDate
    && isSamePrevioGuest(candidate, current),
  );
  return [...matches].sort((a, b) => a.departureDate.localeCompare(b.departureDate))[0] ?? null;
}

/**
 * Link only contiguous same-room/same-guest reservations. The caller scopes the
 * candidates to one physical room. Same-day turnover to a different guest,
 * room changes, no-shows/cancellations and date gaps therefore remain separate.
 */
export function resolvePrevioContinuousStay<T extends PrevioStayCandidate>(
  inputCandidates: T[],
  today: string,
): PrevioContinuousStay<T> {
  const candidates = uniqueCandidates(inputCandidates);
  const effective = chooseEffective(candidates, today);
  if (!effective) {
    return {
      effective: null,
      segments: [],
      originalArrivalDate: null,
      finalDepartureDate: null,
      currentNight: 0,
      totalNights: 0,
      reservationIds: [],
      guestFingerprint: null,
      guestIdentityStrength: 'none',
      confidence: 'single',
      extensionLinked: false,
    };
  }

  const used = new Set<T>([effective]);
  const before: T[] = [];
  let cursor = effective;
  while (true) {
    const previous = bestPrevious(candidates, cursor, used);
    if (!previous) break;
    before.unshift(previous);
    used.add(previous);
    cursor = previous;
  }

  const after: T[] = [];
  cursor = effective;
  while (true) {
    const next = bestNext(candidates, cursor, used);
    if (!next) break;
    after.push(next);
    used.add(next);
    cursor = next;
  }

  const segments = [...before, effective, ...after];
  const originalArrivalDate = segments[0]?.arrivalDate ?? effective.arrivalDate;
  const finalDepartureDate = segments.at(-1)?.departureDate ?? effective.departureDate;
  const totalNights = segments.reduce(
    (sum, segment) => sum + diffPrevioNights(segment.arrivalDate, segment.departureDate),
    0,
  );
  const currentNight = today < finalDepartureDate
    ? Math.min(totalNights, diffPrevioNights(originalArrivalDate, today) + 1)
    : totalNights;

  const reservationIds = Array.from(new Set(
    segments.map((segment) => segment.reservationId).filter((value): value is string => !!value),
  ));
  const strongFingerprints = Array.from(new Set(
    segments
      .filter((segment) => segment.guestIdentityStrength === 'strong')
      .map((segment) => segment.guestFingerprint)
      .filter((value): value is string => !!value),
  ));
  const identityStrength: PrevioGuestIdentityStrength = strongFingerprints.length === 1
    ? 'strong'
    : segments.some((segment) => segment.guestIdentityStrength === 'name')
      ? 'name'
      : 'none';

  return {
    effective,
    segments,
    originalArrivalDate,
    finalDepartureDate,
    currentNight,
    totalNights,
    reservationIds,
    guestFingerprint: strongFingerprints.length === 1 ? strongFingerprints[0] : effective.guestFingerprint,
    guestIdentityStrength: identityStrength,
    confidence: segments.length === 1 ? 'single' : identityStrength === 'strong' ? 'strong' : 'probable',
    extensionLinked: segments.length > 1,
  };
}
