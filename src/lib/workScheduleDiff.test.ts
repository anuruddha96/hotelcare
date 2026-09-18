import { describe, expect, it } from 'vitest';
import { sameScheduleShift, type ExistingScheduleShift } from './workScheduleDiff';
import type { WorkbookShift } from './workScheduleWorkbook';

const prior: ExistingScheduleShift = {
  staff_id: 'synthetic-id', shift_date: '2026-09-17', slot: 1,
  kind: 'off', start_local: null, end_local: null,
  end_day_offset: 0, unpaid_break_minutes: 0,
  state: 'published', version: 3,
};
const source: WorkbookShift = {
  staff_id: 'synthetic-id', source_label: 'Synthetic employee',
  shift_date: '2026-09-17', slot: 1,
  kind: 'off', start_local: null, end_local: null,
  end_day_offset: 0, unpaid_break_minutes: 0,
  sheet: 'Szeptember 2026', row: 19, column: 3,
};

describe('Excel compare does not change an identical published entry', () => {
  it('recognizes identical published days off and leave as unchanged, not conflicts', () => {
    expect(sameScheduleShift(prior, source)).toBe(true);
    expect(sameScheduleShift({ ...prior, kind: 'leave' }, { ...source, kind: 'leave' })).toBe(true);
  });
  it('flags a different kind as a real conflict', () => {
    expect(sameScheduleShift(prior, { ...source, kind: 'leave' })).toBe(false);
  });
  it('compares time values despite Supabase seconds precision', () => {
    const workPrior: ExistingScheduleShift = { ...prior, kind: 'work',
      start_local: '08:00:00', end_local: '16:30:00', unpaid_break_minutes: 30 };
    const workExcel: WorkbookShift = { ...source, kind: 'work',
      start_local: '08:00', end_local: '16:30', unpaid_break_minutes: 30 };
    expect(sameScheduleShift(workPrior, workExcel)).toBe(true);
    expect(sameScheduleShift(workPrior, { ...workExcel, end_local: '17:00' })).toBe(false);
  });
});
