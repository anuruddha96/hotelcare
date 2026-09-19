import { describe, expect, it } from 'vitest';
import { isGozsduNoMinibarRoom, requiredDailyPhotoCategories } from './gozsduNoMinibar';

describe('Gozsdu-only minibar policy', () => {
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
});
