import { describe, it, expect } from 'vitest';
import { isSlntRtcReady, slntWorkSection, slntTeamBDisplayGroup, SLNT_TEAM_B_DISPLAY_ORDER } from './slntTeamBQueue';
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

describe('SLNT Team B RD-style room card order', () => {
  const base = { is_checkout_room: false, is_optional: false, towel_change_required: false, linen_change_required: false, pms_metadata: {} };
  it('prioritizes RTC ready checkout, then towel and linen changes', () => {
    expect(SLNT_TEAM_B_DISPLAY_ORDER).toEqual(['rtc','towel','due','optional','waiting']);
    expect(slntTeamBDisplayGroup({ ...base, towel_change_required: true }, today)).toBe('towel');
    expect(slntTeamBDisplayGroup({ ...base, linen_change_required: true }, today)).toBe('towel');
    expect(slntTeamBDisplayGroup({ ...base }, today)).toBe('due');
  });
  it('puts checked-out PMS-ready rooms before ordinary daily rooms', () => {
    expect(slntTeamBDisplayGroup({ ...base, is_checkout_room:true,
      pms_metadata: { pmsSyncDate:today, checkedOutToday:true } }, today)).toBe('rtc');
  });
  it('keeps guest-in-room and stale checkout at the very bottom', () => {
    expect(slntTeamBDisplayGroup({ ...base, is_checkout_room:true,
      pms_metadata: { pmsSyncDate:today, scheduledDepartureToday:true } }, today)).toBe('waiting');
    expect(slntTeamBDisplayGroup({ ...base, is_checkout_room:true,
      pms_metadata: { pmsSyncDate:'2026-10-19', checkedOutToday:true } }, today)).toBe('waiting');
  });
  it('does not mix optional stayovers or stale PMS checkouts into mandatory due work', () => {
    expect(slntTeamBDisplayGroup({ ...base, is_optional:true }, today)).toBe('optional');
    // An old optional flag must not turn an explicitly due towel/linen service
    // into low-priority, low-contrast optional work.
    expect(slntTeamBDisplayGroup({ ...base, is_optional:true, towel_change_required:true }, today)).toBe('towel');
    expect(slntTeamBDisplayGroup({ ...base, is_optional:true, linen_change_required:true }, today)).toBe('towel');
    expect(slntTeamBDisplayGroup({ ...base, is_optional:true, is_checkout_room:true }, today)).toBe('waiting');
  });
});
