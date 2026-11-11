import { useMemo, useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { todayBudapest } from '@/lib/budapestTime';
import { canonicalRdHotelId } from '@/lib/rdSchedulingHotels';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Review-first import for the existing RD Hotels workbook format:
 * row 1 departments, row 2 employee names, column A day of month.
 * Never infer leave from SZ/K codes or reinterpret Excel-corrupted dates.
 * Only exact employee matches and unambiguous future clock ranges may
 * become draft shifts, and ONLY after explicit manager confirmation.
 */
type Employee = {
  id: string;
  full_name: string;
  assigned_hotel?: string | null;
};
type ExistingShift = { user_id: string; work_date: string };
type ImportCandidate = {
  employeeId: string;
  employeeName: string;
  date: string;
  start: string;
  end: string;
  hotelId: string;
  sourceName: string;
  column: number;
};
type Preview = {
  source: string;
  candidates: ImportCandidate[];
  ignored: { past: number; unrecognized: number; unmatched: number; duplicates: number; existing: number };
};

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ').trim().toLocaleLowerCase();

const MONTHS: Record<string, number> = {
  january: 1, januar: 1, februar: 2, february: 2, marcius: 3, march: 3,
  aprilis: 4, april: 4, majus: 5, may: 5, junius: 6, june: 6,
  julius: 7, july: 7, augusztus: 8, august: 8, szeptember: 9, september: 9,
  oktober: 10, october: 10, november: 11, december: 12,
};

function monthFromSheet(name: string): { year: number; month: number } | null {
  const normalized = normalize(name);
  const year = Number(normalized.match(/\b20\d{2}\b/)?.[0]);
  const month = Object.entries(MONTHS).find(([label]) => normalized.includes(label))?.[1];
  if (!Number.isInteger(year) || !month) return null;
  return { year, month };
}

function timeFromCell(raw: unknown): { start: string; end: string } | null {
  if (typeof raw !== 'string') return null;
  // Explicit shifts ONLY. e.g. 08-17:30, 20-08, 'éjsz, 20-08'.
  // Date objects and vague 'night', 'SZ', 'K', 'HO', 'off or day' are never guessed.
  const text = raw.trim().replace(/^éjsz\s*[,.:]?\s*/i, '');
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = [Number(match[1]), Number(match[3])];
  const minutes = [Number(match[2] ?? '0'), Number(match[4] ?? '0')];
  if (hours.some(h => h > 23) || minutes.some(m => m > 59)) return null;
  const [start, end] = hours.map((h, index) => `${String(h).padStart(2, '0')}:${String(minutes[index]).padStart(2, '0')}`);
  return start === end ? null : { start, end };
}

function extractPreview(
  table: unknown[][], sheetName: string, employees: Employee[],
  currentShifts: ExistingShift[], currentDate: string,
): Preview {
  const period = monthFromSheet(sheetName);
  const ignored = { past: 0, unrecognized: 0, unmatched: 0, duplicates: 0, existing: 0 };
  if (!period) return { source: sheetName, candidates: [], ignored };
  const names = table[1] ?? [];
  const byName = new Map<string, Employee[]>();
  for (const employee of employees) {
    const key = normalize(employee.full_name);
    byName.set(key, [...(byName.get(key) || []), employee]);
  }
  const existing = new Set(currentShifts.map(shift => `${shift.user_id}|${shift.work_date}`));
  const all: ImportCandidate[] = [];
  for (let rowIndex = 2; rowIndex < table.length; rowIndex++) {
    const row = table[rowIndex] ?? [];
    const day = Number(row[0]);
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    const date = `${period.year}-${String(period.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (new Date(`${date}T12:00:00Z`).getUTCDate() !== day) continue;
    for (let column = 2; column < row.length; column++) {
      const value = row[column];
      if (value === null || value === undefined || String(value).trim() === '') continue;
      if (date <= currentDate) { ignored.past++; continue; }
      const times = timeFromCell(value);
      if (!times) { ignored.unrecognized++; continue; }
      const matches = byName.get(normalize(String(names[column] ?? ''))) || [];
      if (matches.length !== 1 || !canonicalRdHotelId(matches[0].assigned_hotel)) {
        ignored.unmatched++;
        continue;
      }
      const employee = matches[0];
      if (existing.has(`${employee.id}|${date}`)) { ignored.existing++; continue; }
      all.push({
        employeeId: employee.id,
        employeeName: employee.full_name,
        date, start: times.start, end: times.end,
        hotelId: canonicalRdHotelId(employee.assigned_hotel)!,
        sourceName: String(names[column]),
        column,
      });
    }
  }
  const keyCounts = new Map<string, number>();
  for (const item of all) {
    const key = `${item.employeeId}|${item.date}`;
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  const candidates = all.filter(item => {
    const duplicates = keyCounts.get(`${item.employeeId}|${item.date}`) !== 1;
    if (duplicates) ignored.duplicates++;
    return !duplicates;
  });
  return { source: sheetName, candidates, ignored };
}

export function ScheduleExcelImportReview({
  employees, currentShifts, organizationSlug, userId, onImported,
}: {
  employees: Employee[];
  currentShifts: ExistingShift[];
  organizationSlug: string;
  userId: string;
  onImported: () => void;
}) {
  const [tables, setTables] = useState<Record<string, unknown[][]>>({});
  const [sheetName, setSheetName] = useState('');
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const readFile = async (file?: File) => {
    if (!file) return;
    setLoading(true);
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const next: Record<string, unknown[][]> = {};
      for (const name of workbook.SheetNames) {
        if (!monthFromSheet(name)) continue;
        next[name] = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: true, defval: null });
      }
      if (!Object.keys(next).length) throw new Error('No YYYY monthly schedule tabs were found in this workbook.');
      setTables(next);
      setSheetName(Object.keys(next)[0]);
      setFileName(file.name);
      toast.success('Workbook read locally. No schedule changes have been made.');
    } catch (error) {
      setTables({}); setSheetName('');
      toast.error(error instanceof Error ? error.message : 'Could not open workbook');
    } finally { setLoading(false); }
  };

  const preview = useMemo(
    () => extractPreview(tables[sheetName] || [], sheetName, employees, currentShifts, todayBudapest()),
    [tables, sheetName, employees, currentShifts],
  );
  const importDrafts = async () => {
    if (saving || !preview.candidates.length || organizationSlug !== 'rdhotels') return;
    // Recheck all existing records immediately before insertion: never overwrite
    // a manager's already-entered or published shift.
    setSaving(true);
    try {
      const monthKey = preview.candidates[0].date.slice(0, 7);
      const [year, month] = monthKey.split('-').map(Number);
      const finalDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const { data: existing, error: queryError } = await (supabase as any).from('staff_schedules')
        .select('user_id,work_date')
        .eq('organization_slug', organizationSlug)
        .gte('work_date', `${monthKey}-01`)
        .lte('work_date', `${monthKey}-${String(finalDay).padStart(2, '0')}`);
      if (queryError) throw queryError;
      const occupied = new Set((existing || []).map((item: ExistingShift) => `${item.user_id}|${item.work_date}`));
      const accepted = preview.candidates.filter(item => item.date > todayBudapest() && !occupied.has(`${item.employeeId}|${item.date}`));
      // Limit any import to 100 rows; remaining drafts can be imported on the
      // next explicit review. Never publish an imported schedule automatically.
      const batch = accepted.slice(0, 100).map(item => ({
        organization_slug: organizationSlug,
        hotel_id: item.hotelId,
        user_id: item.employeeId,
        work_date: item.date,
        shift_start: item.start,
        shift_end: item.end,
        work_status: 'working',
        status: 'draft',
        created_by: userId,
        notes: 'Imported from approved Excel schedule preview',
      }));
      if (!batch.length) return toast.info('No new future shifts remain after checking existing schedules.');
      const { error } = await (supabase as any).from('staff_schedules').insert(batch);
      if (error) throw error;
      toast.success(`${batch.length} reviewed future shifts imported as drafts. Publish separately after approval.`);
      onImported();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Excel import was not completed');
    } finally { setSaving(false); }
  };

  if (organizationSlug !== 'rdhotels') return null;
  return <Card><CardContent className="space-y-3 p-4">
    <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div><div className="flex items-center gap-2 font-semibold"><FileSpreadsheet className="h-4 w-4 text-primary" />Import Excel work schedule</div>
        <p className="text-xs text-muted-foreground">Existing workbook format · exact employee names · future shifts only · review before drafting</p></div>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
        <Upload className="h-4 w-4" />{loading ? 'Reading…' : 'Choose .xlsx'}
        <input className="sr-only" type="file" accept=".xlsx,.xls" disabled={loading || saving}
          onChange={event => { void readFile(event.target.files?.[0]); event.target.value = ''; }} />
      </label>
    </div>
    {!!fileName && <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="max-w-64 truncate text-muted-foreground">{fileName}</span>
      <select aria-label="Workbook month" value={sheetName} onChange={event => setSheetName(event.target.value)}
        className="rounded-md border bg-background px-2 py-1.5">
        {Object.keys(tables).map(name => <option key={name} value={name}>{name}</option>)}
      </select>
    </div>}
    {!!sheetName && <div className="space-y-2">
      <p className="text-sm"><strong>{preview.candidates.length}</strong> future, uniquely matched clock-range shifts eligible for draft review.
        <span className="text-muted-foreground"> Excluded: {preview.ignored.unrecognized} ambiguous codes,
          {preview.ignored.unmatched} missing/ambiguous employee names,
          {preview.ignored.duplicates} duplicate employee-day entries,
          {preview.ignored.existing} existing shifts,
          {preview.ignored.past} historical entries.</span></p>
      {preview.candidates.length > 0 && <div className="max-h-48 overflow-auto rounded-md border text-xs">
        <table className="w-full"><thead className="sticky top-0 bg-background"><tr><th className="p-2 text-left">Date</th><th className="p-2 text-left">Employee</th><th className="p-2 text-left">Clock range</th></tr></thead>
          <tbody>{preview.candidates.slice(0, 40).map(item => <tr key={`${item.employeeId}|${item.date}`} className="border-t">
            <td className="p-2">{item.date}</td><td className="p-2">{item.employeeName}</td>
            <td className="p-2">{item.start}–{item.end}</td>
          </tr>)}</tbody></table>
      </div>}
      <p className="text-xs text-muted-foreground">This does not convert SZ/K/HO into leave or working days, and it does not import Excel date-formatted cells. Each approved import is a draft; no changes to past or published shifts.</p>
      <Button disabled={saving || !preview.candidates.length} onClick={() => void importDrafts()}>
        {saving ? 'Importing…' : `Import up to ${Math.min(preview.candidates.length, 100)} future drafts`}
      </Button>
    </div>}
  </CardContent></Card>;
}
