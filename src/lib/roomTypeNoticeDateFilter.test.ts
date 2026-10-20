import { describe, expect, it } from 'vitest';
import { roomTypeNoticeDateFilter } from './roomTypeNoticeDateFilter';

describe('room-type notice server-side filtering', () => {
  it('selects only the required business date without fetching other rooms', () => {
    expect(roomTypeNoticeDateFilter('2026-10-20')).toEqual({
      roomTypeChangeNotice: { date: '2026-10-20' },
    });
  });

  it('fails closed for invalid dates', () => {
    expect(() => roomTypeNoticeDateFilter('')).toThrow(/business date/);
    expect(() => roomTypeNoticeDateFilter('2026-10-20&hotel=*')).toThrow(/business date/);
    expect(() => roomTypeNoticeDateFilter('20/10/2026')).toThrow(/business date/);
  });

  it('matches the same nested metadata shape as manager-created notices', () => {
    const filter = roomTypeNoticeDateFilter('2026-10-20');
    const rooms = [
      { id: '1', pms_metadata: { roomTypeChangeNotice: { date: '2026-10-20', to: 'daily' } } },
      { id: '2', pms_metadata: { roomTypeChangeNotice: { date: '2026-10-19', to: 'checkout' } } },
      { id: '3', pms_metadata: { otherData: true } },
    ];
    expect(rooms.filter(room => (
      (room.pms_metadata as any).roomTypeChangeNotice?.date === filter.roomTypeChangeNotice.date
    )).map(room => room.id)).toEqual(['1']);
  });
});
