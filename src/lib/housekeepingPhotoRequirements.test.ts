import { describe, expect, it } from 'vitest';
import {
  HOUSEKEEPING_PHOTO_CATALOG,
  HOUSEKEEPING_PHOTO_CATEGORY_KEYS,
  getHousekeepingPhotoEmoji,
  getHousekeepingPhotoLabel,
  isHousekeepingPhotoCategory,
} from './housekeepingPhotoRequirements';

describe('housekeeping photo category catalog', () => {
  it('uses unique predefined category keys and emojis', () => {
    expect(new Set(HOUSEKEEPING_PHOTO_CATEGORY_KEYS).size).toBe(HOUSEKEEPING_PHOTO_CATEGORY_KEYS.length);
    expect(HOUSEKEEPING_PHOTO_CATALOG.length).toBeGreaterThanOrEqual(10);
    for (const item of HOUSEKEEPING_PHOTO_CATALOG) {
      expect(item.emoji.length).toBeGreaterThan(0);
      expect(isHousekeepingPhotoCategory(item.key)).toBe(true);
    }
  });

  it('provides localized labels for the housekeeper photo flow', () => {
    expect(getHousekeepingPhotoLabel('bed', 'en')).toBe('Bed');
    expect(getHousekeepingPhotoLabel('bed', 'hu')).toBe('Ágy');
    expect(getHousekeepingPhotoLabel('bathroom', 'vi')).toBe('Phòng tắm');
    expect(getHousekeepingPhotoLabel('trash_bin', 'mn')).toBe('Хогийн сав');
    expect(getHousekeepingPhotoLabel('kitchen', 'es')).toBe('Cocina');
    expect(getHousekeepingPhotoEmoji('balcony')).toBe('🌇');
  });

  it('falls back safely for unknown display values', () => {
    expect(getHousekeepingPhotoLabel('custom_section', 'en')).toBe('custom section');
    expect(getHousekeepingPhotoEmoji('custom_section')).toBe('📷');
    expect(isHousekeepingPhotoCategory('custom_section')).toBe(false);
  });
});
