import { canonicalRdHotelId } from './rdSchedulingHotels';

export type ExcelEmployee = {
  id: string;
  full_name: string;
  nickname?: string | null;
  assigned_hotel?: string | null;
};

export type ExcelWorkStatus = 'working' | 'off' | 'leave' | 'sick' | 'training';
export type ExcelCodeMapping = 'off' | 'leave' | 'sick' | 'training' | 'ignore';
export type ExcelConfidence = 'clock_range' | 'excel_autodate' | 'mapped_code';

export interface ExcelScheduleCandidate {
  employeeId: string;
  employeeName: string;
  hotelId: string;
  date: string;
  workStatus: ExcelWorkStatus;
  start: string | null;
  end: string | null;
  confidence: ExcelConfidence;
  sheetName: string;
  sourceName: string;
  sourceDepartment: string;
  sourceValue: string;
}

export interface ScheduleExcelParseOptions {
  currentDate: string;
  includeExcelDates?: boolean;
  codeMappings?: Record<string, ExcelCodeMapping>;
  staffMappings?: Record<string, string>;
  existingKeys?: ReadonlySet<string>;
}

export interface ScheduleExcelPreview {
  candidates: ExcelScheduleCandidate[];
  ignored: {
    past: number; unrecognized: number; unmatched: number;
    duplicates: number; existing: number; missingHotel: number;
  };
  unrecognizedCodes: Array<{ code: string; count: number }>;
  unmatchedStaff: Array<{ label: string; department: string; count: number }>;
  parsedMonths: string[];
}

const MONTHS: Record<string, number> = {
  january: 1, januar: 1, february: 2, februar: 2,
  march: 3, marcius: 3, april: 4, aprilis: 4,
  may: 5, majus: 5, june: 6, junius: 6, july: 7, julius: 7,
  august: 8, augusztus: 8, september: 9, szeptember: 9,
  october: 10, oktober: 10, november: 11, december: 12,
};

export function normalizeExcelText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

export function normalizeExcelEmployeeName(name: string): string {
  return normalizeExcelText(name)
    .split('/')[0].trim()
    .replace(/\s+\d+$/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+(?:part[\s-]?time|full[\s-]?time).*$/, '')
    .trim();
}

export function monthFromExcelSheet(name: string): { year: number; month: number } | null {
  const text = normalizeExcelText(name);
  const year = Number(text.match(/\b20\d{2}\b/)?.[0]);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return null;
  const word = text.replace(/\b20\d{2}\b/, '').replace(/[^a-z\s]/g, '').trim();
  const month = Object.entries(MONTHS).find(([label]) => word.includes(label))?.[1];
  return month ? { year, month } : null;
}

function hhmm(hour: number, minute: number): string {
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

export function readExcelClockCell(
  raw: unknown, includeAutoDate = false,
): { start: string; end: string; confidence: 'clock_range' | 'excel_autodate' } | null {
  if (typeof raw === 'number' && includeAutoDate && Number.isInteger(raw) && raw > 40000 && raw < 70000) {
    // Excel's accidental date coercion of "8-17" -> 17-Aug-2023 becomes
    // the month/day of the stored serial. A manager must opt into this mapping.
    const date = new Date(Date.UTC(1899, 11, 30) + raw * 86400000);
    const start = date.getUTCMonth() + 1, end = date.getUTCDate();
    if (start <= 23 && end <= 23 && start !== end) {
      return { start: hhmm(start, 0), end: hhmm(end, 0), confidence: 'excel_autodate' };
    }
    return null;
  }
  if (typeof raw !== 'string') return null;
  // Common workbook notation: '08-17', 'éjsz, 20-08', 'Otto 20-08',
  // '08-20 mika' and '08-17 reci'. Do not guess vague day/night cells.
  const value = normalizeExcelText(raw).replace(/!+$/, '').trim()
    .replace(/^(?:ejsz|night|otto|mika|memo|home office)[,:.\s]+/, '')
    .replace(/\s+(?:mika|memo|otto|reci|gozsdu|home office)$/, '');
  const match = value.match(/^(\d{1,2})(?::([0-5]\d))?\s*[-–]\s*(\d{1,2})(?::([0-5]\d))?$/);
  if (!match) return null;
  const startHour = Number(match[1]), endHour = Number(match[3]);
  const startMin = Number(match[2] ?? 0), endMin = Number(match[4] ?? 0);
  if (startHour > 23 || endHour > 23 || (startHour === endHour && startMin === endMin)) return null;
  return {
    start: hhmm(startHour, startMin), end: hhmm(endHour, endMin), confidence: 'clock_range',
  };
}

function dateFromMonthDay(year: number, month: number, dayValue: unknown): string | null {
  const day = Number(dayValue);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  if (new Date(Date.UTC(year, month - 1, day)).getUTCMonth() !== month - 1) return null;
  return String(year) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

export function previewExcelSchedules(
  worksheets: Record<string, unknown[][]>,
  employees: readonly ExcelEmployee[],
  options: ScheduleExcelParseOptions,
): ScheduleExcelPreview {
  const ignored = { past: 0, unrecognized: 0, unmatched: 0, duplicates: 0, existing: 0, missingHotel: 0 };
  const unrecognized = new Map<string, number>();
  const unmatched = new Map<string, { label: string; department: string; count: number }>();
  const employeesByName = new Map<string, ExcelEmployee[]>();
  const employeesById = new Map(employees.map(employee => [employee.id, employee]));
  const codeMappings = options.codeMappings ?? {};
  const staffMappings = options.staffMappings ?? {};

  for (const employee of employees) {
    for (const key of new Set([normalizeExcelEmployeeName(employee.full_name),
      normalizeExcelEmployeeName(employee.nickname ?? '')].filter(Boolean))) {
      employeesByName.set(key, [...(employeesByName.get(key) || []), employee]);
    }
  }

  const seen = new Map<string, number>();
  const tentative: ExcelScheduleCandidate[] = [];
  const parsedMonths: string[] = [];

  for (const [sheetName, table] of Object.entries(worksheets)) {
    const period = monthFromExcelSheet(sheetName);
    if (!period) continue;
    parsedMonths.push(sheetName);
    const names = table[1] ?? [];
    const departments = table[0] ?? [];
    for (let rowNumber = 2; rowNumber < table.length; rowNumber++) {
      const row = table[rowNumber] ?? [];
      const date = dateFromMonthDay(period.year, period.month, row[0]);
      if (!date) continue;
      for (let column = 2; column < row.length; column++) {
        const raw = row[column];
        if (raw === null || raw === undefined || String(raw).trim() === '') continue;
        if (date < options.currentDate) { ignored.past++; continue; }
        const sourceName = String(names[column] ?? '').trim();
        const department = String(departments[column] ?? '').trim();
        const normalizedName = normalizeExcelEmployeeName(sourceName);
        const manuallyMatchedId = staffMappings[normalizedName];
        const matches = manuallyMatchedId
          ? [employeesById.get(manuallyMatchedId)].filter((e): e is ExcelEmployee => !!e)
          : (employeesByName.get(normalizedName) ?? []);
        if (matches.length !== 1) {
          ignored.unmatched++;
          const label = sourceName || '(unnamed employee)';
          const key = normalizeExcelText(label) + '|' + department;
          const previous = unmatched.get(key);
          unmatched.set(key, { label, department, count: (previous?.count ?? 0) + 1 });
          continue;
        }

        const employee = matches[0];
        const hotelId = canonicalRdHotelId(employee.assigned_hotel);
        if (!hotelId) { ignored.missingHotel++; continue; }
        const code = normalizeExcelText(String(raw));
        const parsed = readExcelClockCell(raw, options.includeExcelDates);
        const mappedStatus = codeMappings[code];
        if (!parsed && (!mappedStatus || mappedStatus === 'ignore')) {
          ignored.unrecognized++;
          unrecognized.set(code, (unrecognized.get(code) ?? 0) + 1);
          continue;
        }

        const key = employee.id + '|' + date;
        if (options.existingKeys?.has(key)) { ignored.existing++; continue; }
        seen.set(key, (seen.get(key) ?? 0) + 1);
        tentative.push({
          employeeId: employee.id, employeeName: employee.full_name, hotelId, date,
          workStatus: parsed ? 'working' : mappedStatus as ExcelWorkStatus,
          start: parsed?.start ?? null, end: parsed?.end ?? null,
          confidence: parsed?.confidence ?? 'mapped_code',
          sheetName, sourceName, sourceDepartment: department, sourceValue: String(raw),
        });
      }
    }
  }

  const candidates = tentative.filter(row => {
    const duplicates = seen.get(row.employeeId + '|' + row.date)! > 1;
    if (duplicates) ignored.duplicates++;
    return !duplicates;
  });

  return {
    candidates, ignored,
    unrecognizedCodes: [...unrecognized].map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count).slice(0, 25),
    unmatchedStaff: [...unmatched.values()].sort((a, b) => b.count - a.count).slice(0, 30),
    parsedMonths,
  };
}
