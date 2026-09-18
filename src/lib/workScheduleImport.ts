/** Local-only roster validation. Do not send uploaded workbook cells to a server. */
export type RosterCell = string | number | boolean | null | undefined;
export type RosterRows = RosterCell[][];
export type RosterKind = 'work' | 'off' | 'leave' | 'training' | 'unavailable';
export type ApprovedCode = Exclude<RosterKind, 'work'>;
export type RosterColumnMapping = { staffId: string; hotelId: string };
export type RosterStaff = { id: string; hotelId: string };
export type DryRunOptions = {
  month: string;
  hotelId: string;
  /** Excel columns are zero-based: employee columns begin at column 2. */
  columns: Record<number, RosterColumnMapping | undefined>;
  eligibleStaff: RosterStaff[];
  /** Only HR-reviewed code definitions belong here; no implicit Hungarian abbreviations. */
  approvedCodes?: Record<string, ApprovedCode>;
};
export type RosterDraft = {
  staffId: string; hotelId: string; shiftDate: string; slot: number;
  kind: RosterKind; startLocal: string | null; endLocal: string | null;
  endDayOffset: 0 | 1; sourceColumn: number; sourceRow: number;
};
export type RosterImportIssue = {
  code: 'invalid_month' | 'invalid_day' | 'unmapped_employee' | 'wrong_venue' |
    'unauthorized_employee' | 'unknown_value' | 'invalid_shift' | 'duplicate_assignment' |
    'duplicate_name' | 'invalid_codebook' | 'invalid_day_row';
  row: number; column: number; detail: string;
};
export type RosterDryRun = {
  entries: RosterDraft[];
  issues: RosterImportIssue[];
  scannedCells: number;
  ready: boolean;
};

const TIME = /^(\d{1,2}):(\d{2})$/;
const SHIFT = /^(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})(?:\s*\(\+1\))?$/;
const VALID_KINDS = new Set<ApprovedCode>(['off', 'leave', 'training', 'unavailable']);

function normalTime(value: string): string | null {
  const match = TIME.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60
    ? `${String(hours).padStart(2, '0')}:${match[2]}` : null;
}

function parseShift(value: string): Omit<RosterDraft, 'staffId' | 'hotelId' | 'shiftDate' | 'slot' | 'sourceColumn' | 'sourceRow'> | null {
  const match = SHIFT.exec(value);
  if (!match) return null;
  const startLocal = normalTime(match[1]);
  const endLocal = normalTime(match[2]);
  if (!startLocal || !endLocal) return null;
  const endDayOffset: 0 | 1 = value.endsWith('(+1)') ? 1 : 0;
  // Overnight shifts must say (+1). Never invent a next-day end from a short clock value.
  if (!endDayOffset && endLocal <= startLocal) return null;
  // No zero-length or 24-hour shifts, even if explicitly marked next-day.
  if (endDayOffset && endLocal >= startLocal) return null;
  return { kind: 'work', startLocal, endLocal, endDayOffset };
}

/**
 * Converts a single selected month to a deterministic, write-free dry run.
 * Source: first row department/venue, second row staff, column A day of month.
 * Caller MUST obtain eligibleStaff through the hotel's authorized server RPC.
 * A ready result is a review candidate, not permission to upload or publish.
 */
export function dryRunRoster(rows: RosterRows, opts: DryRunOptions): RosterDryRun {
  const issues: RosterImportIssue[] = [];
  const entries: RosterDraft[] = [];
  const eligible = new Map(opts.eligibleStaff.map(person => [person.id, person.hotelId]));
  const fail = (code: RosterImportIssue['code'], row: number, column: number, detail: string) =>
    issues.push({ code, row, column, detail });
  const monthMatch = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(opts.month);
  if (!monthMatch) {
    fail('invalid_month', 0, 0, 'Select a valid YYYY-MM month.');
    return { entries, issues, scannedCells: 0, ready: false };
  }
  const daysInMonth = new Date(Date.UTC(Number(monthMatch[1]), Number(monthMatch[2]), 0)).getUTCDate();
  const lastColumn = Math.max(2, ...rows.map(row => row?.length ?? 0));
  const seenNames = new Map<string, number>();
  const seenAssignments = new Set<string>();
  let scannedCells = 0;
  const codebook = new Map<string, ApprovedCode>();
  for (const [token, kind] of Object.entries(opts.approvedCodes ?? {})) {
    const normalized = token.trim().toLocaleUpperCase('hu-HU');
    if (!normalized || !VALID_KINDS.has(kind)) fail('invalid_codebook', 0, 0, 'A code definition is missing or invalid.');
    else codebook.set(normalized, kind);
  }
  for (let col = 2; col < lastColumn; col++) {
    const name = String(rows[1]?.[col] ?? '').trim();
    const hasValues = rows.slice(2).some(row => row && row[col] !== null && row[col] !== undefined && String(row[col]).trim() !== '');
    if (!name && !hasValues) continue;
    const normalizedName = name.toLocaleLowerCase('hu-HU');
    if (name) {
      const firstColumn = seenNames.get(normalizedName);
      if (firstColumn !== undefined) fail('duplicate_name', 2, col + 1, `Duplicate display name in columns ${firstColumn + 1} and ${col + 1}; map each column to an employee ID.`);
      else seenNames.set(normalizedName, col);
    }
    const mapping = opts.columns[col];
    if (!mapping?.staffId || !mapping.hotelId) {
      fail('unmapped_employee', 2, col + 1, 'Explicit employee ID and venue mapping required.');
      continue;
    }
    if (mapping.hotelId !== opts.hotelId) {
      fail('wrong_venue', 1, col + 1, 'This column is not mapped to the selected venue.');
      continue;
    }
    if (eligible.get(mapping.staffId) !== opts.hotelId) {
      fail('unauthorized_employee', 2, col + 1, 'Employee is not authorized for the selected venue.');
      continue;
    }
    for (let rowIndex = 2; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex] ?? [];
      const raw = row[col];
      if (raw === null || raw === undefined || String(raw).trim() === '') continue;
      scannedCells++;
      const dayValue = rows[rowIndex]?.[0];
      const day = typeof dayValue === 'number' ? dayValue : Number(String(dayValue ?? '').trim());
      if (!Number.isInteger(day) || day < 1 || day > daysInMonth) {
        fail('invalid_day_row', rowIndex + 1, col + 1, 'Value is outside a valid day row for the selected month.');
        continue;
      }
      const token = typeof raw === 'string' ? raw.trim() : '';
      if (!token) {
        fail('unknown_value', rowIndex + 1, col + 1, 'Numeric, formula, boolean or non-text cell needs manual review.');
        continue;
      }
      const parsed = parseShift(token);
      const approvedKind = codebook.get(token.toLocaleUpperCase('hu-HU'));
      if (!parsed && !approvedKind) {
        fail('unknown_value', rowIndex + 1, col + 1, 'Unrecognized shift/leave code; no hours or leave were inferred.');
        continue;
      }
      const shiftDate = `${opts.month}-${String(day).padStart(2, '0')}`;
      const identity = `${mapping.staffId}/${shiftDate}`;
      if (seenAssignments.has(identity)) {
        fail('duplicate_assignment', rowIndex + 1, col + 1, 'More than one source cell targets this employee/date; review before import.');
        continue;
      }
      seenAssignments.add(identity);
      entries.push({
        staffId: mapping.staffId, hotelId: mapping.hotelId, shiftDate, slot: 1,
        kind: parsed?.kind ?? approvedKind!, startLocal: parsed?.startLocal ?? null,
        endLocal: parsed?.endLocal ?? null, endDayOffset: parsed?.endDayOffset ?? 0,
        sourceColumn: col + 1, sourceRow: rowIndex + 1,
      });
    }
  }
  // Never allow even apparently valid rows to be saved while any source ambiguity remains.
  return { entries, issues, scannedCells, ready: entries.length > 0 && issues.length === 0 };
}
