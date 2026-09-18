import type { RosterCell, RosterKind, RosterRows } from './workScheduleImport';
import { rosterIdentityKey, type ConfirmedRosterLink } from './workScheduleIdentity';

/** Read-only parsed workbook. autoDateCells contains the displayed mm-dd for cells
 * Excel converted from a human-entered shift such as 08-17 into a date serial. */
export type RosterSheet = {
  name: string;
  rows: RosterRows;
  autoDateCells?: Record<string, string>; // zero-based 'row:column' -> visible mm-dd
  formulaCells?: string[]; // zero-based row:column
};
export type ShiftRule = {
  kind: RosterKind;
  startLocal?: string;
  endLocal?: string;
  endDayOffset?: 0 | 1;
  unpaidBreakMinutes?: number;
};
export type WorkbookShift = {
  staff_id: string;
  source_label: string;
  shift_date: string;
  slot: number;
  kind: RosterKind;
  start_local: string | null;
  end_local: string | null;
  end_day_offset: 0 | 1;
  unpaid_break_minutes: number;
  sheet: string;
  row: number;
  column: number;
};
export type WorkbookIssue = {
  sheet: string;
  row: number;
  column: number;
  code: string;
  detail: string;
};
export type WorkbookPlan = {
  entries: WorkbookShift[];
  issues: WorkbookIssue[];
  unknownTokens: { token: string; count: number }[];
  autoDateCount: number;
  rolloverRowsSkipped: number;
  ready: boolean;
};
export type WorkbookOptions = {
  hotelId: string;
  selectedSheets: string[];
  /** Sheet name -> zero-based employee columns selected by the manager. */
  includedColumns: Record<string, number[]>;
  savedLinks: ConfirmedRosterLink[];
  authorizedAccountIds: string[];
  codebook: Record<string, ShiftRule>;
  acceptAutoFormattedDates: boolean;
};
const huMonths: Record<string, number> = {
  januar: 1, februar: 2, marcius: 3, aprilis: 4, majus: 5, junius: 6,
  julius: 7, augusztus: 8, szeptember: 9, oktober: 10, november: 11, december: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const clean = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const codeKey = (text: string) => text.trim().replace(/\s+/g, ' ').toLocaleUpperCase('hu-HU');

export function rosterSheetMonth(name: string): string | null {
  const tokens = clean(name).split(/[^a-z0-9]+/).filter(Boolean);
  const years = tokens.filter(token => /^20\d{2}$/.test(token));
  const months = tokens.map(token => huMonths[token]).filter(Boolean);
  return years.length === 1 && months.length === 1
    ? `${years[0]}-${String(months[0]).padStart(2, '0')}` : null;
}

/** Shared restaurant labels are NOT hotel IDs. A multi-hotel header requires
 * deliberate inclusion; an unambiguous different hotel header is blocked. */
export function rosterHeaderVenues(header: string): string[] {
  const label = clean(header);
  const venues: string[] = [];
  if (/gozsdu/.test(label)) venues.push('gozsdu-court');
  if (/\bmika\b/.test(label)) venues.push('mika-downtown');
  if (/\bmemo\b|\bmemories\b/.test(label)) venues.push('memories-budapest');
  if (/\botto\b|\bottofiori\b/.test(label)) venues.push('ottofiori');
  return venues;
}

function clock(raw: string): string | null {
  const match = /^(\d{1,2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!match) return null;
  const h = Number(match[1]); const m = Number(match[2] ?? 0);
  return h < 24 && m < 60 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : null;
}
function timeMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}
function safeRule(rule: ShiftRule): Omit<WorkbookShift, 'staff_id'|'source_label'|'shift_date'|'slot'|'sheet'|'row'|'column'> | null {
  if (!['work','off','leave','training','unavailable'].includes(rule.kind)) return null;
  if (rule.kind !== 'work') {
    return rule.startLocal || rule.endLocal || rule.endDayOffset || rule.unpaidBreakMinutes
      ? null : { kind: rule.kind, start_local: null, end_local: null, end_day_offset: 0, unpaid_break_minutes: 0 };
  }
  const start = clock(rule.startLocal ?? ''); const end = clock(rule.endLocal ?? '');
  const offset = rule.endDayOffset ?? 0; const unpaid = rule.unpaidBreakMinutes ?? 0;
  if (!start || !end || ![0,1].includes(offset) || !Number.isInteger(unpaid) || unpaid < 0 || unpaid > 240) return null;
  const duration = timeMinutes(end) - timeMinutes(start) + 1440 * offset;
  if (duration <= unpaid || duration > 1440 || (offset === 1 && end >= start)) return null;
  return { kind: 'work', start_local: start, end_local: end,
    end_day_offset: offset, unpaid_break_minutes: unpaid };
}
function explicitShifts(token: string): ReturnType<typeof safeRule>[] | null {
  const segments = token.split(/\s+\/\s+/);
  if (segments.length > 4) return null;
  const result: NonNullable<ReturnType<typeof safeRule>>[] = [];
  for (const segment of segments) {
    const match = /^(\d{1,2}(?::\d{2})?)\s*[-–—]\s*(\d{1,2}(?::\d{2})?)(?:\s*\(\+1\))?$/.exec(segment.trim());
    if (!match) return null;
    const start = clock(match[1]); const end = clock(match[2]);
    if (!start || !end) return null;
    const overnight = /\(\+1\)$/.test(segment.trim());
    const shift = safeRule({ kind: 'work', startLocal: start, endLocal: end,
      endDayOffset: overnight ? 1 : 0, unpaidBreakMinutes: 0 });
    // Never interpret a short end clock as tomorrow without explicit (+1).
    if (!shift) return null;
    result.push(shift);
  }
  return result;
}
function dayNumber(value: RosterCell): number | null {
  const str = String(value ?? '').trim();
  if (!/^(?:[1-9]|[12]\d|3[01])(?:\.0+)?$/.test(str)) return null;
  return Number(str);
}

/** Inspect every explicitly selected monthly tab. No workbook bytes or names
 * leave the browser; output contains ONLY selected hotel accounts and reviewed rows.
 * The first descending day number marks the workbook's next-month trailing days. */
export function buildWorkbookPlan(sheets: RosterSheet[], options: WorkbookOptions): WorkbookPlan {
  const entries: WorkbookShift[] = [];
  const issues: WorkbookIssue[] = [];
  const unknown = new Map<string, number>();
  const permitted = new Set(options.authorizedAccountIds);
  const selection = new Set(options.selectedSheets);
  const seen = new Set<string>();
  let autoDateCount = 0;
  let rolloverRowsSkipped = 0;
  const fail = (sheet: string, row: number, column: number, code: string, detail: string) =>
    issues.push({ sheet, row, column, code, detail });
  if (!options.hotelId || selection.size === 0) fail('', 0, 0, 'no_sheets', 'Select one or more dated worksheets.');
  if (selection.size !== options.selectedSheets.length) fail('', 0, 0, 'duplicate_tab', 'Select each worksheet once.');
  const linkMap = new Map(options.savedLinks.map(link => [rosterIdentityKey(link.source_label), link.staff_id]));
  for (const sheet of sheets) {
    if (!selection.has(sheet.name)) continue;
    const month = rosterSheetMonth(sheet.name);
    if (!month) { fail(sheet.name, 0, 0, 'unknown_month', 'Sheet needs an unambiguous month and year.'); continue; }
    const [year, mm] = month.split('-').map(Number);
    const expectedDays = new Date(Date.UTC(year, mm, 0)).getUTCDate();
    const included = options.includedColumns[sheet.name] ?? [];
    if (new Set(included).size !== included.length || included.length === 0) {
      fail(sheet.name, 0, 0, 'no_columns', 'Select at least one employee column once.'); continue;
    }
    const aliases = new Map<string, number>();
    const columns = included.map(col => {
      const label = String(sheet.rows[1]?.[col] ?? '').trim();
      const venues = rosterHeaderVenues(String(sheet.rows[0]?.[col] ?? ''));
      if (!Number.isInteger(col) || col < 2 || !label) fail(sheet.name, 2, col + 1, 'missing_name', 'Column must have an employee name.');
      if (venues.length === 1 && venues[0] !== options.hotelId)
        fail(sheet.name, 1, col + 1, 'wrong_venue', 'Column header belongs to another hotel.');
      if (venues.length > 1 && !venues.includes(options.hotelId))
        fail(sheet.name, 1, col + 1, 'wrong_venue', 'Mixed column does not include this hotel.');
      const key = rosterIdentityKey(label);
      if (aliases.has(key)) fail(sheet.name, 2, col + 1, 'duplicate_alias', 'Repeated name needs a distinct verified account/source label.');
      aliases.set(key, col);
      const staffId = linkMap.get(key);
      if (!staffId || !permitted.has(staffId))
        fail(sheet.name, 2, col + 1, 'unlinked_employee', 'Confirm the Excel name against an authorized HotelCare account first.');
      return { col, label, staffId };
    });
    const activeFormula = new Set(sheet.formulaCells ?? []);
    let previousDay = 0; let foundDays = 0; let rollover = false;
    for (let r = 2; r < sheet.rows.length; r++) {
      const row = sheet.rows[r] ?? [];
      const day = dayNumber(row[0]);
      if (day === null) continue;
      if (day <= previousDay) { rollover = true; rolloverRowsSkipped++; continue; }
      if (rollover) { rolloverRowsSkipped++; continue; }
      if (day !== previousDay + 1 || day > expectedDays) {
        fail(sheet.name, r + 1, 1, 'invalid_calendar', 'Missing, repeated or out-of-month day; review sheet layout.');
        continue;
      }
      previousDay = day; foundDays++;
      for (const { col, label, staffId } of columns) {
        const raw = row[col];
        if (raw === null || raw === undefined || String(raw).trim() === '') continue;
        if (activeFormula.has(`${r}:${col}`)) {
          fail(sheet.name, r + 1, col + 1, 'formula', 'Formulas are not accepted as roster entries.'); continue;
        }
        let token = typeof raw === 'string' ? raw.trim() : '';
        const excelAutoDate = sheet.autoDateCells?.[`${r}:${col}`];
        if (excelAutoDate) {
          autoDateCount++;
          if (!options.acceptAutoFormattedDates) {
            fail(sheet.name, r + 1, col + 1, 'excel_date', `Excel formatted a potential shift as ${excelAutoDate}; explicitly review and enable date-to-shift interpretation.`);
            continue;
          }
          token = excelAutoDate;
        } else if (typeof raw !== 'string') {
          fail(sheet.name, r + 1, col + 1, 'numeric_or_invalid', 'Non-text entry needs manual correction or an explicitly recognized Excel auto-date format.');
          continue;
        }
        const key = codeKey(token);
        const resolved = options.codebook[key]
          ? [safeRule(options.codebook[key])]
          : explicitShifts(token);
        if (!resolved || resolved.some(rule => !rule)) {
          unknown.set(token, (unknown.get(token) ?? 0) + 1);
          fail(sheet.name, r + 1, col + 1, 'unknown_code', 'Unrecognized/ambiguous shift code: explicitly define its meaning.');
          continue;
        }
        if (!staffId || !permitted.has(staffId)) continue;
        for (const [slotIndex, rule] of resolved.entries()) {
          if (!rule) continue;
          const shiftDate = `${month}-${String(day).padStart(2, '0')}`;
          const identity = `${staffId}/${shiftDate}/${slotIndex + 1}`;
          if (seen.has(identity)) {
            fail(sheet.name, r + 1, col + 1, 'duplicate_shift', 'Two Excel cells target one employee/date/slot.');
            continue;
          }
          seen.add(identity);
          entries.push({ staff_id: staffId, source_label: label, shift_date: shiftDate,
            slot: slotIndex + 1, kind: rule.kind, start_local: rule.start_local,
            end_local: rule.end_local, end_day_offset: rule.end_day_offset,
            unpaid_break_minutes: rule.unpaid_break_minutes, sheet: sheet.name,
            row: r + 1, column: col + 1 });
        }
      }
    }
    if (foundDays !== expectedDays)
      fail(sheet.name, 0, 1, 'incomplete_month', `Expected days 1–${expectedDays}, found ${foundDays} consecutive day rows.`);
  }
  for (const chosen of selection) {
    if (!sheets.some(sheet => sheet.name === chosen)) fail(chosen, 0, 0, 'missing_sheet', 'Selected sheet not found.');
  }
  return { entries, issues, unknownTokens: [...unknown].map(([token, count]) => ({ token, count }))
    .sort((a, b) => b.count - a.count), autoDateCount, rolloverRowsSkipped,
    ready: issues.length === 0 && entries.length > 0 };
}
