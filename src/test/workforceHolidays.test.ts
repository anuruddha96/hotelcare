import { describe, expect, it } from 'vitest';
import { calendarDay, easterSunday, hungarianCalendar, isNonWorkingDay, swapsKnown, workingDays } from '@/lib/workforce/holidays';
import { fillHandleTargets } from '@/lib/workforce/grid';
import { cleanEmployeeName, classifyColumnLabel } from '@/lib/workforce/excelImport';
import { monthDays } from '@/lib/workforce/model';

describe('Hungarian calendar', () => {
  it('computes Easter-based holidays', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(calendarDay('2026-04-03')?.nameHu).toBe('Nagypéntek');
    expect(calendarDay('2026-04-06')?.nameHu).toBe('Húsvéthétfő');
    expect(calendarDay('2026-05-25')?.nameHu).toBe('Pünkösdhétfő');
  });

  it('knows the 2026 swaps and that 24 December is a holiday from 2026', () => {
    expect(calendarDay('2026-01-02')?.kind).toBe('rest_day');
    expect(calendarDay('2026-01-10')?.kind).toBe('working_saturday');
    expect(calendarDay('2026-08-21')?.kind).toBe('rest_day');
    expect(calendarDay('2026-12-24')?.kind).toBe('holiday');
    expect(calendarDay('2026-12-12')).toBeUndefined();
    expect(calendarDay('2025-12-24')?.kind).toBe('rest_day');
    expect([...hungarianCalendar(2026).values()].filter((d) => d.kind === 'holiday')).toHaveLength(14);
    expect(swapsKnown(2027)).toBe(false);
  });

  it('counts statutory working days', () => {
    expect(isNonWorkingDay('2026-01-10')).toBe(false);
    expect(isNonWorkingDay('2026-11-01')).toBe(true);
    expect(workingDays(monthDays(2026, 12))).toBe(21); // 23 weekdays minus 24 and 25 Dec
  });
});

describe('fill handle', () => {
  it('repeats the selected block in the dragged direction', () => {
    const down = fillHandleTargets({ r1: 0, c1: 0, r2: 1, c2: 0 }, { r: 4, c: 0 });
    expect(down.targets.map((t) => [t.r, t.from.r])).toEqual([[2, 0], [3, 1], [4, 0]]);
    expect(down.extended).toEqual({ r1: 0, c1: 0, r2: 4, c2: 0 });
    const right = fillHandleTargets({ r1: 3, c1: 2, r2: 3, c2: 2 }, { r: 3, c: 5 });
    expect(right.targets.map((t) => t.c)).toEqual([3, 4, 5]);
    expect(fillHandleTargets({ r1: 0, c1: 0, r2: 0, c2: 0 }, { r: 0, c: 0 }).targets).toHaveLength(0);
  });
});

describe('workbook labels', () => {
  it('recognises casual workers and the Ottofiori label', () => {
    expect(cleanEmployeeName('Fazekas Olga alkalmis')).toMatchObject({ name: 'Fazekas Olga', casual: true });
    expect(classifyColumnLabel('OTTO')).toEqual({ department: 'Other', role: 'Ottofiori staff', hotel: 'ottofiori' });
    expect(classifyColumnLabel('Otto konyha')?.department).toBe('Kitchen & Breakfast');
  });
});
