import { describe, expect, it } from 'vitest';
import { describeMyDay, leaveBalance, weekOf } from '@/lib/workforce/mySchedule';
import { monthBalanceMinutes, summarizeStaffMonth, type WorkforceEntry } from '@/lib/workforce/model';
import { parseGridPrefs, stepZoom } from '@/lib/workforce/gridPrefs';

const entry = (over: Partial<WorkforceEntry>): WorkforceEntry => ({
  staff_id: 's1', work_date: '2026-11-16', kind: 'work', code: null, start_time: '08:00', end_time: '17:00',
  day_fraction: 1, extra_minutes: 0, hotel_id: 'ottofiori', raw_text: null, note: null, worked_minutes: 540, status: 'published', ...over,
} as WorkforceEntry);

describe('describeMyDay', () => {
  it('shows a shift with its times and hours', () => {
    expect(describeMyDay('2026-11-16', entry({}), 'ottofiori', true)).toMatchObject({
      tone: 'work', labelKey: 'wf.my.working', time: '08:00 – 17:00', short: '08–17', hours: 9, awayHotel: null, isWork: true,
    });
  });
  it('tells the employee when the shift is at another hotel', () => {
    expect(describeMyDay('2026-11-16', entry({ hotel_id: 'mika-downtown' }), 'ottofiori', true).awayHotel).toBe('mika-downtown');
  });
  it('names a night shift, leave and sickness in plain words', () => {
    expect(describeMyDay('2026-11-16', entry({ kind: 'night', start_time: '20:00', end_time: '08:00', worked_minutes: 720 }), 'ottofiori', true)).toMatchObject({ tone: 'night', labelKey: 'wf.my.night', short: '20–08', hours: 12 });
    expect(describeMyDay('2026-11-16', entry({ kind: 'leave', start_time: null, end_time: null, worked_minutes: 0 }), 'ottofiori', true)).toMatchObject({ tone: 'leave', labelKey: 'wf.my.leave', time: null, hours: null, isWork: false });
    expect(describeMyDay('2026-11-16', entry({ kind: 'sick', start_time: null, end_time: null, worked_minutes: 0 }), 'ottofiori', true).labelKey).toBe('wf.my.sick');
  });
  it('treats an empty day as a day off only once the month is planned', () => {
    expect(describeMyDay('2026-11-17', undefined, 'ottofiori', true)).toMatchObject({ tone: 'off', labelKey: 'wf.my.dayOff' });
    expect(describeMyDay('2026-12-03', undefined, 'ottofiori', false)).toMatchObject({ tone: 'unknown', labelKey: 'wf.my.notPlanned' });
  });
});

describe('leaveBalance', () => {
  it('computes used and left, and stays silent without an entitlement', () => {
    expect(leaveBalance(25, 9.5)).toEqual({ total: 25, used: 9.5, left: 15.5, percentUsed: 38 });
    expect(leaveBalance(20, 23)).toMatchObject({ left: -3, percentUsed: 100 });
    expect(leaveBalance(null, 3)).toBeNull();
  });
});

describe('weekOf', () => {
  it('returns Monday to Sunday around a date, across a month end', () => {
    expect(weekOf('2026-11-16')[0]).toBe('2026-11-16');
    expect(weekOf('2026-11-22')).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
    expect(weekOf('2026-12-01')[0]).toBe('2026-11-30');
  });
});

describe('monthBalanceMinutes', () => {
  const month = (entries: WorkforceEntry[]) => summarizeStaffMonth(entries, 30, 8);
  const work = (d: number) => entry({ work_date: `2026-11-${String(d).padStart(2, '0')}`, start_time: '08:00', end_time: '16:00', worked_minutes: 480 });
  it('is zero when the norm is met, counting paid leave as worked', () => {
    const entries = [...Array.from({ length: 19 }, (_, i) => work(i + 1)), entry({ work_date: '2026-11-20', kind: 'leave', start_time: null, end_time: null, worked_minutes: 0 })];
    expect(monthBalanceMinutes(month(entries), 20, 8, 'full_time')).toBe(0);
  });
  it('shows overtime as plus and missing hours as minus', () => {
    expect(monthBalanceMinutes(month(Array.from({ length: 22 }, (_, i) => work(i + 1))), 20, 8, 'full_time')).toBe(960);
    expect(monthBalanceMinutes(month(Array.from({ length: 18 }, (_, i) => work(i + 1))), 20, 8, 'full_time')).toBe(-960);
  });
  it('has no norm for hourly and external staff', () => {
    expect(monthBalanceMinutes(month([work(1)]), 20, 8, 'hourly')).toBeNull();
    expect(monthBalanceMinutes(month([work(1)]), 20, 8, 'external')).toBeNull();
  });
});

describe('grid preferences', () => {
  it('steps through the zoom levels and stops at the ends', () => {
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1, 1)).toBe(1.15);
    expect(stepZoom(0.5, -1)).toBe(0.5);
    expect(stepZoom(1.5, 1)).toBe(1.5);
    expect(stepZoom(0.93, -1)).toBe(0.8);
  });
  it('ignores broken or out-of-range stored values', () => {
    expect(parseGridPrefs('{"zoom":9,"pinTotals":"x"}')).toEqual({ zoom: 0.9, pinTotals: false });
    expect(parseGridPrefs('{"zoom":0.7,"pinTotals":true}')).toEqual({ zoom: 0.7, pinTotals: true });
    expect(parseGridPrefs(null)).toEqual({ zoom: 0.9, pinTotals: false });
  });
});
