import { describe, expect, it } from 'vitest';
import { isDndForBusinessDate, isNoShowForBusinessDate } from './currentRoomTransientFlags';

describe('daily transient housekeeping flags', () => {
  it('does not carry yesterday DND into the next business day', () => {
    expect(isDndForBusinessDate({
      is_dnd: true,
      dnd_marked_at: '2026-09-23T18:45:00+02:00',
    }, '2026-09-24')).toBe(false);
  });

  it('never shows DND on a checkout room, even when the room mirror was marked today', () => {
    expect(isDndForBusinessDate({
      is_dnd: true,
      dnd_marked_at: '2026-09-24T07:10:00+02:00',
    }, '2026-09-24', 'assigned', true)).toBe(false);
  });

  it('never keeps a DND retry active after the room becomes checkout cleaning', () => {
    expect(isDndForBusinessDate({
      is_dnd: true,
      dnd_marked_at: '2026-09-24T07:10:00+02:00',
    }, '2026-09-24', 'dnd_pending_retry', true)).toBe(false);
  });

  it('keeps DND visible on the business date it was marked', () => {
    expect(isDndForBusinessDate({
      is_dnd: true,
      dnd_marked_at: '2026-09-24T07:10:00+02:00',
    }, '2026-09-24')).toBe(true);
  });

  it('keeps an active dated DND retry visible even before the room mirror updates', () => {
    expect(isDndForBusinessDate({
      is_dnd: false,
      dnd_marked_at: null,
    }, '2026-09-24', 'dnd_pending_retry')).toBe(true);
  });

  it('does not treat an undated legacy DND flag as current-day DND', () => {
    expect(isDndForBusinessDate({ is_dnd: true, dnd_marked_at: null }, '2026-09-24')).toBe(false);
  });

  it('does not carry a previous PMS no-show into the next day', () => {
    expect(isNoShowForBusinessDate({
      pms_metadata: {
        isNoShow: true,
        pmsSyncDate: '2026-09-23',
      },
    }, '2026-09-24')).toBe(false);
  });

  it('shows a no-show only from the selected day PMS snapshot', () => {
    expect(isNoShowForBusinessDate({
      pms_metadata: {
        isNoShow: true,
        pmsSyncDate: '2026-09-24',
      },
    }, '2026-09-24')).toBe(true);
  });

  it('date-scopes manual no-show actions independently from stale PMS metadata', () => {
    const room = {
      pms_metadata: {
        isNoShow: true,
        manual_no_show: true,
        manual_no_show_at: '2026-09-23T20:15:00+02:00',
        pmsSyncDate: '2026-09-24',
      },
    };
    expect(isNoShowForBusinessDate(room, '2026-09-24')).toBe(false);
    expect(isNoShowForBusinessDate(room, '2026-09-23')).toBe(true);
  });
});
