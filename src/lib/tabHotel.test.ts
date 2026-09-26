// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearTabHotels, getTabHotel, setTabHotel, withTabHotel } from './tabHotel';

const rdAnu = { id: 'anu', role: 'manager', organization_slug: 'rdhotels', assigned_hotel: 'rd-default' };
const rdOther = { id: 'other', role: 'manager', organization_slug: 'rdhotels', assigned_hotel: 'rd-other' };
const slntOther = { id: 'other', role: 'manager', organization_slug: 'slnt', assigned_hotel: 'slnt-default' };

describe('tab hotel selection isolation', () => {
  beforeEach(() => sessionStorage.clear());

  it('retains a selected property across profile refresh for the same manager', () => {
    withTabHotel(rdAnu);
    setTabHotel('rdhotels', 'rd-second');
    expect(withTabHotel(rdAnu).assigned_hotel).toBe('rd-second');
  });

  it('does not inherit a preceding account selection within the same organization', () => {
    withTabHotel(rdAnu);
    setTabHotel('rdhotels', 'rd-second');
    expect(withTabHotel(rdOther).assigned_hotel).toBe('rd-other');
    expect(getTabHotel('rdhotels')).toBe('rd-other');
    expect(withTabHotel(rdAnu).assigned_hotel).toBe('rd-default');
  });

  it('never applies a hotel choice to another organization', () => {
    withTabHotel(rdAnu);
    setTabHotel('rdhotels', 'rd-second');
    expect(withTabHotel(slntOther).assigned_hotel).toBe('slnt-default');
    expect(getTabHotel('rdhotels')).toBe('rd-second');
  });

  it('discards a legacy selection that does not have an owner', () => {
    setTabHotel('rdhotels', 'untrusted-old-hotel');
    expect(withTabHotel(rdAnu).assigned_hotel).toBe('rd-default');
  });

  it('never hydrates a housekeeper or maintenance employee from an unverified browser tab', () => {
    const housekeeper = { id: 'hk', role: 'housekeeping', organization_slug: 'rdhotels', assigned_hotel: 'rd-home' };
    withTabHotel(housekeeper);
    setTabHotel('rdhotels', 'slnt-forged');
    expect(withTabHotel(housekeeper).assigned_hotel).toBe('rd-home');
    const technician = { id: 'tech', role: 'maintenance', organization_slug: 'rdhotels', assigned_hotel: 'rd-home' };
    withTabHotel(technician);
    setTabHotel('rdhotels', 'rd-unauthorized');
    expect(withTabHotel(technician).assigned_hotel).toBe('rd-home');
  });

  it('clears both hotel choices and account-owner markers on sign-out', () => {
    withTabHotel(rdAnu);
    setTabHotel('rdhotels', 'rd-second');
    clearTabHotels();
    expect(getTabHotel('rdhotels')).toBeNull();
    expect(withTabHotel(rdOther).assigned_hotel).toBe('rd-other');
  });
});
