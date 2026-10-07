import { describe, expect, it } from 'vitest';
import { isGozsduNoMinibarRoom, isNoMinibarOrganization, isNoMinibarRoom, requiredDailyPhotoCategories } from './gozsduNoMinibar';

describe('housekeeping minibar policy', () => {
  it('suppresses minibar for every SLNT venue without affecting RD properties', () => {
    expect(isNoMinibarOrganization('slnt')).toBe(true);
    expect(isNoMinibarOrganization('SLNT-GROUP')).toBe(true);
    expect(isNoMinibarRoom('slnt', 'SLNT Group', 'slnt-group')).toBe(true);
    expect(isNoMinibarRoom('slnt', 'SLNT Group', 'Silver Rooms')).toBe(true);
    expect(requiredDailyPhotoCategories('SLNT Group', 'Silver Rooms', 'slnt'))
      .toEqual(['trash_bin', 'bathroom', 'bed', 'tea_coffee_table']);
    expect(isNoMinibarRoom('rdhotels', 'Hotel Memories Budapest', 'Hotel Memories Budapest')).toBe(false);
  });

  it('matches exact property ID and display name aliases', () => {
    expect(isGozsduNoMinibarRoom('gozsdu-court', 'Gozsdu Court Budapest')).toBe(true);
    expect(isGozsduNoMinibarRoom('Gozsdu Court Budapest', 'gozsdu-court')).toBe(true);
    expect(isGozsduNoMinibarRoom('gozsdu-court', 'Hotel Mika Downtown')).toBe(false);
    expect(isGozsduNoMinibarRoom('Hotel Memories Budapest', 'gozsdu-court')).toBe(false);
    expect(isGozsduNoMinibarRoom(null, 'gozsdu-court')).toBe(false);
    expect(isGozsduNoMinibarRoom('gozsdu-court-other', 'gozsdu-court')).toBe(false);
  });

  it('keeps four non-minibar photos for Gozsdu and five for all other hotels', () => {
    expect(requiredDailyPhotoCategories('gozsdu-court', 'Gozsdu Court Budapest'))
      .toEqual(['trash_bin', 'bathroom', 'bed', 'tea_coffee_table']);
    expect(requiredDailyPhotoCategories('memories-budapest', 'Hotel Memories Budapest'))
      .toEqual(['trash_bin', 'bathroom', 'bed', 'minibar', 'tea_coffee_table']);
    expect(requiredDailyPhotoCategories('gozsdu-court', 'Hotel Ottofiori')).toContain('minibar');
  });

  it('does not suppress minibar at other properties after a property switch or missing room context', () => {
    expect(requiredDailyPhotoCategories('Hotel Mika Downtown', 'gozsdu-court')).toContain('minibar');
    expect(requiredDailyPhotoCategories('gozsdu-court', undefined)).toContain('minibar');
    expect(requiredDailyPhotoCategories(undefined, 'Gozsdu Court Budapest')).toContain('minibar');
    expect(requiredDailyPhotoCategories(' Gozsdu Court Budapest ', ' GOZSDU-COURT '))
      .toEqual(['trash_bin', 'bathroom', 'bed', 'tea_coffee_table']);
  });
});
