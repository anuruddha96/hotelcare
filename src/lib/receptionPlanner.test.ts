import { describe, expect, it } from 'vitest';
import { getRoomLaneCount, layoutRoomStays } from './receptionPlanner';

describe('reception planner lane assignment', () => {
  it('puts checkout and check-in on the same date in one lane', () => {
    const result = layoutRoomStays([
      { id: 'a', check_in_date: '2026-09-17', check_out_date: '2026-09-18' },
      { id: 'b', check_in_date: '2026-09-18', check_out_date: '2026-09-20' },
    ]);
    expect(result.map(({ lane }) => lane)).toEqual([0, 0]);
    expect(result.some(({ overlaps }) => overlaps)).toBe(false);
  });

  it('places conflicting stays in separate, visible lanes', () => {
    const result = layoutRoomStays([
      { id: 'b', check_in_date: '2026-09-18', check_out_date: '2026-09-21' },
      { id: 'a', check_in_date: '2026-09-17', check_out_date: '2026-09-20' },
    ]);
    expect(result.map(({ reservation, lane }) => [reservation.id, lane])).toEqual([['a', 0], ['b', 1]]);
    expect(result[1].overlaps).toBe(true);
    expect(getRoomLaneCount(result)).toBe(2);
  });

  it('ignores invalid and zero-night stays rather than drawing a false booking', () => {
    expect(layoutRoomStays([
      { id: 'a', check_in_date: '2026-09-18', check_out_date: '2026-09-18' },
      { id: 'b', check_in_date: '2026-09-20', check_out_date: '2026-09-19' },
    ])).toEqual([]);
  });
});
