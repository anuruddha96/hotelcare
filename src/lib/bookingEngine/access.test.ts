import { describe, expect, it } from 'vitest';
import { isTopManagement, testLinkFor } from './access';

describe('booking engine access', () => {
  it('is for admins, top management and super admins only', () => {
    expect(isTopManagement('admin')).toBe(true);
    expect(isTopManagement('top_management')).toBe(true);
    expect(isTopManagement('top_management_manager')).toBe(true);
    expect(isTopManagement('manager')).toBe(false);
    expect(isTopManagement('reception')).toBe(false);
    expect(isTopManagement(null)).toBe(false);
    expect(isTopManagement('housekeeping', true)).toBe(true);
  });
  it('builds the private test link', () => {
    expect(testLinkFor('https://my.hotelcare.app', 'be_1', 'f'.repeat(64), 'hu'))
      .toBe(`https://my.hotelcare.app/book/be_1?preview=${'f'.repeat(64)}&lang=hu`);
  });
});
