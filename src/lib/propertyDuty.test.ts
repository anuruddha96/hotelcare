import { describe, expect, it } from 'vitest';
import { dutyMarkerKey, mayRequestPropertyDuty, verifyDuty, type ActiveDuty, type DutyHotel } from './propertyDuty';

const destination: DutyHotel = {
  hotel_configuration_id: 'rd-config-2', hotel_id: 'rd-hotel-2',
  hotel_name: 'RD Property B', organization_slug: 'rdhotels', can_manage: false,
};
const active: ActiveDuty = {
  id: 'duty-session', hotel_configuration_id: destination.hotel_configuration_id,
  hotel_id: destination.hotel_id, hotel_name: destination.hotel_name,
  organization_slug: destination.organization_slug,
  started_at: '2026-09-22T10:00:00.000Z', expires_at: '2026-09-22T22:00:00.000Z',
};
const atNoon = Date.parse('2026-09-22T12:00:00.000Z');

describe('property duty client guard — defense in depth', () => {
  it('admits only explicitly eligible staff roles, never housekeepers', () => {
    expect(mayRequestPropertyDuty('maintenance')).toBe(true);
    expect(mayRequestPropertyDuty('reception')).toBe(true);
    expect(mayRequestPropertyDuty('manager')).toBe(true);
    for (const role of ['housekeeping', 'breakfast_staff', 'supervisor', '', null, undefined]) {
      expect(mayRequestPropertyDuty(role)).toBe(false);
    }
  });

  it('accepts a live server session only when the same organization issued a matching grant', () => {
    expect(verifyDuty(active, 'rdhotels', [destination], atNoon)).toBe(true);
    expect(verifyDuty(active, 'slnt', [destination], atNoon)).toBe(false);
    expect(verifyDuty({ ...active, organization_slug: 'slnt' }, 'rdhotels', [destination], atNoon)).toBe(false);
    expect(verifyDuty({ ...active, hotel_id: 'slnt-hotel' }, 'rdhotels', [destination], atNoon)).toBe(false);
    expect(verifyDuty({ ...active, hotel_configuration_id: 'forged' }, 'rdhotels', [destination], atNoon)).toBe(false);
    expect(verifyDuty(active, 'rdhotels', [], atNoon)).toBe(false);
  });

  it('rejects expired, missing or malformed sessions after server-side revocation', () => {
    expect(verifyDuty(active, 'rdhotels', [destination], Date.parse(active.expires_at))).toBe(false);
    expect(verifyDuty({ ...active, expires_at: 'not-a-time' }, 'rdhotels', [destination], atNoon)).toBe(false);
    expect(verifyDuty(null, 'rdhotels', [destination], atNoon)).toBe(false);
  });

  it('isolates presentation markers between users and organizations', () => {
    expect(dutyMarkerKey('employee-A', 'rdhotels')).not.toBe(dutyMarkerKey('employee-B', 'rdhotels'));
    expect(dutyMarkerKey('employee-A', 'rdhotels')).not.toBe(dutyMarkerKey('employee-A', 'slnt'));
  });
});
