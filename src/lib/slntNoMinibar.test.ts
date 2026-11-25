import { describe, expect, it } from 'vitest';
import { isNoMinibarOrganization, isNoMinibarRoom } from './gozsduNoMinibar';

describe('SLNT minibar capability', () => {
  it('disables minibar for both SLNT organization aliases', () => {
    expect(isNoMinibarOrganization('slnt')).toBe(true);
    expect(isNoMinibarOrganization('slnt-group')).toBe(true);
  });

  it('does not disable minibar globally for unrelated organizations', () => {
    expect(isNoMinibarOrganization('rdhotels')).toBe(false);
    expect(isNoMinibarRoom('rdhotels', 'ottofiori', 'ottofiori')).toBe(false);
  });
});
