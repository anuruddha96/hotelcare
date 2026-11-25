import { describe, expect, it } from 'vitest';
import {
  SLNT_HOUSEKEEPING_PLANNING_DAYS,
  buildSlnt14DayPlanningWindow,
  groupRowsByBusinessDate,
  isSlntOrganization,
} from './slnt14DayHousekeeping';

describe('SLNT 14-day housekeeping planning', () => {
  it('builds exactly D+1 through D+14 with an exclusive D+15 API end date', () => {
    const window = buildSlnt14DayPlanningWindow('2026-09-30');

    expect(window.fromDate).toBe('2026-10-01');
    expect(window.dates).toHaveLength(SLNT_HOUSEKEEPING_PLANNING_DAYS);
    expect(window.dates[0]).toBe('2026-10-01');
    expect(window.dates[13]).toBe('2026-10-14');
    expect(window.toDateExclusive).toBe('2026-10-15');
    expect(window.dates).not.toContain('2026-09-30');
  });

  it('rolls across month and year boundaries without losing days', () => {
    const window = buildSlnt14DayPlanningWindow('2026-12-27');

    expect(window.dates[0]).toBe('2026-12-28');
    expect(window.dates[13]).toBe('2027-01-10');
    expect(window.toDateExclusive).toBe('2027-01-11');
  });

  it('groups only snapshot rows inside the requested planning dates', () => {
    const dates = ['2026-10-01', '2026-10-02'];
    const grouped = groupRowsByBusinessDate([
      { business_date: '2026-10-01', room: '101' },
      { business_date: '2026-10-01', room: '102' },
      { business_date: '2026-10-02', room: '201' },
      { business_date: '2026-10-03', room: '301' },
      { business_date: null, room: 'X' },
    ], dates);

    expect(grouped.get('2026-10-01')?.map(row => row.room)).toEqual(['101', '102']);
    expect(grouped.get('2026-10-02')?.map(row => row.room)).toEqual(['201']);
    expect(grouped.has('2026-10-03')).toBe(false);
  });

  it('keeps tenant isolation explicit', () => {
    expect(isSlntOrganization('slnt')).toBe(true);
    expect(isSlntOrganization('SLNT-GROUP')).toBe(true);
    expect(isSlntOrganization('rdhotels')).toBe(false);
    expect(isSlntOrganization(null)).toBe(false);
  });
});
