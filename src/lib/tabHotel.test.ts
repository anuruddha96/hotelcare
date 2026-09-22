// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearTabHotels, getTabHotel, setTabHotel, withTabHotel } from './tabHotel';

const rdAnu = { id: 'anu', organization_slug: 'rdhotels', assigned_hotel: 'rd-default' };
const rdOther = { id: 'other', organization_slug: 'rdhotels', assigned_hotel: 'rd-other' };
const slntOther = { id: 'other', organization_slug: 'slnt', assigned_hotel: 'slnt-default' };

describe('tab hotel selection isolation', () => {
  beforeEach(() => sessionStorage.clear());

  it('retains a selected property across profile refresh for the same user', () => {
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

  it('clears both hotel choices and account-owner markers on sign-out', () => {
    withTabHotel(rdAnu);
    setTabHotel('rdhotels', 'rd-second');
    clearTabHotels();
    expect(getTabHotel('rdhotels')).toBeNull();
    expect(withTabHotel(rdOther).assigned_hotel).toBe('rd-other');
  });
});
