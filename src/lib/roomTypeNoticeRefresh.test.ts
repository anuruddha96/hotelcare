import { describe, expect, it } from 'vitest';
import { shouldRefreshRoomTypeNotices } from './roomTypeNoticeRefresh';

const keys = ['gozsdu-court', 'Gozsdu Court Budapest'];
const date = '2026-10-19';
const update = (roomId: string, hotel = 'gozsdu-court', notice?: unknown) => ({
  new: { id: roomId, hotel, pms_metadata: { roomTypeChangeNotice: notice } },
  old: { id: roomId },
});

describe('room-type notice Realtime refresh guard', () => {
  it('ignores a burst of ordinary PMS/RTC room writes', () => {
    const current = new Set<string>();
    for (let i = 0; i < 500; i++) {
      expect(shouldRefreshRoomTypeNotices(update(String(i)), keys, date, current)).toBe(false);
    }
  });

  it('refreshes promptly when a manager creates a new notice for today', () => {
    const payload = update('room-1', 'Gozsdu Court Budapest', { date, to: 'daily' });
    expect(shouldRefreshRoomTypeNotices(payload, keys, date, new Set())).toBe(true);
    expect(shouldRefreshRoomTypeNotices(update('room-1', 'gozsdu-court', { date, to: 'checkout' }), keys, date, new Set())).toBe(true);
  });

  it('refreshes when a previously known notice is edited or cleared', () => {
    const current = new Set(['room-1']);
    expect(shouldRefreshRoomTypeNotices(update('room-1'), keys, date, current)).toBe(true);
    expect(shouldRefreshRoomTypeNotices({ new: { id: 'room-1', hotel: 'gozsdu-court' }, old: { id: 'room-1' } }, keys, date, current)).toBe(true);
  });

  it('does not query across hotels or for another date or invalid notice type', () => {
    const current = new Set(['room-1']);
    expect(shouldRefreshRoomTypeNotices(update('room-1', 'ottofiori', { date, to: 'daily' }), keys, date, current)).toBe(false);
    expect(shouldRefreshRoomTypeNotices(update('room-2', 'gozsdu-court', { date: '2026-10-18', to: 'daily' }), keys, date, current)).toBe(false);
    expect(shouldRefreshRoomTypeNotices(update('room-2', 'gozsdu-court', { date, to: 'other' }), keys, date, current)).toBe(false);
  });

  it('fails closed for incomplete or unrelated events; fallback poll handles missed messages', () => {
    expect(shouldRefreshRoomTypeNotices({ new: { id: 'room-9' } }, keys, date, new Set())).toBe(false);
    expect(shouldRefreshRoomTypeNotices({}, keys, date, new Set())).toBe(false);
    expect(shouldRefreshRoomTypeNotices(update('room-2', 'gozsdu-court', null), keys, date, new Set())).toBe(false);
  });
});
