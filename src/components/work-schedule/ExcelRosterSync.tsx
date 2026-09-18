import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { RosterRows } from '@/lib/workScheduleImport';
import { rosterIdentityKey, type ConfirmedRosterLink } from '@/lib/workScheduleIdentity';
import { sameScheduleShift, type ExistingScheduleShift } from '@/lib/workScheduleDiff';
import { buildWorkbookPlan, codeKey, rosterHeaderVenues, rosterSheetMonth,
  type RosterSheet, type ShiftRule, type WorkbookShift } from '@/lib/workScheduleWorkbook';

type Props = {
  hotelId: string; month: string;
  staff: { id: string; full_name: string; role: string }[];
  onImported: () => void;
};
type Snapshot = { plan: ReturnType<typeof buildWorkbookPlan>; payload: Record<string, unknown>[];
  created: number; changed: number; unchanged: number; conflicts: string[] };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const cellId = (sheet: string, column: number) => `${sheet}::${column}`;
const rowId = (row: Pick<WorkbookShift, 'staff_id' | 'shift_date' | 'slot'>) =>
  `${row.staff_id}/${row.shift_date}/${row.slot}`;

/** The original XLSX is processed locally. Only canonical rows from an
 * authorized, explicit comparison are sent to the hotel-scoped atomic RPC. */
export function ExcelRosterSync({ hotelId, month, staff, onImported }: Props) {
  const [sheets, setSheets] = useState<RosterSheet[]>([]);
  const [filename, setFilename] = useState('');
  const [links, setLinks] = useState<ConfirmedRosterLink[]>([]);
  const [identityReady, setIdentityReady] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [codebook, setCodebook] = useState<Record<string, ShiftRule>>({});
  const [acceptDates, setAcceptDates] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [identityRefresh, setIdentityRefresh] = useState(0);

  useEffect(() => {
    setSheets([]); setFilename(''); setSelected([]); setOverrides({});
    setCodebook({}); setAcceptDates(false); setSnapshot(null); setError(''); setNotice('');
  }, [hotelId, month]);
  useEffect(() => {
    let active = true;
    setIdentityReady(false); setLinks([]); setSnapshot(null);
    if (!hotelId) return () => { active = false; };
    void (async () => {
      const { data, error: requestError } = await (supabase.from('work_schedule_employee_links' as any) as any)
        .select('id,source_label,staff_id').eq('organization_slug', 'rdhotels').eq('hotel_id', hotelId);
      if (requestError) throw requestError;
      if (!active) return;
      setLinks((data ?? []) as ConfirmedRosterLink[]); setIdentityReady(true);
    })().catch(caught => { if (active) setError(`Cannot load confirmed employee links: ${errorText(caught)}`); });
    return () => { active = false; };
  }, [hotelId, identityRefresh]);

  const datedSheets = useMemo(() => sheets.filter(sheet => rosterSheetMonth(sheet.name)), [sheets]);
  const accountIds = useMemo(() => staff.map(person => person.id), [staff]);
  const aliasLookup = useMemo(() => new Map(links.map(link =>
    [rosterIdentityKey(link.source_label), link.staff_id])), [links]);
  const columns = useMemo(() => datedSheets.flatMap(sheet => {
    if (!selected.includes(sheet.name)) return [];
    const width = Math.max(0, ...sheet.rows.slice(0, 34).map(row => row.length));
    return Array.from({ length: Math.max(0, width - 2) }, (_, i) => i + 2)
      .filter(column => String(sheet.rows[1]?.[column] ?? '').trim())
      .map(column => {
        const label = String(sheet.rows[1]?.[column] ?? '').trim();
        const department = String(sheet.rows[0]?.[column] ?? '').trim();
        const venues = rosterHeaderVenues(department);
        const account = aliasLookup.get(rosterIdentityKey(label));
        const strictlyTarget = venues.length === 1 && venues[0] === hotelId;
        const otherHotel = (venues.length === 1 && venues[0] !== hotelId) ||
          (venues.length > 1 && !venues.includes(hotelId));
        const included = !otherHotel && (overrides[cellId(sheet.name, column)] ?? strictlyTarget);
        return { sheet: sheet.name, column, label, department, account, included,
          otherHotel, shared: !strictlyTarget && !otherHotel };
      });
  }), [datedSheets, selected, aliasLookup, hotelId, overrides]);
  const includedColumns = useMemo(() => Object.fromEntries(selected.map(sheetName => [sheetName,
    columns.filter(column => column.sheet === sheetName && column.included).map(column => column.column)])),
  [selected, columns]);
  const plan = useMemo(() => buildWorkbookPlan(sheets, {
    hotelId, selectedSheets: selected, includedColumns, savedLinks: links,
    authorizedAccountIds: accountIds, codebook, acceptAutoFormattedDates: acceptDates,
  }), [sheets, hotelId, selected, includedColumns, links, accountIds, codebook, acceptDates]);

  const load = async (file?: File) => {
    setSheets([]); setFilename(''); setSelected([]); setOverrides({}); setCodebook({});
    setAcceptDates(false); setSnapshot(null); setNotice(''); setError('');
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name) || file.size < 1 || file.size > 8 * 1024 * 1024) {
      setError('Choose a nonempty XLS/XLSX file no larger than 8 MB.'); return;
    }
    setBusy(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), {
        type: 'array', bookVBA: false, cellDates: false, cellNF: true, cellText: true,
      });
      if (workbook.SheetNames.length > 24) throw new Error('Maximum 24 worksheets per upload.');
      let totalArea = 0;
      const parsed: RosterSheet[] = workbook.SheetNames.map(name => {
        const ws = workbook.Sheets[name];
        const dim = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
        totalArea += (dim.e.r + 1) * (dim.e.c + 1);
        if (dim.e.r > 1999 || dim.e.c > 249 || totalArea > 500000)
          throw new Error('Workbook dimensions exceed the safe review limit.');
        const autoDateCells: Record<string, string> = {};
        const formulaCells: string[] = [];
        for (const [address, cell] of Object.entries(ws)) {
          if (address.startsWith('!') || !cell || typeof cell !== 'object') continue;
          const position = XLSX.utils.decode_cell(address);
          const key = `${position.r}:${position.c}`;
          if ('f' in cell) formulaCells.push(key);
          const format = String(cell.z ?? '');
          const displayed = String(cell.w ?? '');
          if (cell.t === 'n' && /^m{1,2}-d{1,2}$/i.test(format) && /^\d{1,2}-\d{1,2}$/.test(displayed))
            autoDateCells[key] = displayed;
        }
        return { name, rows: XLSX.utils.sheet_to_json<RosterRows[number]>(ws,
          { header: 1, raw: true, blankrows: true, defval: '' }), autoDateCells, formulaCells };
      });
      setSheets(parsed); setFilename(file.name);
      setSelected(parsed.filter(sheet => rosterSheetMonth(sheet.name) === month).map(sheet => sheet.name));
    } catch (caught) { setError(`Workbook inspection failed: ${errorText(caught)}`); }
    finally { setBusy(false); }
  };
  const updateRule = (token: string, kind: string) => {
    const key = codeKey(token); setSnapshot(null);
    setCodebook(previous => {
      const next = { ...previous };
      if (!kind) delete next[key];
      else next[key] = kind === 'work'
        ? { kind: 'work', startLocal: '08:00', endLocal: '16:00', endDayOffset: 0, unpaidBreakMinutes: 0 }
        : { kind: kind as ShiftRule['kind'] };
      return next;
    });
  };
  const editRule = (token: string, change: Partial<ShiftRule>) => {
    setSnapshot(null);
    setCodebook(previous => ({ ...previous, [codeKey(token)]: { ...previous[codeKey(token)], ...change } }));
  };

  const compare = async () => {
    setSnapshot(null); setError(''); setNotice('');
    if (!plan.ready || busy || plan.entries.length > 6000) return;
    setBusy(true);
    try {
      const dates = plan.entries.map(entry => entry.shift_date).sort();
      const first = dates[0]; const last = dates.at(-1)!;
      const existing: ExistingScheduleShift[] = [];
      let offset = 0;
      while (true) {
        const { data, error: queryError } = await (supabase.from('work_schedule_entries' as any) as any)
          .select('staff_id,shift_date,slot,kind,start_local,end_local,end_day_offset,unpaid_break_minutes,state,version')
          .eq('organization_slug', 'rdhotels').eq('hotel_id', hotelId)
          .gte('shift_date', first).lte('shift_date', last)
          .order('shift_date').order('staff_id').order('slot')
          .range(offset, offset + 499);
        if (queryError) throw queryError;
        const chunk = (data ?? []) as ExistingScheduleShift[];
        existing.push(...chunk);
        if (existing.length > 15000) throw new Error('Roster is too large for safe browser preview.');
        if (chunk.length < 500) break;
        offset += 500;
      }
      const existingByKey = new Map(existing.map(row => [rowId(row), row]));
      let created = 0, changed = 0, unchanged = 0;
      const conflicts: string[] = [];
      const payload = plan.entries.map(entry => {
        const prior = existingByKey.get(rowId(entry));
        if (!prior) created++;
        else if (sameScheduleShift(prior, entry)) unchanged++;
        else if (prior.state === 'published')
          conflicts.push(`${entry.shift_date} · ${entry.source_label}: published entry differs; HR revision required.`);
        else changed++;
        return { staff_id: entry.staff_id, source_label: entry.source_label,
          shift_date: entry.shift_date, slot: entry.slot, kind: entry.kind,
          start_local: entry.start_local, end_local: entry.end_local,
          end_day_offset: entry.end_day_offset, unpaid_break_minutes: entry.unpaid_break_minutes,
          expected_version: prior?.version ?? null };
      });
      setSnapshot({ plan, payload, created, changed, unchanged, conflicts });
    } catch (caught) { setError(`Comparison failed: ${errorText(caught)}`); }
    finally { setBusy(false); }
  };
  const importDrafts = async () => {
    if (!snapshot || snapshot.plan !== plan || !plan.ready || snapshot.conflicts.length || busy) return;
    if (!window.confirm(`Import ${snapshot.created} new and ${snapshot.changed} changed DRAFT entries for ${hotelId} from ${selected.length} selected tabs? ${snapshot.unchanged} rows will remain unchanged. Published shifts will NOT be overwritten. Continue?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { data, error: rpcError } = await supabase.rpc('work_schedule_import_excel_drafts' as any,
        { p_hotel_id: hotelId, p_entries: snapshot.payload });
      if (rpcError) throw rpcError;
      const result = data as { inserted: number; updated: number; unchanged: number };
      setNotice(`Atomic import complete: ${result.inserted} new drafts, ${result.updated} updated drafts, ${result.unchanged} unchanged. Employees cannot see drafts until approved publication.`);
      setSnapshot(null); onImported();
    } catch (caught) {
      setError(`Import success not confirmed: ${errorText(caught)}. Refresh and compare again; SQL errors roll back the request.`);
      setSnapshot(null);
    } finally { setBusy(false); }
  };
  const snapshotValid = Boolean(snapshot && snapshot.plan === plan);
  return <Card className="border-primary/30">
    <CardHeader><CardTitle>2 · Synchronize multi-tab Excel into draft schedules</CardTitle></CardHeader>
    <CardContent className="space-y-4 text-sm">
      <p>Confirm employee/account links above, then select the workbook here. Choose months, review mixed-venue columns and Excel date formatting, define unfamiliar codes, compare and approve changes. Only reviewed shifts—not the original spreadsheet—reach the hotel-scoped import.</p>
      <Button type="button" variant="outline" disabled={busy} onClick={() => setIdentityRefresh(value => value + 1)}>Reload confirmed employee links</Button>
      <span className="ml-2 text-muted-foreground">{identityReady ? `${links.length} venue-specific links loaded` : 'Loading authorized links…'}</span>
      <Input aria-label="Excel workbook for draft import" type="file" accept=".xls,.xlsx" disabled={busy || !identityReady}
        onChange={event => void load(event.target.files?.[0])} />
      {error && <p role="alert" className="rounded-md border border-destructive p-3 text-destructive">{error}</p>}
      {notice && <p role="status" className="rounded-md border border-green-500 p-3">{notice}</p>}
      {filename && <p className="font-semibold">{filename}: {datedSheets.length} dated tabs; {sheets.length - datedSheets.length} undated/template tabs ignored.</p>}
      {datedSheets.length > 0 && <>
        <div className="rounded-md border p-3 space-y-2">
          <p className="font-medium">Select source months (each tab is dated independently)</p>
          <div className="flex flex-wrap gap-3">{datedSheets.map(sheet => <label key={sheet.name} className="inline-flex items-center gap-2">
            <input type="checkbox" checked={selected.includes(sheet.name)} disabled={busy}
              onChange={event => { setSnapshot(null); setSelected(previous => event.target.checked
                ? [...previous, sheet.name] : previous.filter(name => name !== sheet.name)); }} />
            {sheet.name}
          </label>)}</div>
        </div>
        {selected.map(sheetName => <div key={sheetName} className="rounded-md border p-3 space-y-2">
          <p className="font-semibold">{sheetName} · {rosterSheetMonth(sheetName)}</p>
          {columns.filter(column => column.sheet === sheetName && !column.otherHotel).map(column =>
            <label key={cellId(sheetName, column.column)} className="flex flex-wrap items-center gap-2 border-t pt-2">
              <input type="checkbox" checked={column.included} disabled={busy} onChange={event => {
                setSnapshot(null); setOverrides(previous => ({ ...previous,
                  [cellId(sheetName, column.column)]: event.target.checked }));
              }} />
              <span>Col {column.column + 1} · {column.label} · {column.department || 'Shared/unlabelled'}</span>
              <span className={column.account && accountIds.includes(column.account) ? 'text-green-700 dark:text-green-400' : 'text-destructive'}>
                {column.account && accountIds.includes(column.account) ? 'Confirmed account' : 'Employee link required'}
              </span>
              {column.shared && <span className="text-amber-700 dark:text-amber-400">Shared/mixed venue: include only after verifying employment location</span>}
            </label>)}
          <p className="text-xs text-muted-foreground">{columns.filter(column => column.sheet === sheetName && column.otherHotel).length} columns belonging to other hotels excluded. Unchecked columns stay unchanged.</p>
        </div>)}
        <label className="flex items-start gap-2 rounded-md border p-3">
          <input type="checkbox" className="mt-1" checked={acceptDates} disabled={busy}
            onChange={event => { setSnapshot(null); setAcceptDates(event.target.checked); }} />
          <span><strong>Interpret reviewed Excel autoformatted m-d / mm-dd date cells as HH:00–HH:00 shifts.</strong> Some original values such as 08-17 became date serials; arbitrary numbers and other date formats remain blocked.</span>
        </label>
        <p className="font-medium">Local preview: {plan.entries.length} recognized shifts · {plan.issues.length} exceptions · {plan.autoDateCount} Excel-formatted dates · {plan.rolloverRowsSkipped} next-month rows ignored.</p>
        {plan.unknownTokens.length > 0 && <div className="rounded-md border p-3 space-y-3">
          <p className="font-semibold">Define unknown codes for this upload (HR review required). Nothing is guessed.</p>
          {plan.unknownTokens.slice(0, 120).map(item => {
            const rule = codebook[codeKey(item.token)];
            return <div key={item.token} className="flex flex-wrap items-center gap-2 border-t pt-2">
              <span className="max-w-56 break-words font-medium">{item.token} ({item.count} cells)</span>
              <select aria-label={`Define code ${item.token}`} value={rule?.kind ?? ''} disabled={busy}
                onChange={event => updateRule(item.token, event.target.value)} className="h-9 border rounded-md bg-background px-2">
                <option value="">Not defined — blocks import</option>
                {['work','off','leave','training','unavailable'].map(kind => <option key={kind} value={kind}>{kind}</option>)}
              </select>
              {rule?.kind === 'work' && <>
                <label>From <Input type="time" className="w-32" value={rule.startLocal ?? '08:00'} disabled={busy}
                  onChange={event => editRule(item.token, { startLocal: event.target.value })} /></label>
                <label>To <Input type="time" className="w-32" value={rule.endLocal ?? '16:00'} disabled={busy}
                  onChange={event => editRule(item.token, { endLocal: event.target.value })} /></label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={rule.endDayOffset === 1}
                  onChange={event => editRule(item.token, { endDayOffset: event.target.checked ? 1 : 0 })} />Next day</label>
                <label>Unpaid break <Input type="number" min={0} max={240} className="w-24"
                  value={rule.unpaidBreakMinutes ?? 0} onChange={event => editRule(item.token, { unpaidBreakMinutes: Number(event.target.value) })} /></label>
              </>}
            </div>;
          })}
          {plan.unknownTokens.length > 120 && <p>More than 120 unique codes: split or simplify the workbook first.</p>}
        </div>}
        {plan.issues.length > 0 && <div role="alert" className="max-h-52 overflow-auto rounded-md border border-amber-400 p-3">
          <strong>Import blocked until every exception is resolved.</strong>
          {plan.issues.slice(0, 30).map((issue, index) => <p key={`${issue.sheet}-${issue.row}-${issue.column}-${index}`} className="border-t py-1">
            {issue.sheet} · row {issue.row} col {issue.column}: {issue.code} — {issue.detail}
          </p>)}
          {plan.issues.length > 30 && <p>{plan.issues.length - 30} additional exceptions.</p>}
        </div>}
        <Button type="button" variant="outline" disabled={!plan.ready || busy || plan.entries.length > 6000}
          onClick={() => void compare()}>{busy ? 'Reviewing…' : `Compare ${plan.entries.length} shifts with saved records`}</Button>
        {snapshotValid && snapshot && <div className="space-y-2 rounded-md border p-3">
          <p><strong>Database comparison: {snapshot.created} new drafts · {snapshot.changed} draft updates · {snapshot.unchanged} unchanged · {snapshot.conflicts.length} published conflicts.</strong></p>
          <p>Missing Excel rows are preserved. Existing notes remain. Imported entries stay drafts until separate HR-approved publication.</p>
          {snapshot.conflicts.slice(0, 15).map((conflict, index) => <p role="alert" className="text-destructive" key={index}>{conflict}</p>)}
          <Button type="button" disabled={busy || snapshot.conflicts.length > 0} onClick={() => void importDrafts()}>
            {busy ? 'Importing…' : 'Confirm and atomically update draft schedule records'}
          </Button>
        </div>}
      </>}
      <p className="text-xs text-muted-foreground">Pilot: authenticated test-DB UAT, employment-law and privacy review are mandatory before deployment. Ambiguous values block import; no silent overwrite, deletion or cross-hotel changes.</p>
    </CardContent>
  </Card>;
}
