import { describe, expect, it } from 'vitest';
import { buildWorkbookPlan, rosterHeaderVenues, rosterSheetMonth,
  type RosterSheet, type WorkbookOptions } from './workScheduleWorkbook';

const month = (name: string, totalDays: number, value: string | number = '08:00-16:00'): RosterSheet => ({
  name,
  rows: [
    ['', '', 'MEMO HK', 'MIKA HK'],
    ['', '', 'Synthetic Employee', 'Other Hotel Employee'],
    ...Array.from({ length: totalDays }, (_, index) => [index + 1, 'Mo', value, '08:00-16:00']),
    ['', '', '', ''], // Legacy workbook separates weeks with blank rows.
    [1, 'Mo', '09:00-17:00', '09:00-17:00'], // Next-month trailing day: never assign to this tab.
    [2, 'Tu', '09:00-17:00', '09:00-17:00'],
  ],
});
const link = { id: 'link-1', source_label: 'Synthetic Employee', staff_id: 'account-uuid' };
const options: WorkbookOptions = {
  hotelId: 'memories-budapest',
  selectedSheets: ['Szeptember 2026'],
  includedColumns: { 'Szeptember 2026': [2] },
  savedLinks: [link], authorizedAccountIds: ['account-uuid'],
  codebook: {}, acceptAutoFormattedDates: false,
};

describe('multi-tab RD Hotels workbook import planning', () => {
  it('recognizes Hungarian month/year tabs without confusing the undated template', () => {
    expect(rosterSheetMonth('Szeptember 2026')).toBe('2026-09');
    expect(rosterSheetMonth('Október 2026')).toBe('2026-10');
    expect(rosterSheetMonth('Február 2026')).toBe('2026-02');
    expect(rosterSheetMonth('minta')).toBeNull();
    expect(rosterSheetMonth('Szeptember 2026 Október 2026')).toBeNull();
  });

  it('uses the full chosen month, skipping duplicate next-month days without assigning them twice', () => {
    const plan = buildWorkbookPlan([month('Szeptember 2026', 30)], options);
    expect(plan.ready).toBe(true);
    expect(plan.entries).toHaveLength(30);
    expect(plan.entries[0].shift_date).toBe('2026-09-01');
    expect(plan.entries.at(-1)?.shift_date).toBe('2026-09-30');
    expect(plan.rolloverRowsSkipped).toBe(2);
  });

  it('imports independently from multiple selected tabs and ignores unselected template', () => {
    const october = month('Október 2026', 31);
    const plan = buildWorkbookPlan([month('Szeptember 2026', 30), october, month('minta', 31)], {
      ...options, selectedSheets: ['Szeptember 2026', 'Október 2026'],
      includedColumns: { 'Szeptember 2026': [2], 'Október 2026': [2] },
    });
    expect(plan.ready).toBe(true);
    expect(plan.entries).toHaveLength(61);
    expect(plan.entries.at(-1)?.shift_date).toBe('2026-10-31');
  });

  it('never imports a different venue column despite an authorized profile link', () => {
    const plan = buildWorkbookPlan([month('Szeptember 2026', 30)], {
      ...options, includedColumns: { 'Szeptember 2026': [3] },
      savedLinks: [{ id: 'other-link', source_label: 'Other Hotel Employee', staff_id: 'account-uuid' }],
    });
    expect(plan.ready).toBe(false);
    expect(plan.issues.some(issue => issue.code === 'wrong_venue')).toBe(true);
    expect(rosterHeaderVenues('GOZSDU- MIKA reci')).toHaveLength(2);
  });

  it('requires a confirmed existing account UUID, rather than guessing a matching name', () => {
    const plan = buildWorkbookPlan([month('Szeptember 2026', 30)], { ...options, savedLinks: [] });
    expect(plan.ready).toBe(false);
    expect(plan.issues.some(issue => issue.code === 'unlinked_employee')).toBe(true);
    expect(plan.entries).toHaveLength(0);
  });

  it('recognizes Excel auto-dates only after explicit manager confirmation', () => {
    const sheet = month('Szeptember 2026', 30, 45155);
    sheet.autoDateCells = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`${index + 2}:2`, '08-17']));
    const blocked = buildWorkbookPlan([sheet], options);
    expect(blocked.ready).toBe(false);
    expect(blocked.autoDateCount).toBe(30);
    expect(blocked.issues.some(issue => issue.code === 'excel_date')).toBe(true);
    const accepted = buildWorkbookPlan([sheet], { ...options, acceptAutoFormattedDates: true });
    expect(accepted.ready).toBe(true);
    expect(accepted.entries[0].start_local).toBe('08:00');
    expect(accepted.entries[0].end_local).toBe('17:00');
  });

  it('does not infer opaque codes until a manager explicitly defines them', () => {
    const unreviewed = buildWorkbookPlan([month('Szeptember 2026', 30, 'SZ')], options);
    expect(unreviewed.ready).toBe(false);
    expect(unreviewed.unknownTokens).toEqual([{ token: 'SZ', count: 30 }]);
    const confirmed = buildWorkbookPlan([month('Szeptember 2026', 30, 'SZ')], {
      ...options, codebook: { SZ: { kind: 'off' } },
    });
    expect(confirmed.ready).toBe(true);
    expect(confirmed.entries[0].kind).toBe('off');
  });

  it('blocks formulas, non-date numbers, missing days and double assignment', () => {
    const normal = month('Szeptember 2026', 30);
    normal.formulaCells = ['2:2'];
    expect(buildWorkbookPlan([normal], options).issues.some(issue => issue.code === 'formula')).toBe(true);
    expect(buildWorkbookPlan([month('Szeptember 2026', 30, 999)], options).ready).toBe(false);
    expect(buildWorkbookPlan([month('Szeptember 2026', 29)], options).issues.some(issue => issue.code === 'incomplete_month')).toBe(true);
    const duplicate = month('Szeptember 2026', 30);
    duplicate.rows[1][3] = 'Synthetic Employee'; duplicate.rows[0][3] = 'MEMO HK';
    expect(buildWorkbookPlan([duplicate], {
      ...options, includedColumns: { 'Szeptember 2026': [2, 3] },
    }).issues.some(issue => issue.code === 'duplicate_alias')).toBe(true);
  });

  it('allows clearly written split shifts and blocks implicit overnight guesses', () => {
    const split = buildWorkbookPlan([month('Szeptember 2026', 30, '08:00-12:00 / 13:00-17:00')], options);
    expect(split.ready).toBe(true);
    expect(split.entries).toHaveLength(60);
    expect(split.entries[1].slot).toBe(2);
    expect(buildWorkbookPlan([month('Szeptember 2026', 30, '20:00-08:00')], options).ready).toBe(false);
    const explicit = buildWorkbookPlan([month('Szeptember 2026', 30, '20:00-08:00 (+1)')], options);
    expect(explicit.ready).toBe(true);
    expect(explicit.entries[0].end_day_offset).toBe(1);
  });
});
