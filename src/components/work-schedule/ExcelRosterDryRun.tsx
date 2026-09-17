import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { RosterRows } from '@/lib/workScheduleImport';
import { findConfirmedRosterAccount, rosterIdentityKey, suggestRosterAccounts,
  type ConfirmedRosterLink, type ScheduleAccount } from '@/lib/workScheduleIdentity';
import { rosterHeaderVenues, rosterSheetMonth } from '@/lib/workScheduleWorkbook';

type Props = { hotelId: string; month: string; staff: { id: string; full_name: string; role: string }[] };
type SourceSheet = { name: string; rows: RosterRows };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const labelAccount = (account: ScheduleAccount) =>
  `${account.full_name} · ${account.nickname ? `@${account.nickname}` : 'no username'} · ${account.role} · ${account.id.slice(0, 8)}`;

/** Step 1: map a spreadsheet employee name to an existing venue-authorized
 * HotelCare profile ID. Upload is parsed in-browser; only confirmed aliases
 * and account IDs reach the server. Formulas in unselected sheets are harmless. */
export function ExcelRosterDryRun({ hotelId, month, staff }: Props) {
  const [sheets, setSheets] = useState<SourceSheet[]>([]);
  const [filename, setFilename] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [assignments, setAssignments] = useState<Record<number, string>>({});
  const [accounts, setAccounts] = useState<ScheduleAccount[]>([]);
  const [savedLinks, setSavedLinks] = useState<ConfirmedRosterLink[]>([]);
  const [identityReady, setIdentityReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSheets([]); setFilename(''); setSheetName(''); setAssignments({});
    setError(''); setNotice('');
  }, [hotelId, month]);
  useEffect(() => {
    let active = true;
    setAccounts([]); setSavedLinks([]); setIdentityReady(false);
    if (!hotelId || staff.length === 0) return () => { active = false; };
    void (async () => {
      const [people, links] = await Promise.all([
        supabase.rpc('work_schedule_staff_accounts_for_hotel' as any, { p_hotel_id: hotelId }),
        (supabase.from('work_schedule_employee_links' as any) as any)
          .select('id,source_label,staff_id').eq('organization_slug', 'rdhotels').eq('hotel_id', hotelId),
      ]);
      if (people.error) throw people.error;
      if (links.error) throw links.error;
      if (!active) return;
      const ids = new Set(staff.map(person => person.id));
      setAccounts(((people.data ?? []) as ScheduleAccount[]).filter(person => ids.has(person.id)));
      setSavedLinks((links.data ?? []) as ConfirmedRosterLink[]);
      setIdentityReady(true);
    })().catch(caught => { if (active) setError(`Account lookup failed: ${message(caught)}`); });
    return () => { active = false; };
  }, [hotelId, staff]);

  const sheet = sheets.find(item => item.name === sheetName);
  const columns = useMemo(() => {
    if (!sheet) return [];
    const width = Math.max(0, ...sheet.rows.slice(0, 40).map(row => row.length));
    return Array.from({ length: Math.max(0, width - 2) }, (_, offset) => offset + 2)
      .filter(column => String(sheet.rows[1]?.[column] ?? '').trim() ||
        sheet.rows.slice(2, 40).some(row => String(row[column] ?? '').trim()))
      .map(column => ({ index: column, name: String(sheet.rows[1]?.[column] ?? '').trim(),
        department: String(sheet.rows[0]?.[column] ?? '').trim() }));
  }, [sheet]);
  const nameCounts = useMemo(() => {
    const result = new Map<string, number>();
    columns.forEach(column => {
      const key = rosterIdentityKey(column.name);
      if (key) result.set(key, (result.get(key) ?? 0) + 1);
    });
    return result;
  }, [columns]);
  const mapped = useMemo(() => {
    const result: Record<number, string> = {};
    if (!identityReady) return result;
    columns.forEach(column => {
      const venues = rosterHeaderVenues(column.department);
      const otherHotel = venues.length === 1 && venues[0] !== hotelId ||
        venues.length > 1 && !venues.includes(hotelId);
      const duplicate = (nameCounts.get(rosterIdentityKey(column.name)) ?? 0) > 1;
      const confirmed = findConfirmedRosterAccount(column.name, accounts, savedLinks, duplicate);
      result[column.index] = assignments[column.index] ??
        (otherHotel ? '__exclude__' : confirmed?.id ?? '');
    });
    return result;
  }, [identityReady, columns, hotelId, nameCounts, accounts, savedLinks, assignments]);
  const chosen = columns.filter(column => mapped[column.index] && mapped[column.index] !== '__exclude__');
  const unmapped = columns.filter(column => !mapped[column.index]).length;
  const duplicateNames = chosen.some(column => (nameCounts.get(rosterIdentityKey(column.name)) ?? 0) > 1);
  const duplicateAccounts = new Set(chosen.map(column => mapped[column.index])).size !== chosen.length;
  const conflict = chosen.some(column => savedLinks.some(link =>
    rosterIdentityKey(link.source_label) === rosterIdentityKey(column.name) &&
    link.staff_id !== mapped[column.index]));
  const wrongVenue = chosen.some(column => {
    const venues = rosterHeaderVenues(column.department);
    return venues.length > 0 && !venues.includes(hotelId);
  });
  const ready = identityReady && rosterSheetMonth(sheetName) === month && !busy &&
    unmapped === 0 && chosen.length > 0 && !duplicateNames && !duplicateAccounts &&
    !conflict && !wrongVenue && chosen.every(column => Boolean(column.name) &&
      accounts.some(person => person.id === mapped[column.index]));

  const load = async (file?: File) => {
    setSheets([]); setFilename(''); setSheetName(''); setAssignments({});
    setError(''); setNotice('');
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name) || file.size === 0 || file.size > 8 * 1024 * 1024) {
      setError('Select a nonempty XLS/XLSX workbook up to 8 MB.'); return;
    }
    setBusy(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', bookVBA: false, cellDates: false });
      if (workbook.SheetNames.length > 24) throw new Error('Maximum 24 worksheets.');
      let area = 0;
      const parsed = workbook.SheetNames.map(name => {
        const ws = workbook.Sheets[name];
        const bounds = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
        area += (bounds.e.r + 1) * (bounds.e.c + 1);
        if (bounds.e.r > 1999 || bounds.e.c > 249 || area > 500000)
          throw new Error('Workbook too large for a safe browser review.');
        // Do not reject the entire historic workbook because a totals/footer
        // formula exists in another month: identity mapping reads names only.
        return { name, rows: XLSX.utils.sheet_to_json<RosterRows[number]>(ws,
          { header: 1, raw: true, blankrows: true, defval: '' }) };
      });
      setSheets(parsed); setFilename(file.name);
      setSheetName(parsed.find(item => rosterSheetMonth(item.name) === month)?.name ?? '');
    } catch (caught) { setError(`Workbook review failed: ${message(caught)}`); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!ready) return;
    const payload = chosen.map(column => ({ source_label: column.name,
      staff_id: mapped[column.index] }));
    if (!window.confirm(`Link ${payload.length} Excel names to the existing HotelCare accounts for this hotel? This saves no shifts. Verify usernames and identities first.`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { data, error: rpcError } = await supabase.rpc('work_schedule_confirm_employee_links' as any,
        { p_hotel_id: hotelId, p_links: payload });
      if (rpcError) throw rpcError;
      const { data: refreshed, error: lookupError } = await (supabase.from('work_schedule_employee_links' as any) as any)
        .select('id,source_label,staff_id').eq('organization_slug', 'rdhotels').eq('hotel_id', hotelId);
      if (lookupError) throw lookupError;
      setSavedLinks((refreshed ?? []) as ConfirmedRosterLink[]);
      setNotice(`${data ?? 0} new account links confirmed. Open section 2 and reload links before reviewing shifts.`);
    } catch (caught) { setError(`Link confirmation not verified: ${message(caught)}. Refresh to check existing links.`); }
    finally { setBusy(false); }
  };

  return <Card>
    <CardHeader><CardTitle>1 · Match spreadsheet employees to existing HotelCare accounts</CardTitle></CardHeader>
    <CardContent className="space-y-4 text-sm">
      <p>Upload a workbook locally, select the month tab and verify each employee by existing username, role and account ID. A confirmed alias is reusable on later uploads. Other hotels are excluded by their headings; shared/mixed departments require explicit choices. No workbook bytes or shift data are uploaded here.</p>
      <Input type="file" aria-label="Excel roster file for account linking" accept=".xls,.xlsx" disabled={busy || !identityReady}
        onChange={event => void load(event.target.files?.[0])} />
      {!identityReady && !error && <p role="status">Loading authorized HotelCare accounts…</p>}
      {busy && <p role="status">Working…</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {notice && <p role="status" className="rounded-md border p-2">{notice}</p>}
      {filename && <p className="font-medium">{filename} · {sheets.length} tabs found</p>}
      {sheets.length > 0 && <>
        <label className="block">Source month
          <select aria-label="Source worksheet for mapping" className="block mt-1 h-10 w-full max-w-md rounded-md border bg-background px-3"
            value={sheetName} onChange={event => { setSheetName(event.target.value); setAssignments({}); setNotice(''); }}>
            <option value="">Select a dated worksheet</option>
            {sheets.filter(item => rosterSheetMonth(item.name)).map(item =>
              <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
        </label>
        {sheetName && rosterSheetMonth(sheetName) !== month && <p role="alert" className="text-destructive">Choose the worksheet matching the page's month ({month}).</p>}
        {sheet && <>
          <div className="rounded-md border p-3">{columns.length} employee/source columns · {unmapped} still need a decision · {columns.length - chosen.length - unmapped} excluded.</div>
          <div className="max-h-96 overflow-auto space-y-2 rounded-md border p-2">
            {columns.map(column => {
              const duplicated = (nameCounts.get(rosterIdentityKey(column.name)) ?? 0) > 1;
              const confirmed = findConfirmedRosterAccount(column.name, accounts, savedLinks, duplicated);
              const selected = mapped[column.index];
              const venues = rosterHeaderVenues(column.department);
              const otherHotel = venues.length > 0 && !venues.includes(hotelId);
              return <div key={column.index} className="space-y-1 border-b pb-2">
                <label className="flex flex-wrap items-center justify-between gap-2">
                  <span>Column {column.index + 1} · <strong>{column.name || '(unnamed)'}</strong> · {column.department}</span>
                  <select aria-label={`Map column ${column.index + 1}`} value={selected ?? ''} disabled={busy}
                    className="h-9 max-w-full rounded-md border bg-background px-2"
                    onChange={event => { setAssignments(previous => ({ ...previous, [column.index]: event.target.value })); setNotice(''); }}>
                    <option value="">Choose an account or exclude</option>
                    <option value="__exclude__">Exclude — other venue / not staff</option>
                    {accounts.map(account => <option key={account.id} value={account.id}>{labelAccount(account)}</option>)}
                  </select>
                </label>
                {otherHotel && <p className="text-xs text-muted-foreground">Other hotel header: excluded by default. Cross-hotel selections are blocked.</p>}
                {confirmed && selected === confirmed.id && <p className="text-xs text-green-700 dark:text-green-400">Previously confirmed account: {labelAccount(confirmed)}</p>}
                {duplicated && selected !== '__exclude__' && <p role="alert" className="text-xs text-destructive">Duplicate name: distinguish this employee before saving the link.</p>}
                {!confirmed && selected !== '__exclude__' && suggestRosterAccounts(column.name, accounts).map(hint =>
                  <Button key={hint.account.id} size="sm" type="button" variant="outline" disabled={busy}
                    onClick={() => setAssignments(previous => ({ ...previous, [column.index]: hint.account.id }))}>
                    Suggested {hint.reason}: {hint.account.nickname ?? hint.account.full_name}
                  </Button>)}
              </div>;
            })}
          </div>
          {conflict && <p role="alert" className="text-destructive">A name is already attached to a different account; audited correction required.</p>}
          {duplicateNames && <p role="alert" className="text-destructive">Duplicate selected name. Distinguish employees before confirming.</p>}
          {duplicateAccounts && <p role="alert" className="text-destructive">One account is mapped to multiple source columns.</p>}
          {wrongVenue && <p role="alert" className="text-destructive">Other-hotel column selected; correct the venue mapping.</p>}
          <Button type="button" disabled={!ready} onClick={() => void confirm()}>
            {busy ? 'Confirming…' : `Confirm ${chosen.length} employee/account links`}
          </Button>
          <p className="text-xs text-muted-foreground">After confirmation, use section 2 below to review and import draft shifts. No new users are created and no account privileges are changed.</p>
        </>}
      </>}
    </CardContent>
  </Card>;
}
