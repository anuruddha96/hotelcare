import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { dryRunRoster, type RosterRows } from '@/lib/workScheduleImport';
import {
  findConfirmedRosterAccount, rosterIdentityKey, suggestRosterAccounts,
  type ConfirmedRosterLink, type ScheduleAccount,
} from '@/lib/workScheduleIdentity';

type Person = { id: string; full_name: string; role: string };
type Props = { hotelId: string; month: string; staff: Person[] };
type SourceSheet = { name: string; rows: RosterRows };
type SourceColumn = { index: number; person: string; department: string };
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const toMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const accountLabel = (account: ScheduleAccount) =>
  `${account.full_name} · ${account.nickname ? `@${account.nickname}` : 'no username'} · ${account.role} · ${account.id.slice(0, 8)}`;

/** Only source names and stable account UUIDs are saved when a manager explicitly confirms links.
 * All spreadsheet dates, codes, shift cells and file bytes remain in this browser. */
export function ExcelRosterDryRun({ hotelId, month, staff }: Props) {
  const [filename, setFilename] = useState('');
  const [sheets, setSheets] = useState<SourceSheet[]>([]);
  const [sheetName, setSheetName] = useState('');
  const [assignments, setAssignments] = useState<Record<number, string>>({});
  const [fileError, setFileError] = useState('');
  const [reading, setReading] = useState(false);
  const [accounts, setAccounts] = useState<ScheduleAccount[]>([]);
  const [savedLinks, setSavedLinks] = useState<ConfirmedRosterLink[]>([]);
  const [identityHotel, setIdentityHotel] = useState('');
  const [identityError, setIdentityError] = useState('');
  const [identityBusy, setIdentityBusy] = useState(false);
  const [linkNotice, setLinkNotice] = useState('');

  useEffect(() => {
    setFilename(''); setSheets([]); setSheetName(''); setAssignments({});
    setFileError(''); setLinkNotice('');
  }, [hotelId, month]);

  useEffect(() => {
    let active = true;
    setAccounts([]); setSavedLinks([]); setIdentityHotel('');
    setIdentityError(''); setLinkNotice('');
    if (!hotelId || staff.length === 0) return () => { active = false; };
    void (async () => {
      const [accountResult, linkResult] = await Promise.all([
        supabase.rpc('work_schedule_staff_accounts_for_hotel' as any, { p_hotel_id: hotelId }),
        (supabase.from('work_schedule_employee_links' as any) as any)
          .select('id,source_label,staff_id').eq('organization_slug', 'rdhotels').eq('hotel_id', hotelId),
      ]);
      if (accountResult.error) throw accountResult.error;
      if (linkResult.error) throw linkResult.error;
      if (!active) return;
      const allowedIds = new Set(staff.map(person => person.id));
      setAccounts(((accountResult.data ?? []) as ScheduleAccount[])
        .filter(account => allowedIds.has(account.id)));
      setSavedLinks((linkResult.data ?? []) as ConfirmedRosterLink[]);
      setIdentityHotel(hotelId);
    })().catch(error => { if (active) setIdentityError(`Account matching unavailable: ${toMessage(error)}`); });
    return () => { active = false; };
  }, [hotelId, staff]);

  const currentSheet = sheets.find(sheet => sheet.name === sheetName);
  const columns = useMemo((): SourceColumn[] => {
    if (!currentSheet) return [];
    const rows = currentSheet.rows;
    const width = Math.max(0, ...rows.map(row => row.length));
    return Array.from({ length: Math.max(0, width - 2) }, (_, index) => index + 2)
      .filter(index => Boolean(String(rows[1]?.[index] ?? '').trim()) ||
        rows.slice(2).some(row => String(row[index] ?? '').trim() !== ''))
      .map(index => ({ index, person: String(rows[1]?.[index] ?? '').trim(),
        department: String(rows[0]?.[index] ?? '').trim() }));
  }, [currentSheet]);

  const expectedMonth = MONTHS[Number(month.slice(5, 7)) - 1];
  const matchingMonth = Boolean(expectedMonth && sheetName.toUpperCase().includes(expectedMonth));
  const identityReady = identityHotel === hotelId && !identityError && accounts.length > 0;
  const nameCounts = useMemo(() => {
    const result = new Map<string, number>();
    columns.forEach(column => {
      const key = rosterIdentityKey(column.person);
      if (key) result.set(key, (result.get(key) ?? 0) + 1);
    });
    return result;
  }, [columns]);
  const effectiveAssignments = useMemo(() => {
    const result: Record<number, string> = {};
    if (!identityReady) return result;
    columns.forEach(column => {
      const duplicate = (nameCounts.get(rosterIdentityKey(column.person)) ?? 0) > 1;
      const previouslyConfirmed = findConfirmedRosterAccount(column.person, accounts, savedLinks, duplicate);
      result[column.index] = assignments[column.index] ?? previouslyConfirmed?.id ?? '';
    });
    return result;
  }, [identityReady, columns, nameCounts, accounts, savedLinks, assignments]);
  const unmapped = columns.filter(column => !effectiveAssignments[column.index]).length;
  const reviewedRows = useMemo(() => currentSheet?.rows.map(row =>
    row.map((value, col) => effectiveAssignments[col] === '__exclude__' ? '' : value)) ?? [],
    [currentSheet, effectiveAssignments]);
  const mappedColumns = useMemo(() => Object.fromEntries(Object.entries(effectiveAssignments)
    .filter(([, value]) => value && value !== '__exclude__')
    .map(([col, staffId]) => [Number(col), { staffId, hotelId }])), [effectiveAssignments, hotelId]);
  const review = useMemo(() => currentSheet && matchingMonth && unmapped === 0 && identityReady
    ? dryRunRoster(reviewedRows, {
      month, hotelId, columns: mappedColumns,
      eligibleStaff: accounts.map(account => ({ id: account.id, hotelId })),
    }) : null, [currentSheet, matchingMonth, unmapped, identityReady, reviewedRows, month, hotelId, mappedColumns, accounts]);

  const eligibleLinks = columns.filter(column => effectiveAssignments[column.index] &&
    effectiveAssignments[column.index] !== '__exclude__');
  const hasDuplicateAliases = eligibleLinks.some(column =>
    (nameCounts.get(rosterIdentityKey(column.person)) ?? 0) !== 1);
  const duplicateAccounts = new Set(eligibleLinks.map(column => effectiveAssignments[column.index])).size !== eligibleLinks.length;
  const linkConflict = eligibleLinks.some(column => savedLinks.some(link =>
    rosterIdentityKey(link.source_label) === rosterIdentityKey(column.person) &&
      link.staff_id !== effectiveAssignments[column.index]));
  const linkable = identityReady && matchingMonth && unmapped === 0 && eligibleLinks.length > 0 &&
    !hasDuplicateAliases && !duplicateAccounts && !linkConflict &&
    eligibleLinks.every(column => Boolean(column.person.trim()) &&
      accounts.some(account => account.id === effectiveAssignments[column.index]));

  const load = async (file?: File) => {
    setFilename(''); setSheets([]); setSheetName(''); setAssignments({});
    setFileError(''); setLinkNotice('');
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

  const confirmLinks = async () => {
    if (!linkable || identityBusy) return;
    const links = eligibleLinks.map(column => ({ source_label: column.person.trim(),
      staff_id: effectiveAssignments[column.index] }));
    if (!window.confirm(`Confirm ${links.length} Excel name → existing HotelCare account links for this venue? Only the name and profile ID are saved. Shifts are NOT imported. Incorrect links require an audited correction.`)) return;
    setIdentityBusy(true); setIdentityError(''); setLinkNotice('');
    try {
      const { data, error } = await supabase.rpc('work_schedule_confirm_employee_links' as any,
        { p_hotel_id: hotelId, p_links: links });
      if (error) throw error;
      const { data: refreshed, error: refreshError } = await (supabase.from('work_schedule_employee_links' as any) as any)
        .select('id,source_label,staff_id').eq('organization_slug', 'rdhotels').eq('hotel_id', hotelId);
      if (refreshError) throw refreshError;
      setSavedLinks((refreshed ?? []) as ConfirmedRosterLink[]);
      setLinkNotice(`${data ?? 0} new permanent account links confirmed; previously saved links retained. No shifts imported.`);
    } catch (error) { setIdentityError(`Links were not verified: ${toMessage(error)}. Refresh to check whether any were saved.`); }
    finally { setIdentityBusy(false); }
  };

  return <Card>
    <CardHeader><CardTitle>Excel employee-to-account mapping · no shift import</CardTitle></CardHeader>
    <CardContent className="space-y-4 text-sm">
      <p>Upload here means inspect the file in this browser: the workbook never goes to the server. Existing HotelCare usernames and names are suggested only from accounts authorized for the selected venue. Managers confirm the correct person; the saved link uses the stable login account ID, not a potentially changing name.</p>
      {identityError && <p role="alert" className="text-destructive">{identityError}</p>}
      {linkNotice && <p role="status" className="rounded-md border p-2">{linkNotice}</p>}
      {!identityReady && !identityError && <p role="status">Loading authorized employee accounts and existing links…</p>}
      <Input aria-label="Excel roster file" type="file" accept=".xls,.xlsx"
        disabled={!hotelId || reading || identityBusy} onChange={event => void load(event.target.files?.[0])} />
      {reading && <p role="status">Inspecting local spreadsheet…</p>}
      {fileError && <p role="alert" className="text-destructive">{fileError}</p>}
      {sheets.length > 0 && <>
        <p className="font-medium">{filename} · {sheets.length} sheets found</p>
        <label className="block">Source worksheet
          <select aria-label="Source worksheet" className="block mt-1 h-10 w-full max-w-md rounded-md border bg-background px-3"
            value={sheetName} onChange={event => { setSheetName(event.target.value); setAssignments({}); setLinkNotice(''); }}>
            {sheets.map(sheet => <option key={sheet.name} value={sheet.name}>{sheet.name}</option>)}
          </select>
        </label>
        {!matchingMonth && <p role="alert" className="text-destructive">The worksheet title does not match {month}. Select the correct monthly sheet; templates and unknown titles cannot pass review.</p>}
        {matchingMonth && <>
          <div className="flex flex-wrap gap-3 rounded-md border p-3">
            <span>Source columns: <strong>{columns.length}</strong></span>
            <span>Mappings required: <strong>{unmapped}</strong></span>
            <span>Existing links: <strong>{eligibleLinks.filter(column => savedLinks.some(link =>
              rosterIdentityKey(link.source_label) === rosterIdentityKey(column.person) &&
              link.staff_id === effectiveAssignments[column.index])).length}</strong></span>
            <span>Excluded: <strong>{columns.filter(column => effectiveAssignments[column.index] === '__exclude__').length}</strong></span>
          </div>
          <div className="max-h-96 overflow-auto space-y-3 border rounded-md p-2" aria-label="Source column mapping">
            {columns.map(column => {
              const duplicates = (nameCounts.get(rosterIdentityKey(column.person)) ?? 0) > 1;
              const saved = findConfirmedRosterAccount(column.person, accounts, savedLinks, duplicates);
              const suggestions = suggestRosterAccounts(column.person, accounts);
              const selected = effectiveAssignments[column.index];
              const approved = saved && selected === saved.id;
              return <div key={column.index} className="space-y-2 border-b pb-3">
                <label className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0"><strong>Column {column.index + 1} · {column.person || '(unnamed)'}</strong>
                    <span className="ml-2 text-muted-foreground">{column.department}</span></span>
                  <select aria-label={`Map column ${column.index + 1}`} value={selected}
                    disabled={!identityReady || identityBusy}
                    onChange={event => { setAssignments(previous => ({ ...previous, [column.index]: event.target.value })); setLinkNotice(''); }}
                    className="h-9 min-w-44 max-w-full rounded-md border bg-background px-2">
                    <option value="">Select existing HotelCare account</option>
                    <option value="__exclude__">Exclude — other venue / not an employee</option>
                    {accounts.map(account => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
                  </select>
                </label>
                {approved && <p className="text-xs text-green-700 dark:text-green-400">Previously confirmed link: {accountLabel(saved)}. This continues to use the account ID if the username changes.</p>}
                {duplicates && <p role="alert" className="text-xs text-destructive">Duplicate source name in this sheet. Distinguish the employees in the workbook before saving; identical labels cannot be assigned automatically.</p>}
                {!approved && !duplicates && suggestions.length > 0 && <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Potential accounts (not automatically linked):</span>
                  {suggestions.map(suggestion => <Button key={suggestion.account.id} type="button" size="sm" variant="outline"
                    disabled={!identityReady || identityBusy}
                    onClick={() => setAssignments(previous => ({ ...previous, [column.index]: suggestion.account.id }))}>
                    {suggestion.reason === 'username' ? 'Username' : suggestion.reason === 'name' ? 'Exact name' : 'Possible'} · {suggestion.account.nickname ? `@${suggestion.account.nickname}` : suggestion.account.full_name}
                  </Button>)}
                </div>}
                {selected && selected !== '__exclude__' && !accounts.some(account => account.id === selected) &&
                  <p role="alert" className="text-xs text-destructive">Previously linked account is no longer authorized for this venue. HR must verify its hotel assignment.</p>}
              </div>;
            })}
          </div>
          {linkConflict && <p role="alert" className="text-destructive">A name is already linked to a different account. This upload cannot silently reassign it; request an audited correction.</p>}
          {duplicateAccounts && <p role="alert" className="text-destructive">The same account is selected for multiple columns. Confirm identities separately before saving.</p>}
          {hasDuplicateAliases && <p role="alert" className="text-destructive">Duplicate Excel labels must be distinguished before saving permanent links.</p>}
          <Button type="button" disabled={!linkable || identityBusy} onClick={() => void confirmLinks()}>
            {identityBusy ? 'Confirming…' : `Confirm ${eligibleLinks.length} employee/account links`}
          </Button>
          <p className="text-xs text-muted-foreground">This saves ONLY the confirmed Excel employee name, selected venue and existing account ID, with an audit record. It does not create accounts, change their hotel access or import a single shift. Once linked, future uploads for this venue reuse the same verified ID.</p>
          {review && <div className="space-y-2 rounded-md border p-3" aria-live="polite">
            <p><strong>{review.ready ? 'Schedule dry-run complete — NOT imported' : 'Schedule import blocked: exceptions require correction'}</strong></p>
            <p>{review.scannedCells} shift cells examined · {review.entries.length} recognized entries · {review.issues.length} exceptions.</p>
            {review.issues.length > 0 && <div className="max-h-56 overflow-auto">
              {review.issues.slice(0, 50).map((issue, index) => <p key={`${issue.row}-${issue.column}-${index}`} className="border-t py-1">
                Row {issue.row}, column {issue.column}: {issue.code.replaceAll('_', ' ')} — {issue.detail}
              </p>)}
              {review.issues.length > 50 && <p>{review.issues.length - 50} additional exceptions. Correct the source copy before importing.</p>}
            </div>}
            <p className="text-muted-foreground">A successful identity match is independent of shift parsing. HR-approved codes, atomic import and rollback are still mandatory before rosters can be imported.</p>
          </div>}
          {unmapped > 0 && <Button type="button" variant="outline" disabled>Map or exclude all columns to validate</Button>}
        </>}
      </>}
    </CardContent>
  </Card>;
}
