import { describe, expect, it } from 'vitest';
import { canSwitchWithinOrganization } from './hotelSwitchScope';

const rd = { id: 'rd-organization', slug: 'rdhotels' };
const rdHotel = { hotel_id: 'rd-hotel-a', organization_id: rd.id, is_active: true };
const slnt = { id: 'slnt-organization', slug: 'slnt' };
const slntHotel = { hotel_id: 'slnt-hotel-a', organization_id: slnt.id, is_active: true };

describe('canSwitchWithinOrganization', () => {
  it('allows a listed active property in the authenticated organization', () => {
    expect(canSwitchWithinOrganization('rdhotels', rd, rdHotel, 'rd-hotel-a')).toBe(true);
    expect(canSwitchWithinOrganization('slnt', slnt, slntHotel, 'slnt-hotel-a')).toBe(true);
  });

  it('denies RD Hotels to SLNT and SLNT to RD Hotels in both directions', () => {
    expect(canSwitchWithinOrganization('rdhotels', rd, slntHotel, 'slnt-hotel-a')).toBe(false);
    expect(canSwitchWithinOrganization('slnt', slnt, rdHotel, 'rd-hotel-a')).toBe(false);
  });

  it('denies a route whose organization disagrees with the profile', () => {
    expect(canSwitchWithinOrganization('rdhotels', slnt, slntHotel, 'slnt-hotel-a')).toBe(false);
    expect(canSwitchWithinOrganization('slnt', rd, rdHotel, 'rd-hotel-a')).toBe(false);
  });

  it('denies a forged/unlisted hotel ID or inactive property', () => {
    expect(canSwitchWithinOrganization('rdhotels', rd, rdHotel, 'unknown')).toBe(false);
    expect(canSwitchWithinOrganization('rdhotels', rd, { ...rdHotel, is_active: false }, 'rd-hotel-a')).toBe(false);
  });

  it('fails closed when organization or selected hotel is unavailable', () => {
    expect(canSwitchWithinOrganization('rdhotels', null, rdHotel, 'rd-hotel-a')).toBe(false);
    expect(canSwitchWithinOrganization(null, rd, rdHotel, 'rd-hotel-a')).toBe(false);
    expect(canSwitchWithinOrganization('rdhotels', rd, null, 'rd-hotel-a')).toBe(false);
  });
});
