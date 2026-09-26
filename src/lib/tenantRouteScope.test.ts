import { describe, expect, it } from 'vitest';
import { isOwnOrganizationRoute, restrictHotelsToOrganization, validateRpcHotelScope } from './tenantRouteScope';

const rd = { hotel_id: 'rd-a', organization_id: 'rd', is_active: true };
const slnt = { hotel_id: 'slnt-a', organization_id: 'slnt', is_active: true };

describe('tenant route and hotel guards', () => {
  it('requires a matching authenticated profile organization and route', () => {
    expect(isOwnOrganizationRoute('rdhotels', 'RDHOTELS')).toBe(true);
    expect(isOwnOrganizationRoute('slnt', 'slnt')).toBe(true);
    expect(isOwnOrganizationRoute('rdhotels', 'slnt')).toBe(false);
    expect(isOwnOrganizationRoute('slnt', 'rdhotels')).toBe(false);
    expect(isOwnOrganizationRoute(null, 'slnt')).toBe(false);
    expect(isOwnOrganizationRoute('rdhotels', null)).toBe(false);
  });

  it('filters unrelated and inactive hotels from ordinary organization responses', () => {
    expect(restrictHotelsToOrganization([rd, slnt, { ...rd, hotel_id: 'inactive', is_active: false }], 'rd')).toEqual([rd]);
    expect(restrictHotelsToOrganization([rd, slnt], 'slnt')).toEqual([slnt]);
    expect(restrictHotelsToOrganization([rd], '')).toEqual([]);
  });

  it('fails closed on a mixed organization RPC response in both directions', () => {
    expect(validateRpcHotelScope([rd, slnt])).toEqual([]);
    expect(validateRpcHotelScope([slnt, rd])).toEqual([]);
    expect(validateRpcHotelScope([{ ...rd, organization_id: null }])).toEqual([]);
    expect(validateRpcHotelScope([rd, { ...rd, is_active: false }])).toEqual([rd]);
    expect(validateRpcHotelScope([])).toEqual([]);
  });
});
