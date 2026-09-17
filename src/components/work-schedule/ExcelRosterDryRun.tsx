import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { dryRunRoster, type RosterRows } from '@/lib/workScheduleImport';

type Person = { id: string; full_name: string; role: string };
type Props = { hotelId: string; month: string; staff: Person[] };
type SourceSheet = { name: string; rows: RosterRows };
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const toMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Browser-only dry run. File bytes and employee cells never leave this component. */
export function ExcelRosterDryRun({ hotelId, month, staff }: Props) {
  const [filename, setFilename] = useState('');
  const [sheets, setSheets] = useState<SourceSheet[]>([]);
  const [sheetName, setSheetName] = useState('');
  const [assignments, setAssignments] = useState<Record<number, string>>({});
  const [fileError, setFileError] = useState('');
  const [reading, setReading] = useState(false);
  useEffect(() => {
    setFilename(''); setSheets([]); setSheetName(''); setAssignments({}); setFileError('');
  }, [hotelId, month]);

  const currentSheet = sheets.find(sheet => sheet.name === sheetName);
  const columns = useMemo(() => {
    if (!currentSheet) return [];
    const rows = currentSheet.rows;
    const width = Math.max(0, ...rows.map(row => row.length));
    return Array.from({ length: Math.max(0, width - 2) }, (_, i) => i + 2)
      .filter(index => Boolean(String(rows[1]?.[index] ?? '').trim()) ||
        rows.slice(2).some(row => String(row[index] ?? '').trim() !== ''))
      .map(index => ({ index, person: String(rows[1]?.[index] ?? '').trim(),
        department: String(rows[0]?.[index] ?? '').trim() }));
  }, [currentSheet]);

  const expectedMonth = MONTHS[Number(month.slice(5, 7)) - 1];
  const matchingMonth = Boolean(expectedMonth && sheetName.toUpperCase().includes(expectedMonth));
  const unmapped = columns.filter(column => !assignments[column.index]).length;
  const reviewedRows = currentSheet?.rows.map(row => row.map((value, col) => assignments[col] === '__exclude__' ? '' : value)) ?? [];
  const mappedColumns = Object.fromEntries(Object.entries(assignments)
    .filter(([, value]) => value && value !== '__exclude__')
    .map(([col, staffId]) => [Number(col), { staffId, hotelId }]));
  const review = useMemo(() => currentSheet && matchingMonth && unmapped === 0
    ? dryRunRoster(reviewedRows, {
      month, hotelId, columns: mappedColumns,
      eligibleStaff: staff.map(person => ({ id: person.id, hotelId })),
    }) : null,
    // Rows are read only into memory; no database mutation occurs on re-evaluation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentSheet, matchingMonth, month, hotelId, staff, assignments, unmapped]);

  const load = async (file?: File) => {
    setFilename(''); setSheets([]); setSheetName(''); setAssignments({}); setFileError('');
    if (!file) return;
    if (!/\.(xls|xlsx)$/i.test(file.name) || file.size > 8 * 1024 * 1024 || file.size === 0) {
      setFileError('Select a nonempty XLS/XLSX file no larger than 8 MB.'); return;
    }
    setReading(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), {
        type: 'array', bookVBA: false, cellDates: false,
      });
      const parsed: SourceSheet[] = workbook.SheetNames.map(name => {
        const worksheet = workbook.Sheets[name];
        if (Object.values(worksheet).some(cell => typeof cell === 'object' && cell !== null && 'f' in cell)) {
          throw new Error(`Sheet ${name} contains formulas. Review a values-only copy before importing.`);
        }
        return { name, rows: XLSX.utils.sheet_to_json<RosterRows[number]>(worksheet,
          { header: 1, raw: true, defval: '' }) };
      });
      setSheets(parsed); setFilename(file.name);
      setSheetName(parsed.find(sheet => expectedMonth && sheet.name.toUpperCase().includes(expectedMonth))?.name ?? parsed[0]?.name ?? '');
    } catch (error) { setFileError(`Excel review unavailable: ${toMessage(error)}`); }
    finally { setReading(false); }
  };

  return <Card>
    <CardHeader><CardTitle>Excel import review · no database writes</CardTitle></CardHeader>
    <CardContent className="space-y-4 text-sm">
      <p>All workbook processing happens locally in this browser. Select the exact month and explicitly map every named source column to a staff account or exclude it. No name, venue or leave code is guessed, and nothing can be imported from this review screen.</p>
      <Input aria-label="Excel roster file" type="file" accept=".xls,.xlsx" disabled={!hotelId || reading}
        onChange={event => void load(event.target.files?.[0])} />
      {reading && <p role="status">Inspecting local spreadsheet…</p>}
      {fileError && <p role="alert" className="text-destructive">{fileError}</p>}
      {sheets.length > 0 && <>
        <p className="font-medium">{filename} · {sheets.length} sheets found</p>
        <label className="block">Source worksheet
          <select aria-label="Source worksheet" className="block mt-1 h-10 w-full max-w-md rounded-md border bg-background px-3"
            value={sheetName} onChange={event => { setSheetName(event.target.value); setAssignments({}); }}>
            {sheets.map(sheet => <option key={sheet.name} value={sheet.name}>{sheet.name}</option>)}
          </select>
        </label>
        {!matchingMonth && <p role="alert" className="text-destructive">The sheet title does not match selected month {month}. Select the correct monthly sheet; templates or unknown titles cannot pass the review.</p>}
        {matchingMonth && <>
          <div className="flex flex-wrap gap-3 rounded-md border p-3">
            <span>Source columns: <strong>{columns.length}</strong></span>
            <span>Mappings required: <strong>{unmapped}</strong></span>
            <span>Explicitly excluded: <strong>{columns.filter(column => assignments[column.index] === '__exclude__').length}</strong></span>
          </div>
          <div className="max-h-80 overflow-auto space-y-2 border rounded-md p-2" aria-label="Source column mapping">
            {columns.map(column => <label key={column.index} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
              <span className="min-w-0">Column {column.index + 1} · {column.person || '(unnamed)'} <span className="text-muted-foreground">{column.department}</span></span>
              <select aria-label={`Map column ${column.index + 1}`} value={assignments[column.index] ?? ''}
                onChange={event => setAssignments(old => ({ ...old, [column.index]: event.target.value }))}
                className="h-9 min-w-44 max-w-full rounded-md border bg-background px-2">
                <option value="">Mapping required</option>
                <option value="__exclude__">Exclude — other venue / non-staff</option>
                {staff.map(person => <option key={person.id} value={person.id}>{person.full_name} ({person.role})</option>)}
              </select>
            </label>)}
          </div>
          {review && <div className="space-y-2 rounded-md border p-3" aria-live="polite">
            <p><strong>{review.ready ? 'Mapping review complete — not imported' : 'Import blocked: exceptions require correction'}</strong></p>
            <p>{review.scannedCells} source cells examined · {review.entries.length} recognized entries · {review.issues.length} exceptions.</p>
            {review.issues.length > 0 && <div className="max-h-56 overflow-auto">
              {review.issues.slice(0, 50).map((issue, index) => <p key={`${issue.row}-${issue.column}-${index}`} className="border-t py-1">
                Row {issue.row}, column {issue.column}: {issue.code.replaceAll('_', ' ')} — {issue.detail}
              </p>)}
              {review.issues.length > 50 && <p>{review.issues.length - 50} additional exceptions. Correct the source copy before importing.</p>}
            </div>}
            <p className="text-muted-foreground">A successful local review does not write or publish schedules. HR-approved code dictionaries, atomic import and rollback remain mandatory release gates.</p>
          </div>}
          {unmapped > 0 && <Button type="button" variant="outline" disabled>Map all columns to run validation</Button>}
        </>}
      </>}
    </CardContent>
  </Card>;
}
