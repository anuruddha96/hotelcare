import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Info, LayoutGrid, List, Loader2, Rows3, Search, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { entryKey, useWorkforce } from '@/hooks/useWorkforce';
import { todayBudapest } from '@/lib/budapestTime';
import {
  accessLevelFor, canEditDate, cellLabel, cellStyle, formatHours, HOTEL_STYLE, HOTELS, hotelKey, hotelShort, KIND_STYLE,
  matchesStaffSearch, monthDays, pad2, WEEKDAY_SHORT, weekdayOf, type WorkforceEntry, type WorkforceKind, type WorkforceStaff,
} from '@/lib/workforce/model';
import { customCodesOf, textOfEntry } from '@/lib/workforce/grid';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { WorkforceGrid, type CellChange } from './WorkforceGrid';
import { WorkforceEntryDialog } from './WorkforceEntryDialog';
import { WorkforceStaffPanel } from './WorkforceStaffPanel';
import { WorkforceAnalytics } from './WorkforceAnalytics';
import { WorkforceSettings } from './WorkforceSettings';
import { WorkforceImport } from './WorkforceImport';
import { MyWorkforceSchedule } from './MyWorkforceSchedule';

const HAS_FILTERS: Record<string, (e: WorkforceEntry) => boolean> = {
  sick: (e) => e.kind === 'sick', leave: (e) => e.kind === 'leave' || e.kind === 'half_leave', night: (e) => e.kind === 'night',
  draft: (e) => e.status === 'draft', confirm: (e) => e.kind === 'other', unpaid: (e) => e.kind === 'unpaid_leave', absent: (e) => e.kind === 'absent',
  extra: (e) => e.extra_minutes > 0 || e.kind === 'extra_day', training: (e) => e.kind === 'training', ho: (e) => e.kind === 'home_office',
};

export function WorkforceSchedule() {
  const { profile } = useAuth();
  const role = profile?.role ?? '';
  const isSuper = !!profile?.is_super_admin;
  const access = accessLevelFor(role, isSuper);
  const currentHotel = hotelKey(profile?.assigned_hotel);
  const today = todayBudapest();
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) }));
  const data = useWorkforce(ym.y, ym.m);
  const [tab, setTab] = useState('schedule');

  if (access === 'self') return <MyWorkforceSchedule />;

  const canImport = isSuper || ['admin', 'hr'].includes(role);
  const empty = !data.loading && !data.staff.length;

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="staff">Staff</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          {access === 'org' && <TabsTrigger value="settings">Departments & codes</TabsTrigger>}
          {canImport && <TabsTrigger value="import">Import Excel</TabsTrigger>}
        </TabsList>
        <p className="text-xs text-muted-foreground">
          {access === 'org' ? 'Company-wide view' : `Showing ${hotelShort(currentHotel)} — switch hotel to see another team`}
        </p>
      </div>
      {data.error && (
        <Alert variant="destructive"><AlertDescription>
          {/relation .* does not exist|schema cache/i.test(data.error) ? 'The work schedule tables are not installed yet. An administrator needs to apply the database update.' : data.error}
        </AlertDescription></Alert>
      )}
      <TabsContent value="schedule" className="mt-0">
        {empty && !data.error ? (
          <Alert><Info className="h-4 w-4" /><AlertDescription className="flex flex-wrap items-center gap-2">
            No employees in the work schedule yet.
            {canImport ? <Button size="sm" onClick={() => setTab('import')}>Import the Excel workbook</Button> : 'Ask HR to import the workbook or add staff.'}
            <Button size="sm" variant="outline" onClick={() => setTab('staff')}>Add employees</Button>
          </AlertDescription></Alert>
        ) : (
          <ScheduleTab data={data} ym={ym} setYm={setYm} today={today} access={access} currentHotel={currentHotel} role={role} isSuper={isSuper} />
        )}
      </TabsContent>
      <TabsContent value="staff" className="mt-0"><WorkforceStaffPanel data={data} access={access} currentHotel={currentHotel} today={today} /></TabsContent>
      <TabsContent value="analytics" className="mt-0"><WorkforceAnalytics data={data} year={ym.y} month={ym.m} /></TabsContent>
      {access === 'org' && <TabsContent value="settings" className="mt-0"><WorkforceSettings data={data} canEdit={access === 'org'} /></TabsContent>}
      {canImport && <TabsContent value="import" className="mt-0"><WorkforceImport data={data} today={today} onDone={() => void data.reload()} /></TabsContent>}
    </Tabs>
  );
}

interface ScheduleTabProps {
  data: ReturnType<typeof useWorkforce>;
  ym: { y: number; m: number };
  setYm: React.Dispatch<React.SetStateAction<{ y: number; m: number }>>;
  today: string;
  access: 'org' | 'property';
  currentHotel: string | null;
  role: string;
  isSuper: boolean;
}

function ScheduleTab({ data, ym, setYm, today, access, currentHotel, role, isSuper }: ScheduleTabProps) {
  const [query, setQuery] = useState('');
  const [hotel, setHotel] = useState<string>('all');
  const [department, setDepartment] = useState('all');
  const [showFormer, setShowFormer] = useState(false);
  const [layout, setLayout] = useState<'days' | 'staff'>('days');
  const [view, setView] = useState<'grid' | 'day'>(() => (typeof window !== 'undefined' && window.innerWidth < 768 ? 'day' : 'grid'));
  const [details, setDetails] = useState<{ staff: WorkforceStaff; date: string } | null>(null);
  const [noteFor, setNoteFor] = useState<{ staff: WorkforceStaff; text: string } | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [selection, setSelection] = useState<Array<{ staff: WorkforceStaff; date: string }>>([]);
  const [day, setDay] = useState(today);
  const applyRef = useRef<((text: string) => void) | null>(null);

  const days = useMemo(() => monthDays(ym.y, ym.m), [ym]);
  const codes = useMemo(() => customCodesOf(data.shiftCodes), [data.shiftCodes]);
  const deptName = useMemo(() => new Map(data.departments.map((d) => [d.id, d.name])), [data.departments]);
  const deptOrder = useMemo(() => new Map(data.departments.map((d, i) => [d.id, d.sort_order * 1000 + i])), [data.departments]);
  const roleName = useMemo(() => new Map(data.jobRoles.map((r) => [r.id, r.name])), [data.jobRoles]);
  useEffect(() => { if (!days.includes(day)) setDay(days.includes(today) ? today : days[0]); }, [days, day, today]);

  const monthEntriesByStaff = useMemo(() => {
    const map = new Map<string, WorkforceEntry[]>();
    for (const e of data.entries.values()) map.set(e.staff_id, [...(map.get(e.staff_id) ?? []), e]);
    return map;
  }, [data.entries]);

  const visibleStaff = useMemo(() => {
    const words: string[] = [];
    const has: Array<(e: WorkforceEntry) => boolean> = [];
    for (const token of query.trim().split(/\s+/).filter(Boolean)) {
      const m = token.toLowerCase().match(/^(has|is):(\w+)$/);
      if (m && HAS_FILTERS[m[2]]) has.push(HAS_FILTERS[m[2]]); else words.push(token);
    }
    const text = words.join(' ');
    return data.staff
      .filter((s) => {
        const mine = monthEntriesByStaff.get(s.id) ?? [];
        if (!s.is_active && !showFormer && !mine.length) return false;
        if (hotel !== 'all') {
          const h = hotel === 'company' ? null : hotel;
          if (s.hotel_id !== h && !mine.some((e) => e.hotel_id === h)) return false;
        }
        if (department !== 'all' && s.department_id !== department) return false;
        if (has.length && !has.every((f) => mine.some(f))) return false;
        return matchesStaffSearch([s.full_name, s.nickname, deptName.get(s.department_id ?? ''), roleName.get(s.job_role_id ?? ''), hotelShort(s.hotel_id), s.employment_type.replace('_', ' '), s.notes, data.notes.get(s.id)], text);
      })
      .sort((a, b) => (deptOrder.get(a.department_id ?? '') ?? 1e9) - (deptOrder.get(b.department_id ?? '') ?? 1e9)
        || Number(b.is_active) - Number(a.is_active) || a.sort_order - b.sort_order || a.full_name.localeCompare(b.full_name));
  }, [data.staff, data.notes, monthEntriesByStaff, query, hotel, department, showFormer, deptName, roleName, deptOrder]);

  const canEdit = useCallback((date: string, s: WorkforceStaff) =>
    canEditDate(date, today, role, isSuper) && (access === 'org' || s.hotel_id === currentHotel), [today, role, isSuper, access, currentHotel]);

  const onApply = useCallback(async (changes: CellChange[]) => {
    const upserts = changes.filter((c) => c.next).map((c) => c.next!) as WorkforceEntry[];
    const deletes = changes.filter((c) => !c.next).map((c) => ({ staff_id: c.staff.id, work_date: c.date }));
    try {
      await Promise.all([data.saveEntries(upserts), data.deleteEntries(deletes)]);
      return true;
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? 'Could not save the change');
      return false;
    }
  }, [data]);

  const drafts = useMemo(() => {
    const ids = new Set(visibleStaff.filter((s) => access === 'org' || s.hotel_id === currentHotel).map((s) => s.id));
    return [...data.entries.values()].filter((e) => e.status === 'draft' && ids.has(e.staff_id) && canEditDate(e.work_date, today, role, isSuper));
  }, [data.entries, visibleStaff, access, currentHotel, today, role, isSuper]);

  const publish = async () => {
    const ids = [...new Set(drafts.map((d) => d.staff_id))];
    try {
      const n = await data.publish(days[0], days[days.length - 1], ids);
      toast.success(`${n} days published. Employees can now see them in the app.`);
    } catch (err) { toast.error((err as { message?: string })?.message ?? 'Could not publish'); }
    setConfirmPublish(false);
  };

  const exportMonth = async () => {
    const XLSX = await import('xlsx');
    const header1 = ['', ...visibleStaff.map((s) => `${hotelShort(s.hotel_id)} ${roleName.get(s.job_role_id ?? '') ?? ''}`.trim())];
    const header2 = ['Nap', ...visibleStaff.map((s) => s.full_name)];
    const body = days.map((d) => [Number(d.slice(8)), ...visibleStaff.map((s) => textOfEntry(data.entries.get(entryKey(s.id, d)), s.hotel_id))]);
    const notes = ['Megjegyzés', ...visibleStaff.map((s) => data.notes.get(s.id) ?? '')];
    const hours = ['Órák', ...visibleStaff.map((s) => Math.round(days.reduce((n, d) => n + (data.entries.get(entryKey(s.id, d))?.worked_minutes ?? 0), 0) / 6) / 10)];
    const ws = XLSX.utils.aoa_to_sheet([header1, header2, ...body, notes, hours]);
    ws['!cols'] = [{ wch: 5 }, ...visibleStaff.map(() => ({ wch: 14 }))];
    const wb = XLSX.utils.book_new();
    const title = new Date(Date.UTC(ym.y, ym.m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
    XLSX.writeFile(wb, `WORK_SCHEDULE_${ym.y}-${pad2(ym.m)}.xlsx`);
  };

  const shift = (delta: number) => setYm(({ y, m }) => { const d = new Date(Date.UTC(y, m - 1 + delta, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; });
  const monthLabel = new Date(Date.UTC(ym.y, ym.m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const selectionMinutes = selection.reduce((n, c) => n + (data.entries.get(entryKey(c.staff.id, c.date))?.worked_minutes ?? 0), 0);
  const palette = data.shiftCodes.filter((c) => c.is_active);
  const detailsEntry = details ? data.entries.get(entryKey(details.staff.id, details.date)) : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-md border">
          <Button variant="ghost" size="icon" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="min-w-[132px] text-center text-sm font-semibold">{monthLabel}</span>
          <Button variant="ghost" size="icon" onClick={() => shift(1)} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => setYm({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) })}><CalendarDays className="mr-1 h-4 w-4" />Today</Button>
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search name, role, hotel… or has:sick has:leave has:night has:draft" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {access === 'org' && (
          <Select value={hotel} onValueChange={setHotel}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All hotels</SelectItem>
              {HOTELS.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
              <SelectItem value="company">Company / outlets</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Select value={department} onValueChange={setDepartment}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {data.departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <ToggleGroup type="single" value={view === 'day' ? 'day' : layout} onValueChange={(v) => { if (!v) return; if (v === 'day') setView('day'); else { setView('grid'); setLayout(v as 'days' | 'staff'); } }} variant="outline" size="sm">
          <ToggleGroupItem value="days" aria-label="Days down, like the Excel" title="Days down (Excel layout)"><LayoutGrid className="h-4 w-4" /></ToggleGroupItem>
          <ToggleGroupItem value="staff" aria-label="Employees down" title="Employees down"><Rows3 className="h-4 w-4" /></ToggleGroupItem>
          <ToggleGroupItem value="day" aria-label="One day list" title="One day (mobile)"><List className="h-4 w-4" /></ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {view === 'grid' && palette.length > 0 && (
          <div className="flex flex-wrap items-center gap-1" aria-label="Apply a code to the selected cells">
            {palette.slice(0, 18).map((c) => (
              <button key={c.id} type="button" title={`${c.label} — applies to the selected cells`} onClick={() => applyRef.current?.(c.code)}
                className="h-7 rounded border px-2 text-xs font-medium transition hover:ring-2 hover:ring-primary/40"
                style={{ backgroundColor: KIND_STYLE[c.kind].bg, color: KIND_STYLE[c.kind].fg }}>{c.code}</button>
            ))}
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => applyRef.current?.('')}>Clear</Button>
          </div>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs"><Switch checked={showFormer} onCheckedChange={setShowFormer} />Former staff</label>
        <Legend />
        <Button variant="outline" size="sm" onClick={() => void exportMonth()}><Download className="mr-1 h-4 w-4" />Excel</Button>
        <Button size="sm" disabled={!drafts.length} onClick={() => setConfirmPublish(true)}><Send className="mr-1 h-4 w-4" />Publish{drafts.length ? ` ${drafts.length} drafts` : ''}</Button>
      </div>

      {data.loading && !data.staff.length ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading schedule…</div>
      ) : view === 'grid' ? (
        <>
          <WorkforceGrid
            staff={visibleStaff} days={days} today={today} departments={data.departments} jobRoles={data.jobRoles}
            entries={data.entries} notes={data.notes} leaveUsed={data.leaveUsed} codes={codes} layout={layout}
            canEdit={canEdit} onApply={onApply} applyRef={applyRef} onSelectionChange={setSelection}
            onOpenDetails={(staff, date) => setDetails({ staff, date })}
            onEditNote={(staff) => setNoteFor({ staff, text: data.notes.get(staff.id) ?? '' })}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{visibleStaff.length} employees</span>
            {selection.length > 0 && <span>{selection.length} cells selected · {formatHours(selectionMinutes)} h</span>}
            {selection.length === 1 && <button type="button" className="underline" onClick={() => setDetails(selection[0])}>Open details</button>}
            <span>Type a code or times (08-17, éjsz, SZB, B, X, “+1 óra”, “mika”) · Enter/Tab to move · Ctrl+C / Ctrl+V with Excel · Ctrl+D fill down · Ctrl+Z undo · double-click for details · past days are read-only</span>
          </div>
        </>
      ) : (
        <DayList
          day={day} days={days} setDay={setDay} staff={visibleStaff} entries={data.entries} deptName={deptName} roleName={roleName}
          onOpen={(staff) => setDetails({ staff, date: day })}
        />
      )}

      <WorkforceEntryDialog
        open={!!details} staff={details?.staff ?? null} date={details?.date ?? null} entry={detailsEntry}
        readOnly={!details || !canEdit(details.date, details.staff)} codes={data.shiftCodes}
        onClose={() => setDetails(null)}
        onSave={(next) => onApply([{ staff: details!.staff, date: details!.date, next }])}
      />

      <Dialog open={!!noteFor} onOpenChange={(o) => !o && setNoteFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Remark for {noteFor?.staff.full_name} · {monthLabel}</DialogTitle></DialogHeader>
          <Textarea rows={4} maxLength={2000} value={noteFor?.text ?? ''} onChange={(e) => setNoteFor((n) => (n ? { ...n, text: e.target.value } : n))} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteFor(null)}>Cancel</Button>
            <Button disabled={!!noteFor && !(access === 'org' || noteFor.staff.hotel_id === currentHotel)} onClick={() => {
              if (!noteFor) return;
              data.saveNote(noteFor.staff.id, noteFor.text).then(() => setNoteFor(null)).catch((err) => toast.error(err?.message ?? 'Could not save'));
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish {monthLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              {drafts.length} draft days for {new Set(drafts.map((d) => d.staff_id)).size} employees become visible to them in the app. You can still change future days afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void publish()}>Publish</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Legend() {
  const kinds: WorkforceKind[] = ['work', 'night', 'leave', 'half_leave', 'sick', 'unpaid_leave', 'absent', 'fixed_day_off', 'training', 'home_office', 'extra_day', 'other'];
  return (
    <Popover>
      <PopoverTrigger asChild><Button variant="ghost" size="sm"><Info className="mr-1 h-4 w-4" />Legend</Button></PopoverTrigger>
      <PopoverContent className="w-80 space-y-2 text-xs">
        <p className="font-medium">Same colours as the Excel</p>
        <div className="grid grid-cols-2 gap-1">
          {kinds.map((k) => <span key={k} className="rounded px-2 py-1" style={{ backgroundColor: KIND_STYLE[k].bg, color: KIND_STYLE[k].fg }}>{KIND_STYLE[k].label}</span>)}
          {HOTELS.map((h) => HOTEL_STYLE[h.id] && <span key={h.id} className="rounded px-2 py-1" style={{ backgroundColor: HOTEL_STYLE[h.id].bg, color: HOTEL_STYLE[h.id].fg }}>At {h.short}</span>)}
        </div>
        <p className="text-muted-foreground">An amber dot marks a draft the employee cannot see yet. Hatched cells are read-only history.</p>
      </PopoverContent>
    </Popover>
  );
}

function DayList({ day, days, setDay, staff, entries, deptName, roleName, onOpen }: {
  day: string; days: string[]; setDay: (d: string) => void; staff: WorkforceStaff[]; entries: Map<string, WorkforceEntry>;
  deptName: Map<string, string>; roleName: Map<string, string>; onOpen: (s: WorkforceStaff) => void;
}) {
  const i = days.indexOf(day);
  const groups = new Map<string, WorkforceStaff[]>();
  for (const s of staff) { const k = s.department_id ?? 'none'; groups.set(k, [...(groups.get(k) ?? []), s]); }
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const working = staff.filter((s) => { const e = entries.get(entryKey(s.id, day)); return e && ['work', 'night', 'training', 'home_office', 'extra_day'].includes(e.kind); }).length;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md border p-1">
        <Button variant="ghost" size="icon" disabled={i <= 0} onClick={() => setDay(days[i - 1])} aria-label="Previous day"><ChevronLeft className="h-4 w-4" /></Button>
        <div className="text-center"><div className="text-sm font-semibold">{label}</div><div className="text-xs text-muted-foreground">{working} working</div></div>
        <Button variant="ghost" size="icon" disabled={i >= days.length - 1} onClick={() => setDay(days[i + 1])} aria-label="Next day"><ChevronRight className="h-4 w-4" /></Button>
      </div>
      {[...groups].map(([k, list]) => (
        <div key={k} className="rounded-md border">
          <div className="border-b bg-muted/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide">{deptName.get(k) ?? 'No department'}</div>
          <ul className="divide-y">
            {list.map((s) => {
              const e = entries.get(entryKey(s.id, day));
              const st = e ? cellStyle(e, s.hotel_id) : null;
              return (
                <li key={s.id}>
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onOpen(s)}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{s.nickname || s.full_name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{roleName.get(s.job_role_id ?? '') ?? ''} · {hotelShort(s.hotel_id)}</span>
                    </span>
                    {e ? <span className="rounded px-2 py-0.5 text-xs" style={{ backgroundColor: st!.bg, color: st!.fg }}>{e.kind === 'fixed_day_off' ? 'FIX' : cellLabel(e)}</span> : <span className="text-xs text-muted-foreground">—</span>}
                    {e?.status === 'draft' && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {!staff.length && <p className="text-sm text-muted-foreground">No employees match.</p>}
      <p className="text-center text-xs text-muted-foreground">{WEEKDAY_SHORT[weekdayOf(day)]} · tap an employee to change the day</p>
    </div>
  );
}
