import { useMemo, useState } from 'react';
import { FileSpreadsheet, Upload, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { todayBudapest } from '@/lib/budapestTime';
import {
  ExcelEmployee, ExcelCodeMapping, ExcelScheduleCandidate,
  monthFromExcelSheet, normalizeExcelEmployeeName, normalizeExcelText,
  previewExcelSchedules,
} from '@/lib/scheduleExcelParser';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type ExistingShift = { user_id: string; work_date: string };

const BATCH_SIZE = 100;

/** Upload a staff workbook and turn reviewed, confidently matched future cells
 * into draft shifts. Import never changes existing or published assignments. */
export function ScheduleExcelImportReview({
  employees, currentShifts, organizationSlug, userId, canImportHistory, onImported,
}: {
  employees: ExcelEmployee[];
  currentShifts: ExistingShift[];
  organizationSlug: string;
  userId: string;
  canImportHistory?: boolean;
  onImported: () => void;
}) {
  const [tables, setTables] = useState<Record<string, unknown[][]>>({});
  const [selectedSheet, setSelectedSheet] = useState('all');
  const [fileName, setFileName] = useState('');
  const [recoverExcelDates, setRecoverExcelDates] = useState(false);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [codeMappings, setCodeMappings] = useState<Record<string, ExcelCodeMapping>>({});
  const [staffMappings, setStaffMappings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState('');
  const [approval, setApproval] = useState(false);

  const readFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast.error('The workbook is larger than 15 MB. Please upload a smaller schedule.');
      return;
    }
    setLoading(true);
    try {
      const XLSX = await import('xlsx');
      // cellDates:false retains serial values such as 45155 so managers can
      // explicitly approve their conversion into 08:00–17:00.
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
      const next: Record<string, unknown[][]> = {};
      for (const sheetName of workbook.SheetNames) {
        if (!monthFromExcelSheet(sheetName)) continue;
        next[sheetName] = XLSX.utils.sheet_to_json<unknown[]>(
          workbook.Sheets[sheetName], { header: 1, raw: true, defval: null },
        );
      }
      if (!Object.keys(next).length) throw new Error('No month-year tabs found, such as November 2026.');
      setTables(next);
      setSelectedSheet('all');
      setFileName(file.name);
      setCodeMappings({});
      setStaffMappings({});
      setRecoverExcelDates(false);
      setIncludeHistory(false);
      setApproval(false);
      setProgress('');
      toast.success('Excel read successfully. Preview the detected shifts and approve automatic filling.');
    } catch (cause) {
      setTables({}); setFileName('');
      toast.error(cause instanceof Error ? cause.message : 'Could not open the workbook');
    } finally { setLoading(false); }
  };

  const scoped = useMemo(
    () => selectedSheet === 'all' ? tables : { [selectedSheet]: tables[selectedSheet] ?? [] },
    [tables, selectedSheet],
  );
  const preview = useMemo(() => previewExcelSchedules(
    scoped, employees, {
      currentDate: todayBudapest(),
      includeExcelDates: recoverExcelDates,
      includeHistorical: canImportHistory && includeHistory,
      codeMappings, staffMappings,
      existingKeys: new Set(currentShifts.map(shift => shift.user_id + '|' + shift.work_date)),
    },
  ), [scoped, employees, recoverExcelDates, canImportHistory, includeHistory, codeMappings, staffMappings, currentShifts]);

  const candidateCounts = useMemo(() => preview.candidates.reduce(
    (result, item) => {
      result[item.confidence] = (result[item.confidence] ?? 0) + 1;
      return result;
    }, {} as Record<string, number>,
  ), [preview.candidates]);

  const changeMapping = (key: string, value: string) => {
    setApproval(false);
    setCodeMappings(current => ({ ...current, [key]: value as ExcelCodeMapping }));
  };

  const importFutureDrafts = async () => {
    if (saving || !approval || !preview.candidates.length || organizationSlug !== 'rdhotels') return;
    setSaving(true);
    setProgress('Checking previously saved schedules…');
    try {
      const all = [...preview.candidates].sort((a, b) => a.date.localeCompare(b.date));
      const firstDate = all[0].date;
      const lastDate = all[all.length - 1].date;
      const occupied = new Set<string>();
      // Supabase PostgREST defaults to 1,000 rows. Paginate to avoid
      // accidentally missing an existing shift and then overwriting it.
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await (supabase as any).from('staff_schedules')
          .select('user_id,work_date')
          .eq('organization_slug', organizationSlug)
          .gte('work_date', firstDate)
          .lte('work_date', lastDate)
          .order('id')
          .range(offset, offset + 999);
        if (error) throw new Error(error.message);
        for (const shift of (data ?? []) as ExistingShift[]) {
          occupied.add(shift.user_id + '|' + shift.work_date);
        }
        if ((data?.length ?? 0) < 1000) break;
      }
      const candidates = all.filter(item => !occupied.has(item.employeeId + '|' + item.date));
      const future = candidates.filter(item => item.date >= todayBudapest());
      const history = canImportHistory && includeHistory
        ? candidates.filter(item => item.date < todayBudapest()) : [];
      if (!future.length && !history.length) {
        toast.info('All approved schedule cells have already been filled.');
        return;
      }

      let archived = 0;
      // Historical rows are inserted solely by a limited, audited HR/executive
      // function. Direct changes to past rosters remain blocked by database RLS.
      for (let from = 0; from < history.length; from += BATCH_SIZE) {
        const rows = history.slice(from, from + BATCH_SIZE).map(item => ({
          user_id: item.employeeId, hotel_id: item.hotelId,
          work_date: item.date, work_status: item.workStatus,
          shift_start: item.start, shift_end: item.end,
        }));
        const { data, error } = await (supabase as any).rpc('rd_import_historical_staff_schedules', {
          _rows: rows, _source_file: fileName.slice(0, 200),
        });
        if (error) throw new Error(error.message);
        archived += Number(data || 0);
        setProgress('Archived ' + archived + ' historical shifts');
      }

      let saved = 0;
      for (let from = 0; from < future.length; from += BATCH_SIZE) {
        const batch = future.slice(from, from + BATCH_SIZE).map((item: ExcelScheduleCandidate) => ({
          organization_slug: organizationSlug,
          hotel_id: item.hotelId,
          user_id: item.employeeId,
          work_date: item.date,
          shift_start: item.start,
          shift_end: item.end,
          work_status: item.workStatus,
          status: 'draft',
          created_by: userId,
          notes: 'Imported from approved Excel schedule: ' + item.sheetName +
            ' (' + item.sourceDepartment + ', ' + item.sourceValue.slice(0, 64) + ')',
        }));
        const { error } = await (supabase as any).from('staff_schedules').insert(batch);
        if (error) throw new Error(error.message);
        saved += batch.length;
        setProgress('Filled ' + saved + ' of ' + future.length + ' future drafts; ' +
          archived + ' historical shifts archived');
      }
      toast.success('Excel filled ' + saved + ' future drafts and ' + archived +
        ' read-only historical shifts. Review future drafts before publishing.');
      setProgress('Completed: ' + saved + ' drafts and ' + archived +
        ' archived shifts. Existing schedules were not modified.');
      setApproval(false);
      onImported();
    } catch (cause) {
      toast.error((cause instanceof Error ? cause.message : 'Import failed') +
        '. If some batches succeeded, reload to see which drafts were saved.');
    } finally { setSaving(false); }
  };

  if (organizationSlug !== 'rdhotels') return null;
  return <Card><CardContent className="space-y-4 p-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2 font-semibold">
          <FileSpreadsheet className="h-5 w-5 text-primary" />Upload Excel and auto-fill the roster
        </div>
        <p className="text-xs text-muted-foreground">
          Supports RD Hotels workbooks with monthly tabs, department headings and employee columns.
          Reads locally; no Excel file is uploaded to a storage server.
        </p>
      </div>
      <label className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">
        <Upload className="h-4 w-4" />{loading ? 'Reading…' : 'Choose Excel file'}
        <input className="sr-only" type="file" accept=".xlsx,.xls" disabled={loading || saving}
          onChange={event => { void readFile(event.target.files?.[0]); event.target.value = ''; }} />
      </label>
    </div>
    {!!fileName && <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="max-w-64 truncate text-sm font-medium">{fileName}</span>
        <label className="flex items-center gap-2 text-sm">
          Import period
          <select className="rounded border bg-background px-2 py-1.5"
            value={selectedSheet} disabled={saving}
            onChange={event => { setSelectedSheet(event.target.value); setApproval(false); }}>
            <option value="all">All monthly tabs ({Object.keys(tables).length})</option>
            {Object.keys(tables).map(sheet => <option key={sheet} value={sheet}>{sheet}</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="rounded border p-3"><div className="text-xl font-semibold">{preview.candidates.length}</div><div className="text-xs text-muted-foreground">Ready to auto-fill</div></div>
        <div className="rounded border p-3"><div className="text-xl font-semibold">{candidateCounts.clock_range || 0}</div><div className="text-xs text-muted-foreground">Explicit time ranges</div></div>
        <div className="rounded border p-3"><div className="text-xl font-semibold">{preview.ignored.unmatched}</div><div className="text-xs text-muted-foreground">Unmatched employee cells</div></div>
        <div className="rounded border p-3"><div className="text-xl font-semibold">{preview.ignored.unrecognized}</div><div className="text-xs text-muted-foreground">Codes needing mapping</div></div>
      </div>
      <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm">
        <input type="checkbox" checked={recoverExcelDates} disabled={saving}
          onChange={event => { setRecoverExcelDates(event.target.checked); setApproval(false); }} />
        <span>
          <strong>Recover Excel-autoconverted time ranges</strong>
          <span className="block text-xs text-muted-foreground">
            For example, Excel sometimes changes 08–17 to a date serial. Interpret its month/day as 08:00–17:00.
            Enable only after checking the preview. {candidateCounts.excel_autodate || 0} such shifts currently selected.
          </span>
        </span>
      </label>
      {canImportHistory && <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm">
        <input type="checkbox" checked={includeHistory} disabled={saving}
          onChange={event => { setIncludeHistory(event.target.checked); setApproval(false); }} />
        <span><strong>Include historical schedules as read-only archive</strong>
          <span className="block text-xs text-muted-foreground">
            HR and executives can include past Excel schedules. They become permanently read-only
            roster records, not actual attendance or payroll hours.
          </span></span>
      </label>}
      {!!preview.unrecognizedCodes.length && <details className="rounded-md border p-3">
        <summary className="cursor-pointer font-medium text-sm">Map absence codes (optional)</summary>
        <p className="my-2 text-xs text-muted-foreground">Unknown codes are skipped until you explicitly choose their meaning. Do not assume SZ, K, HO, B or any other abbreviation means a particular leave type.</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {preview.unrecognizedCodes.map(item => <label key={item.code} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate" title={item.code}>{item.code} ({item.count})</span>
            <select value={codeMappings[normalizeExcelText(item.code)] || 'ignore'} disabled={saving}
              className="min-w-32 rounded border bg-background p-1.5"
              onChange={event => changeMapping(normalizeExcelText(item.code), event.target.value)}>
              <option value="ignore">Skip / unknown</option><option value="leave">Leave</option>
              <option value="sick">Sick</option><option value="off">Day off</option>
              <option value="training">Training</option>
            </select>
          </label>)}
        </div>
      </details>}
      {!!preview.unmatchedStaff.length && <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">Match Excel names to existing staff (optional)</summary>
        <p className="my-2 text-xs text-muted-foreground">Choose a profile only if you are sure it is the same person. Unmatched people are not created automatically.</p>
        <div className="grid gap-2 lg:grid-cols-2">
          {preview.unmatchedStaff.map(item => <label key={item.label + item.department} className="flex flex-col gap-1 text-xs">
            <span>{item.label} · {item.department} ({item.count})</span>
            <select value={staffMappings[normalizeExcelEmployeeName(item.label)] || ''}
              disabled={saving} className="rounded border bg-background p-1.5"
              onChange={event => {
                setStaffMappings(previous => ({
                  ...previous,
                  [normalizeExcelEmployeeName(item.label)]: event.target.value,
                }));
                setApproval(false);
              }}>
              <option value="">Keep unmatched</option>
              {employees.map(employee =>
                <option key={employee.id} value={employee.id}>{employee.full_name} — {employee.assigned_hotel || 'No property'}</option>)}
            </select>
          </label>)}
        </div>
      </details>}
      <div className="rounded-md border p-3 text-xs text-muted-foreground">
        Excluded: {preview.ignored.past} historical cells, {preview.ignored.existing} existing schedule cells,
        {preview.ignored.duplicates} repeated employee/day matches, and {preview.ignored.missingHotel} profiles without a base hotel.
        Unmatched or ambiguous entries are never guessed or overwritten.
      </div>
      {!!preview.candidates.length && <div className="max-h-64 overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background"><tr>
            <th className="p-2 text-left">Date</th><th className="p-2 text-left">Employee</th>
            <th className="p-2 text-left">Source</th><th className="p-2 text-left">Detected schedule</th>
          </tr></thead>
          <tbody>{preview.candidates.slice(0, 60).map((item, i) =>
            <tr key={item.employeeId + item.date + i} className="border-t">
              <td className="p-2">{item.date}</td><td className="p-2">{item.employeeName}</td>
              <td className="p-2">{item.sourceValue}</td>
              <td className="p-2">{item.workStatus === 'working' ? item.start + '–' + item.end : item.workStatus}
                {item.confidence === 'excel_autodate' && <span className="ml-1 text-amber-700">(recovered)</span>}
              </td>
            </tr>)}
          </tbody>
        </table>
        {preview.candidates.length > 60 && <p className="p-2 text-xs text-muted-foreground">Showing first 60 of {preview.candidates.length} rows</p>}
      </div>}
      {candidateCounts.excel_autodate > 0 && <p className="flex items-start gap-2 text-xs text-amber-700">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        You included {candidateCounts.excel_autodate} shifts inferred from Excel date conversion. Compare a sample with the original workbook before approving.
      </p>}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={approval} disabled={saving || preview.candidates.length === 0}
          onChange={event => setApproval(event.target.checked)} />
        <span>I reviewed the matches and authorize filling future shifts as <strong>drafts</strong>{includeHistory && canImportHistory ? ' and past shifts as read-only archives.' : '.'}</span>
      </label>
      <Button disabled={saving || !approval || !preview.candidates.length}
        onClick={() => void importFutureDrafts()} className="gap-2">
        <CheckCircle2 className="h-4 w-4" />
        {saving ? 'Filling schedule…' : 'Auto-fill ' + preview.candidates.length + ' schedule cells'}
      </Button>
      {!!progress && <p aria-live="polite" className="text-xs text-muted-foreground">{progress}</p>}
      <p className="text-xs text-muted-foreground">
        The uploaded workbook is not stored. This action fills schedules only after review;
        it does not publish future shifts or start Housekeeping Auto Assign.
        Historical entries use an audited executive/HR-only import.
      </p>
    </div>}
  </CardContent></Card>;
}
