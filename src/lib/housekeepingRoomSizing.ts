/**
 * Housekeeping-specific room sizes are manager-maintained. They must never be
 * guessed from guest capacity, a temporary PMS bed preference or floor area.
 */
export const HOUSEKEEPING_ROOM_SIZES = ['small', 'medium', 'large', 'extra_large'] as const;
export type HousekeepingRoomSize = (typeof HOUSEKEEPING_ROOM_SIZES)[number];
export type HousekeepingCleaningType = 'checkout_cleaning' | 'daily_cleaning' | 'deep_cleaning';

export const CHECKOUT_DURATION_EXAMPLES: Record<HousekeepingRoomSize, number> = {
  small: 45,
  medium: 60,
  large: 90,
  extra_large: 105,
};

export const ROOM_SIZE_LABELS: Record<HousekeepingRoomSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  extra_large: 'Extra-large',
};

export function parseHousekeepingRoomSize(value: unknown): HousekeepingRoomSize | null {
  return typeof value === 'string' && HOUSEKEEPING_ROOM_SIZES.includes(value as HousekeepingRoomSize)
    ? value as HousekeepingRoomSize
    : null;
}

/** Only manager-confirmed bed counts may be used for a room-specific hint. */
export function verifiedBedPhotoHint(verifiedBedCount: number | null | undefined): number | null {
  return typeof verifiedBedCount === 'number'
    && Number.isInteger(verifiedBedCount)
    && verifiedBedCount >= 1
    && verifiedBedCount <= 20
    ? verifiedBedCount
    : null;
}

export interface CleaningTimeTarget {
  cleaning_size: HousekeepingRoomSize;
  assignment_type: HousekeepingCleaningType;
  duration_minutes: number;
}

/**
 * An explicitly supplied/manual estimate always wins. An unmapped room or
 * unconfigured cleaning type stays unset rather than receiving invented time.
 */
export function resolveRoomCleaningMinutes(
  roomSize: unknown,
  assignmentType: string,
  targets: readonly CleaningTimeTarget[],
  manualEstimate?: number | null,
): number | null {
  if (typeof manualEstimate === 'number' && Number.isFinite(manualEstimate) && manualEstimate > 0) {
    return manualEstimate;
  }
  const parsedSize = parseHousekeepingRoomSize(roomSize);
  if (!parsedSize) return null;
  const match = targets.find((target) =>
    target.cleaning_size === parsedSize && target.assignment_type === assignmentType
  );
  return match && Number.isInteger(match.duration_minutes)
    && match.duration_minutes >= 1
    && match.duration_minutes <= 480
    ? match.duration_minutes
    : null;
}
