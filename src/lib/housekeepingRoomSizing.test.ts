import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_DURATION_EXAMPLES,
  HOUSEKEEPING_ROOM_SIZES,
  parseHousekeepingRoomSize,
  resolveRoomCleaningMinutes,
  verifiedBedPhotoHint,
  type CleaningTimeTarget,
} from './housekeepingRoomSizing';

const targets: CleaningTimeTarget[] = HOUSEKEEPING_ROOM_SIZES.map((size) => ({
  cleaning_size: size,
  assignment_type: 'checkout_cleaning',
  duration_minutes: CHECKOUT_DURATION_EXAMPLES[size],
}));

describe('housekeeping room mapping', () => {
  it('provides the four independently configurable checkout examples', () => {
    expect(targets.map((target) => target.duration_minutes)).toEqual([45, 60, 90, 105]);
  });

  it('does not invent a size from floor area, bed setup or guest capacity', () => {
    expect(parseHousekeepingRoomSize(45)).toBeNull();
    expect(parseHousekeepingRoomSize('twin')).toBeNull();
    expect(parseHousekeepingRoomSize(null)).toBeNull();
    expect(parseHousekeepingRoomSize('extra_large')).toBe('extra_large');
  });

  it('only returns a bed photo hint for a confirmed integer bed count', () => {
    expect(verifiedBedPhotoHint(null)).toBeNull();
    expect(verifiedBedPhotoHint(0)).toBeNull();
    expect(verifiedBedPhotoHint(2.5)).toBeNull();
    expect(verifiedBedPhotoHint(3)).toBe(3);
  });

  it('preserves manually chosen durations and never changes unconfigured work', () => {
    expect(resolveRoomCleaningMinutes('large', 'checkout_cleaning', targets, 70)).toBe(70);
    expect(resolveRoomCleaningMinutes('large', 'checkout_cleaning', targets)).toBe(90);
    expect(resolveRoomCleaningMinutes(null, 'checkout_cleaning', targets)).toBeNull();
    expect(resolveRoomCleaningMinutes('large', 'daily_cleaning', targets)).toBeNull();
    expect(resolveRoomCleaningMinutes('large', 'maintenance', targets)).toBeNull();
  });
});
