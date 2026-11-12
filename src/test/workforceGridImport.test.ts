import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { entryFromText, parseTsv, pasteTargets, textOfEntry, toTsv } from '@/lib/workforce/grid';
import { classifyColumnLabel, cleanEmployeeName, monthOfSheet, nameKey, planWorkforceImport, readScheduleWorkbook } from '@/lib/workforce/excelImport';
import { accessLevelFor, canEditDate, summarizeStaffMonth } from '@/lib/workforce/model';

const staff = { id: 's1', hotel_id: 'gozsdu-court' };

describe('clipboard', () => {
  it('round-trips Excel clipboard text, including quoted line breaks', () => {
    const rows = [['08-17', 'SZB'], ['éjsz 20:00-08:00', 'line\none']];
    expect(parseTsv(toTsv(rows))).toEqual(rows);
    expect(parseTsv('a\tb\r\nc\td\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('fills a whole selection from one copied cell and pastes blocks from the top-left', () => {
    expect(pasteTargets([['X']], { r1: 0, c1: 0, r2: 1, c2: 1 }, 10, 10)).toHaveLength(4);
    const block = pasteTargets([['a', 'b'], ['c', 'd']], { r1: 5, c1: 5, r2: 5, c2: 5 }, 6, 5);
    expect(block).toEqual([{ r: 5, c: 5, value: 'a' }, { r: 6, c: 5, value: 'c' }]);
  });
});

describe('typing a cell', () => {
  it('reads codes, times, leave and other hotels and writes them back the same way', () => {
    const codes = [{ code: 'PA', kind: 'work' as const, start_time: '07:00', end_time: '15:00', day_fraction: 1, hotel_id: null }];
    const pa = entryFromText('PA', staff, '2026-12-01', codes)!;
    expect(pa).toMatchObject({ kind: 'work', start_time: '07:00', end_time: '15:00', hotel_id: 'gozsdu-court', status: 'draft' });
    const away = entryFromText('08-17 mika', staff, '2026-12-01', [])!;
    expect(away.hotel_id).toBe('mika-downtown');
    expect(entryFromText(textOfEntry(away, 'gozsdu-court'), staff, '2026-12-02', [])).toMatchObject({ hotel_id: 'mika-downtown', start_time: '08:00' });
    expect(entryFromText('SZB', staff, '2026-12-01', [])!.kind).toBe('leave');
    expect(entryFromText('   ', staff, '2026-12-01', [])).toBeNull();
  });
});

describe('access and editing window', () => {
  it('gives top management and HR the whole company, managers their hotel, everyone else themselves', () => {
    expect(accessLevelFor('hr')).toBe('org');
    expect(accessLevelFor('housekeeping_manager')).toBe('property');
    expect(accessLevelFor('housekeeping')).toBe('self');
    expect(accessLevelFor('housekeeping', true)).toBe('org');
  });

  it('keeps history read-only, with a payroll correction window for admin and HR', () => {
    expect(canEditDate('2026-11-11', '2026-11-12', 'manager')).toBe(false);
    expect(canEditDate('2026-11-12', '2026-11-12', 'manager')).toBe(true);
    expect(canEditDate('2026-10-03', '2026-11-12', 'hr')).toBe(true);
    expect(canEditDate('2026-09-30', '2026-11-12', 'hr')).toBe(false);
  });

  it('summarises a month like the bottom rows of the workbook', () => {
    const e = (kind: string, extra = 0) => ({ staff_id: 's1', work_date: '2026-11-01', kind, code: null, start_time: null, end_time: null, day_fraction: 1, extra_minutes: extra, hotel_id: null, raw_text: null, note: null, status: 'published' as const, worked_minutes: kind === 'work' ? 480 + extra : 0 });
    const s = summarizeStaffMonth([e('work', 60), e('work'), e('leave'), e('sick')] as never, 30, 8);
    expect(s).toMatchObject({ dayShifts: 2, leaveDays: 1, sickDays: 1, workedMinutes: 1020 });
  });
});

describe('workbook import', () => {
  const fill = (rgb: string) => ({ patternType: 'solid', fgColor: { rgb } });
  const sheet: Record<string, unknown> = {
    '!ref': 'A1:D6',
    C1: { t: 's', v: 'GOZSDU HK' }, D1: { t: 's', v: 'MIKA reci' },
    C2: { t: 's', v: 'Teszt Anna /Ani/' }, D2: { t: 's', v: 'Minta Béla 6 órás' },
    A3: { t: 'n', v: 1 }, C3: { t: 's', v: 'SZ' }, D3: { t: 's', v: '08-17', s: fill('00FF00') },
    A4: { t: 'n', v: 2 }, C4: { t: 's', v: 'szabi', s: fill('FF0000') }, D4: { t: 's', v: 'B' },
    A5: { t: 'n', v: 1 }, C5: { t: 's', v: 'SZ' }, // first day of the next month: belongs to the next tab
    A6: { t: 's', v: 'Szabadság (összes/ maradt)' }, C6: { t: 's', v: '21/6' },
  };
  const months = readScheduleWorkbook(XLSX as never, { SheetNames: ['November 2026', 'Notes'], Sheets: { 'November 2026': sheet, Notes: {} } } as never);

  it('reads month tabs, colours and leave balances', () => {
    expect(monthOfSheet('Október 2026')).toEqual({ year: 2026, month: 10 });
    expect(months).toHaveLength(1);
    expect(months[0].days.size).toBe(2);
    expect(months[0].leave.get(2)).toBe('21/6');
  });

  it('plans staff, departments and days without duplicating people', () => {
    expect(cleanEmployeeName('Minta Béla 6 órás')).toMatchObject({ name: 'Minta Béla', sixHours: true });
    expect(nameKey('Gani Soufiane')).toBe(nameKey('Soufiane Gani'));
    expect(classifyColumnLabel('MIKA reci')).toEqual({ department: 'Reception', role: 'Receptionist', hotel: 'mika-downtown' });
    let n = 0;
    const plan = planWorkforceImport(months, {
      departments: [], jobRoles: [], staff: [],
      profiles: [{ id: 'p1', full_name: 'Anna Teszt' }],
    }, { today: '2026-11-12', newId: () => `id${++n}` });
    expect(plan.newStaff.map((s) => s.full_name).sort()).toEqual(['Minta Béla', 'Teszt Anna']);
    const anna = plan.newStaff.find((s) => s.full_name === 'Teszt Anna')!;
    expect(anna).toMatchObject({ nickname: 'Ani', annual_leave_days: 21, profile_id: 'p1', hotel_id: 'gozsdu-court' });
    expect(plan.newStaff.find((s) => s.full_name === 'Minta Béla')!.daily_hours).toBe(6);
    expect(plan.entries).toHaveLength(4);
    expect(plan.byKind).toMatchObject({ work: 2, leave: 1, sick: 1 });
    expect(plan.entries.every((e) => e.status === 'published')).toBe(true);
  });
});
