import { describe, it, expect } from 'vitest';
import { isSlntRtcReady, slntWorkSection } from './slntTeamBQueue';
const today = '2026-10-20';

describe('SLNT Team B shared queue presentation', () => {
  it('places RTC-ready checkouts first', () => {
    const room={is_checkout_room:true,pms_metadata:{pmsSyncDate:today,checkedOutToday:true}};
    expect(isSlntRtcReady(room,today)).toBe(true);
    expect(slntWorkSection(room,today)).toBe('rtc');
  });
  it('does not permit stale RTC from another day', () => {
    const room={is_checkout_room:true,pms_metadata:{pmsSyncDate:today,readyToClean:true,readyToCleanDate:'2026-10-19'}};
    expect(isSlntRtcReady(room,today)).toBe(false);
    expect(slntWorkSection(room,today)).toBe('waiting');
  });
  it('treats same-day RTC as ready and separates stayovers', () => {
    expect(slntWorkSection({is_checkout_room:true,pms_metadata:{pmsSyncDate:today,readyToClean:true,readyToCleanDate:today}},today)).toBe('rtc');
    expect(slntWorkSection({is_checkout_room:false,pms_metadata:{}},today)).toBe('stayover');
  });
  it('keeps checkout waiting when PMS sync is stale even if checkout flag is true', () => {
    expect(slntWorkSection({is_checkout_room:true,pms_metadata:{pmsSyncDate:'2026-10-19',checkedOutToday:true}},today)).toBe('waiting');
  });
});
