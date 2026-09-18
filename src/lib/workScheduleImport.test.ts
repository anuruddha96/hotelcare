import { describe, expect, it } from 'vitest';
import { dryRunRoster, type DryRunOptions, type RosterRows } from './workScheduleImport';

const base: DryRunOptions = {
  month: '2026-09', hotelId: 'ottofiori',
  columns: { 2: { staffId: 'employee-a', hotelId: 'ottofiori' } },
  eligibleStaff: [{ id: 'employee-a', hotelId: 'ottofiori' }],
};
const sheet = (token: unknown, day: string | number = 17): RosterRows => [
  ['', '', 'OTTO'], ['', '', 'Synthetic person'], [day, 'Thursday', token as string],
];

describe('RD Hotels Excel roster dry-run security and integrity', () => {
  it('interprets only an unambiguous explicitly mapped daytime shift', () => {
    const result = dryRunRoster(sheet('8:00 - 16:30'), base);
    expect(result.ready).toBe(true);
    expect(result.entries).toEqual([{
      staffId: 'employee-a', hotelId: 'ottofiori', shiftDate: '2026-09-17', slot: 1,
      kind: 'work', startLocal: '08:00', endLocal: '16:30', endDayOffset: 0,
      sourceColumn: 3, sourceRow: 3,
    }]);
    expect(result.issues).toHaveLength(0);
  });

  it('requires explicit overnight notation instead of guessing an end date', () => {
    expect(dryRunRoster(sheet('20:00-08:00'), base).issues[0].code).toBe('unknown_value');
    const result = dryRunRoster(sheet('20:00-08:00 (+1)'), base);
    expect(result.ready).toBe(true);
    expect(result.entries[0].endDayOffset).toBe(1);
  });

  it('blocks opaque codes until HR explicitly defines them', () => {
    const unknown = dryRunRoster(sheet('SZ'), base);
    expect(unknown.ready).toBe(false);
    expect(unknown.issues[0].code).toBe('unknown_value');
    const approved = dryRunRoster(sheet('SZ'), { ...base, approvedCodes: { SZ: 'off' } });
    expect(approved.ready).toBe(true);
    expect(approved.entries[0].kind).toBe('off');
    expect(approved.entries[0].startLocal).toBeNull();
  });

  it('never turns Excel numeric or formula cells into shifts or hours', () => {
    for (const value of [0.5, 8, true, '=SUM(A1:A2)']) {
      const result = dryRunRoster(sheet(value), base);
      expect(result.ready).toBe(false);
      expect(result.entries).toHaveLength(0);
      expect(result.issues[0].code).toBe('unknown_value');
    }
  });

  it('rejects missing and unauthorized employee mappings and mismatched venues', () => {
    expect(dryRunRoster(sheet('08:00-16:00'), { ...base, columns: {} }).issues[0].code)
      .toBe('unmapped_employee');
    expect(dryRunRoster(sheet('08:00-16:00'), { ...base,
      columns: { 2: { staffId: 'employee-a', hotelId: 'memories-budapest' } },
    }).issues[0].code).toBe('wrong_venue');
    expect(dryRunRoster(sheet('08:00-16:00'), { ...base,
      columns: { 2: { staffId: 'foreign-user', hotelId: 'ottofiori' } },
    }).issues[0].code).toBe('unauthorized_employee');
  });

  it('blocks invalid calendar dates and source rows with a total instead of a day', () => {
    expect(dryRunRoster(sheet('08:00-16:00', 31), base).issues[0].code).toBe('invalid_day_row');
    expect(dryRunRoster(sheet('08:00-16:00', 'TOTAL'), base).issues[0].code).toBe('invalid_day_row');
    expect(dryRunRoster(sheet('08:00-16:00'), { ...base, month: '2026-13' }).issues[0].code).toBe('invalid_month');
  });

  it('detects two mapped source columns claiming the same employee and same day', () => {
    const rows: RosterRows = [
      ['', '', 'OTTO', 'OTTO'], ['', '', 'Synthetic person', 'Second column'],
      [17, 'Thursday', '08:00-12:00', '13:00-17:00'],
    ];
    const result = dryRunRoster(rows, { ...base, columns: {
      2: { staffId: 'employee-a', hotelId: 'ottofiori' },
      3: { staffId: 'employee-a', hotelId: 'ottofiori' },
    } });
    expect(result.ready).toBe(false);
    expect(result.issues.some(issue => issue.code === 'duplicate_assignment')).toBe(true);
  });

  it('does not turn an Excel split-shift expression into an invented single shift', () => {
    expect(dryRunRoster(sheet('08:00-12:00 / 13:00-17:00'), base).issues[0].code)
      .toBe('unknown_value');
  });

  it('does not silently discard another nonempty, unmapped staff column', () => {
    const rows: RosterRows = [
      ['', '', 'OTTO', 'MEMO'], ['', '', 'Synthetic A', 'Synthetic B'],
      [17, 'Thursday', '08:00-16:00', '08:00-16:00'],
    ];
    const result = dryRunRoster(rows, base);
    expect(result.ready).toBe(false);
    expect(result.issues.some(issue => issue.code === 'unmapped_employee')).toBe(true);
  });
});
