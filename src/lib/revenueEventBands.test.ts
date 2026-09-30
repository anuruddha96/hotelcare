import { describe, expect, it } from 'vitest';
import { buildRevenueEventBands, type RevenueEventBandInput } from './revenueEventBands';

const dates = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];

function mapEvents(rows: Array<[string, RevenueEventBandInput[]]>) {
  return new Map<string, RevenueEventBandInput[]>(rows);
}

describe('buildRevenueEventBands', () => {
  it('deduplicates one multi-day event and keeps one continuous span', () => {
    const festival = {
      title: 'Budapest Design Week',
      impact: 'high',
      category: 'festival',
      start: '2026-10-01',
      end: '2026-10-04',
    };
    const events = mapEvents([
      ['2026-10-01', [festival]],
      ['2026-10-02', [festival]],
      ['2026-10-03', [festival]],
      ['2026-10-04', [festival]],
    ]);

    const bands = buildRevenueEventBands(dates, events, 5);
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({ startIndex: 0, endIndex: 3, startDate: '2026-10-01', endDate: '2026-10-04' });
  });

  it('keeps the five strongest overlapping events and drops the sixth', () => {
    const events = mapEvents([
      ['2026-10-02', [
        { title: 'High 1', impact: 'high', start: '2026-10-02', end: '2026-10-04' },
        { title: 'High 2', impact: 'high', start: '2026-10-02', end: '2026-10-04' },
        { title: 'Medium 1', impact: 'medium', start: '2026-10-02', end: '2026-10-04' },
        { title: 'Medium 2', impact: 'medium', start: '2026-10-02', end: '2026-10-04' },
        { title: 'Low 1', impact: 'low', start: '2026-10-02', end: '2026-10-04' },
        { title: 'Low 2', impact: 'low', start: '2026-10-02', end: '2026-10-04' },
      ]],
    ]);

    const bands = buildRevenueEventBands(dates, events, 5);
    expect(bands).toHaveLength(5);
    expect(bands.map((band) => band.event.title)).toContain('Low 1');
    expect(bands.map((band) => band.event.title)).not.toContain('Low 2');
    expect(new Set(bands.map((band) => band.lane)).size).toBe(5);
  });

  it('reuses a lane once the previous event has ended', () => {
    const events = mapEvents([
      ['2026-10-01', [{ title: 'First', impact: 'medium', start: '2026-10-01', end: '2026-10-02' }]],
      ['2026-10-03', [{ title: 'Second', impact: 'medium', start: '2026-10-03', end: '2026-10-05' }]],
    ]);

    const bands = buildRevenueEventBands(dates, events, 5);
    expect(bands).toHaveLength(2);
    expect(bands[0].lane).toBe(bands[1].lane);
  });

  it('clips an event to the currently visible date window', () => {
    const events = mapEvents([
      ['2026-10-01', [{ title: 'Long congress', impact: 'high', start: '2026-09-28', end: '2026-10-03' }]],
    ]);

    const bands = buildRevenueEventBands(dates, events, 5);
    expect(bands[0]).toMatchObject({ startIndex: 0, endIndex: 2, startDate: '2026-09-28', endDate: '2026-10-03' });
  });
});
