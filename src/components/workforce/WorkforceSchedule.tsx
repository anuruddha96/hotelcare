import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BellRing, CalendarDays, ChevronLeft, ChevronRight, Copy, Download, Eye, FileSpreadsheet, HelpCircle, History, Info, LayoutGrid, List, Loader2, Maximize2, Minimize2, MoreHorizontal, Rows3, Search, Send, Sparkles, X, ZoomIn, ZoomOut } from 'lucide-react';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/hooks/useTranslation';
import { loadGridPrefs, saveGridPrefs, stepZoom, type GridPrefs } from '@/lib/workforce/gridPrefs';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useAccessPolicy, useWorkforceScope } from '@/hooks/useAccessPolicy';
import { entryKey, fetchAllRows, useWorkforce } from '@/hooks/useWorkforce';
import { supabase } from '@/integrations/supabase/client';
import { calendarDay, calendarDayName, swapsKnown, workingDays } from '@/lib/workforce/holidays';
import { DEFAULT_SHIFT_CODES } from '@/lib/workforce/excelImport';
import { cn } from '@/lib/utils';
import { todayBudapest } from '@/lib/budapestTime';
import {
  accessLevelFor, cellLabel, cellStyle, formatHours, hasPendingChange, HOTEL_STYLE, HOTELS, hotelKey, hotelShort, intlLocale, KIND_STYLE,
  matchesStaffSearch, monthDays, pad2, type AccessLevel, type CellLabels, type WorkforceEntry, type WorkforceKind, type WorkforceStaff,
} from '@/lib/workforce/model';
import { COMPANY_VENUE, inVenue, matchesStatus, noticeIndex, STATUS_FILTERS, venueTabs, type StatusFilter } from '@/lib/workforce/view';
import { entryFromSnapshot, type RestoreChange } from '@/lib/workforce/history';
import { useCellLabels } from '@/hooks/useWorkforceLabels';
import { useWorkforcePresence } from '@/hooks/useWorkforcePresence';
import { useUnpublishedWork, type UnpublishedWork } from '@/hooks/useWorkforcePending';
import { countText, isUrgent, monthTitle, publishTiming, type MonthWork } from '@/lib/workforce/pending';
import { WorkforceStaffDialog } from './WorkforceStaffDialog';
import { WorkforceHistory } from './WorkforceHistory';
import { localName } from '@/lib/workforce/names';
import { customCodesOf, textOfEntry } from '@/lib/workforce/grid';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const NO_COPY_KINDS = new Set(['leave', 'half_leave', 'sick', 'unpaid_leave', 'absent', 'other']);
const fill = (text: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((out, [key, value]) => out.split(`{${key}}`).join(String(value)), text);

/** First day a planner on this level may still change (mirrors public.workforce_can_edit_date). */
function editableFrom(access: AccessLevel, today: string): string {
  if (access !== 'org') return today;
  const [y, m] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** "24 November", "november 24." … */
const dayMonth = (date: string, locale: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' });
/** The month's name as used inside a sentence ("December", "december", "декабрь"). */
const monthWord = (month: string, locale: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, { month: 'long', timeZone: 'UTC' });
};

/** One month of unpublished work in plain words: who is affected, and by when to publish. */
function describeMonthWork(work: MonthWork, today: string, t: (key: string) => string, locale: string) {
  const timing = publishTiming(work.month, today);
  const people = [
    work.notReceived.length ? countText(t, locale, 'wf.r.notReceived', work.notReceived.length) : null,
    work.changed.length ? countText(t, locale, 'wf.r.changed', work.changed.length) : null,
  ].filter((part): part is string => !!part);
  const when = timing.kind === 'ahead' ? fill(t('wf.r.deadline'), { date: dayMonth(timing.deadline, locale) })
    : timing.kind === 'late' ? fill(t('wf.r.late'), { date: dayMonth(timing.starts, locale) })
      : fill(t('wf.r.from'), { date: dayMonth(work.earliest, locale) });
  return { people, when, urgent: isUrgent(timing) };
}

export function WorkforceSchedule() {
  const { user, profile } = useAuth();
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const role = profile?.role ?? '';
  const isSuper = !!profile?.is_super_admin;
  const policy = useAccessPolicy();
  // The database decides the planning scope (managers named by the owner plan
  // every hotel there); the role is only the answer while that loads.
  const scope = useWorkforceScope();
  const access: AccessLevel = scope.accessLevel ?? accessLevelFor(role, isSuper);
  // Housekeeping managers read every hotel but plan only their own.
  const viewAll = access === 'org' || policy.scheduleViewAll;
  const pinned = policy.scheduleScope === 'home_hotel';
  const currentHotel = (pinned && scope.hotelId ? hotelKey(scope.hotelId) : null) ?? hotelKey(profile?.assigned_hotel);
  const today = todayBudapest();
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) }));
  const data = useWorkforce(ym.y, ym.m);
  const [tab, setTab] = useState('schedule');

  // --- What still waits for this planner to publish ---------------------------
  const me = access === 'self' ? null : user?.id ?? profile?.id ?? null;
  const [pendingKey, setPendingKey] = useState(0);
  const pendingTimer = useRef<number | null>(null);
  /** Re-read the unpublished work; edits come in bursts, so wait for a quiet moment. */
  const refreshPending = useCallback((now = false) => {
    if (pendingTimer.current) window.clearTimeout(pendingTimer.current);
    if (now) setPendingKey((n) => n + 1);
    else pendingTimer.current = window.setTimeout(() => setPendingKey((n) => n + 1), 1200);
  }, []);
  const pending = useUnpublishedWork(me, today, pendingKey);
  /** Months this planner changed during this visit (for the reminder when leaving the page). */
  const editedMonths = useRef(new Set<string>());
  const onEdited = useCallback((month: string) => { editedMonths.current.add(month); refreshPending(); }, [refreshPending]);
  const onPublished = useCallback((month: string) => { editedMonths.current.delete(month); refreshPending(true); }, [refreshPending]);
  const latest = useRef({ pending, t, locale: intlLocale(language), home: `/${profile?.organization_slug || 'rdhotels'}?view=staff-schedule` });
  latest.current = { pending, t, locale: intlLocale(language), home: `/${profile?.organization_slug || 'rdhotels'}?view=staff-schedule` };
  // Leaving the page with own changes that nobody can see yet: say so once, with a way back.
  useEffect(() => () => {
    if (pendingTimer.current) window.clearTimeout(pendingTimer.current);
    const { pending: work, t: tr, locale, home } = latest.current;
    const months = work.mine.filter((m) => editedMonths.current.has(m.month));
    if (!months.length) return;
    const description = (
      <span className="block space-y-0.5">
        {months.map((m) => <span key={m.month} className="block">{monthTitle(m.month, locale)}: {describeMonthWork(m, todayBudapest(), tr, locale).people.join(' ')}</span>)}
      </span>
    );
    void supabase.auth.getSession().then(({ data: session }) => {
      if (!session.session) return; // signed out: nothing to remind
      toast.warning(tr('wf.r.leaveTitle'), { description, duration: 15000, action: { label: tr('wf.r.back'), onClick: () => navigate(home) } });
    }, () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (access === 'self') return <MyWorkforceSchedule />;

  const canImport = access === 'org';
  const empty = !data.loading && !data.staff.length;

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="schedule">{t('wf.tab.schedule')}</TabsTrigger>
          <TabsTrigger value="staff">{t('wf.tab.staff')}</TabsTrigger>
          <TabsTrigger value="analytics">{t('wf.tab.analytics')}</TabsTrigger>
          {access === 'org' && <TabsTrigger value="settings">{t('wf.tab.settings')}</TabsTrigger>}
          {canImport && <TabsTrigger value="import">{t('wf.tab.import')}</TabsTrigger>}
        </TabsList>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          {access !== 'org' && viewAll && <Eye className="h-3.5 w-3.5" />}
          {access === 'org' ? t('wf.scope.org') : fill(t(viewAll ? 'wf.scope.viewAll' : 'wf.scope.hotel'), { hotel: hotelShort(currentHotel) })}
        </p>
      </div>
      {data.error && (
        <Alert variant="destructive"><AlertDescription>
          {/relation .* does not exist|schema cache/i.test(data.error) ? t('wf.err.notInstalled') : data.error}
        </AlertDescription></Alert>
      )}
      <TabsContent value="schedule" className="mt-0">
        {empty && !data.error && (
          <Alert className="mb-3"><Info className="h-4 w-4" /><AlertDescription className="flex flex-wrap items-center gap-2">
            {t('wf.empty.none')}
            {canImport ? <Button size="sm" onClick={() => setTab('import')}><FileSpreadsheet className="mr-1 h-4 w-4" />{t('wf.empty.importBtn')}</Button> : t('wf.empty.askHr')}
            <Button size="sm" variant="outline" onClick={() => setTab('staff')}>{t('wf.empty.add')}</Button>
          </AlertDescription></Alert>
        )}
        <ScheduleTab data={data} ym={ym} setYm={setYm} today={today} access={access} viewAll={viewAll} currentHotel={currentHotel}
          canAskMira={policy.mira} canPlanWithMira={policy.mira && policy.scheduleBuilder}
          onImport={canImport ? () => setTab('import') : undefined}
          me={me} pending={pending} onEdited={onEdited} onPublished={onPublished} onRemoteChange={refreshPending} />
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
  /** May read every hotel (planning stays limited by `access`). */
  viewAll: boolean;
  currentHotel: string | null;
  canAskMira: boolean;
  canPlanWithMira: boolean;
  onImport?: () => void;
  /** The signed-in planner (profile id). */
  me: string | null;
  /** What still waits for Publish, from today on. */
  pending: UnpublishedWork;
  /** This planner saved changes in a month. */
  onEdited: (month: string) => void;
  onPublished: (month: string) => void;
  /** Another planner saved changes. */
  onRemoteChange: () => void;
}

function ScheduleTab({ data, ym, setYm, today, access, viewAll, currentHotel, canAskMira, canPlanWithMira, onImport, me, pending, onEdited, onPublished, onRemoteChange }: ScheduleTabProps) {
  const { t, language } = useTranslation();
  const cellLabels = useCellLabels();
  const locale = intlLocale(language);
  const [query, setQuery] = useState('');
  // Company-level planners start with every venue; everyone else with their own hotel.
  const [venue, setVenue] = useState<string>(() => (access === 'org' ? 'all' : currentHotel ?? 'all'));
  const [department, setDepartment] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [showFormer, setShowFormer] = useState(false);
  const [layout, setLayout] = useState<'days' | 'staff'>('days');
  const [view, setView] = useState<'grid' | 'day'>(() => (typeof window !== 'undefined' && window.innerWidth < 768 ? 'day' : 'grid'));
  const [details, setDetails] = useState<{ staff: WorkforceStaff; date: string } | null>(null);
  const [noteFor, setNoteFor] = useState<{ staff: WorkforceStaff; text: string } | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishReason, setPublishReason] = useState('');
  const [copyPlan, setCopyPlan] = useState<{ rows: WorkforceEntry[]; staff: number } | null>(null);
  const [copying, setCopying] = useState(false);
  const [selection, setSelection] = useState<Array<{ staff: WorkforceStaff; date: string }>>([]);
  const [day, setDay] = useState(today);
  const applyRef = useRef<((text: string) => void) | null>(null);
  const [prefs, setPrefs] = useState<GridPrefs>(loadGridPrefs);
  const [fullscreen, setFullscreen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editStaff, setEditStaff] = useState<WorkforceStaff | null>(null);
  /** Tells the other planners that this month changed (set once the live channel is up). */
  const announceRef = useRef<(month: string) => void>(() => undefined);
  const updatePrefs = useCallback((patch: Partial<GridPrefs>) => setPrefs((current) => { const next = { ...current, ...patch }; saveGridPrefs(next); return next; }), []);
  const zoomStep = useCallback((direction: 1 | -1) => setPrefs((current) => { const next = { ...current, zoom: stepZoom(current.zoom, direction) }; saveGridPrefs(next); return next; }), []);
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && !(ev.target as HTMLElement | null)?.closest('input,textarea,[role="dialog"]')) setFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);
  // Someone without the all-hotels view always looks at their own hotel.
  useEffect(() => { if (!viewAll) setVenue(currentHotel ?? 'all'); }, [viewAll, currentHotel]);

  const monthNames = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const name = new Date(Date.UTC(2026, i, 1)).toLocaleDateString(locale, { month: 'long', timeZone: 'UTC' });
    return name.charAt(0).toUpperCase() + name.slice(1);
  }), [locale]);

  const days = useMemo(() => monthDays(ym.y, ym.m), [ym]);
  const monthKey = `${ym.y}-${pad2(ym.m)}`;
  const codes = useMemo(() => customCodesOf(data.shiftCodes), [data.shiftCodes]);
  const deptName = useMemo(() => new Map(data.departments.map((d) => [d.id, d.name])), [data.departments]);
  const deptOrder = useMemo(() => new Map(data.departments.map((d, i) => [d.id, d.sort_order * 1000 + i])), [data.departments]);
  const roleName = useMemo(() => new Map(data.jobRoles.map((r) => [r.id, r.name])), [data.jobRoles]);
  const roleOrder = useMemo(() => new Map(data.jobRoles.map((r, i) => [r.id, r.sort_order * 1000 + i])), [data.jobRoles]);
  const notices = useMemo(() => noticeIndex(data.notices), [data.notices]);
  useEffect(() => { if (!days.includes(day)) setDay(days.includes(today) ? today : days[0]); }, [days, day, today]);

  const monthEntriesByStaff = useMemo(() => {
    const map = new Map<string, WorkforceEntry[]>();
    for (const e of data.entries.values()) map.set(e.staff_id, [...(map.get(e.staff_id) ?? []), e]);
    return map;
  }, [data.entries]);
  const openNoticesByStaff = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of data.notices) map.set(n.staff_id, (map.get(n.staff_id) ?? 0) + 1);
    return map;
  }, [data.notices]);

  // People who belong to this month at all (active, or with days in it).
  const monthStaff = useMemo(() => data.staff.filter((s) => s.is_active || showFormer || (monthEntriesByStaff.get(s.id)?.length ?? 0) > 0),
    [data.staff, showFormer, monthEntriesByStaff]);
  const venues = useMemo(() => venueTabs(monthStaff), [monthStaff]);
  const venueStaff = useMemo(() => monthStaff.filter((s) => inVenue(s, monthEntriesByStaff.get(s.id) ?? [], venue)), [monthStaff, monthEntriesByStaff, venue]);
  const teams = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of venueStaff) if (s.department_id) counts.set(s.department_id, (counts.get(s.department_id) ?? 0) + 1);
    return data.departments.filter((d) => counts.has(d.id)).map((d) => ({ id: d.id, name: d.name, color: d.color, count: counts.get(d.id)! }));
  }, [venueStaff, data.departments]);
  // A team that does not exist in the chosen venue cannot stay selected.
  useEffect(() => { if (department !== 'all' && !teams.some((d) => d.id === department)) setDepartment('all'); }, [teams, department]);

  const hotelOrder = useCallback((id: string | null) => { const i = HOTELS.findIndex((h) => h.id === id); return id === null ? 99 : i < 0 ? 50 : i; }, []);
  const visibleStaff = useMemo(() => venueStaff
    .filter((s) => {
      if (department !== 'all' && s.department_id !== department) return false;
      if (!matchesStatus(status, monthEntriesByStaff.get(s.id) ?? [], openNoticesByStaff.get(s.id) ?? 0, { me, today })) return false;
      return matchesStaffSearch([s.full_name, s.nickname, deptName.get(s.department_id ?? ''), roleName.get(s.job_role_id ?? ''), hotelShort(s.hotel_id), s.employment_type.replace('_', ' '), s.notes, data.notes.get(s.id)], query);
    })
    .sort((a, b) => (deptOrder.get(a.department_id ?? '') ?? 1e9) - (deptOrder.get(b.department_id ?? '') ?? 1e9)
      || hotelOrder(a.hotel_id) - hotelOrder(b.hotel_id)
      || (roleOrder.get(a.job_role_id ?? '') ?? 1e9) - (roleOrder.get(b.job_role_id ?? '') ?? 1e9)
      || Number(b.is_active) - Number(a.is_active) || a.sort_order - b.sort_order || a.full_name.localeCompare(b.full_name)),
  [venueStaff, data.notes, monthEntriesByStaff, openNoticesByStaff, query, department, status, me, today, deptName, roleName, deptOrder, roleOrder, hotelOrder]);

  const firstEditable = editableFrom(access, today);
  const mayPlan = useCallback((s: WorkforceStaff) => access === 'org' || s.hotel_id === currentHotel, [access, currentHotel]);
  const canEdit = useCallback((date: string, s: WorkforceStaff) => date >= firstEditable && mayPlan(s), [firstEditable, mayPlan]);
  const viewOnly = visibleStaff.length > 0 && !visibleStaff.some(mayPlan);

  const onApply = useCallback(async (changes: CellChange[]) => {
    const upserts: WorkforceEntry[] = [];
    const deletes: Array<{ staff_id: string; work_date: string }> = [];
    for (const c of changes) {
      const current = data.entries.get(entryKey(c.staff.id, c.date));
      if (c.next) upserts.push(c.next);
      // The employee has already seen this day: emptying it is a change to
      // "day off" that waits for Publish, not a silent removal.
      else if (current && (current.status === 'published' || current.published_version)) {
        upserts.push({
          staff_id: c.staff.id, work_date: c.date, kind: 'day_off', code: null, start_time: null, end_time: null, day_fraction: 1,
          extra_minutes: 0, hotel_id: c.staff.hotel_id, raw_text: null, note: null, status: 'draft',
        });
      } else deletes.push({ staff_id: c.staff.id, work_date: c.date });
    }
    try {
      await Promise.all([data.saveEntries(upserts), data.deleteEntries(deletes)]);
      announceRef.current(monthKey);
      onEdited(monthKey);
      return true;
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? t('wf.g.saveFail'));
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, monthKey, onEdited]);

  // --- What Publish (toolbar) would publish: the unpublished days of the employees shown ---
  const drafts = useMemo(() => {
    const ids = new Set(visibleStaff.filter(mayPlan).map((s) => s.id));
    return [...data.entries.values()].filter((e) => e.status === 'draft' && ids.has(e.staff_id) && e.work_date >= firstEditable);
  }, [data.entries, visibleStaff, mayPlan, firstEditable]);
  const draftPeople = useMemo(() => [...new Set(drafts.map((d) => d.staff_id))], [drafts]);
  /** The employee already received this month: what changes now reaches them as a notice to confirm. */
  const hasMonth = useCallback((id: string) => pending.received.has(`${id}|${monthKey}`)
    || (monthEntriesByStaff.get(id) ?? []).some((e) => e.status === 'published' || !!e.published_version), [pending.received, monthKey, monthEntriesByStaff]);
  const publishPlan = useMemo(() => {
    const fresh: string[] = [];
    const notified: string[] = [];
    const upcoming = new Set(drafts.filter((d) => d.work_date >= today).map((d) => d.staff_id));
    for (const id of draftPeople) {
      if (!hasMonth(id)) fresh.push(id);
      else if (upcoming.has(id)) notified.push(id); // changes to past days are corrections: nobody is notified
    }
    const otherNames = me ? [...new Set(drafts.filter((d) => d.updated_by !== me)
      .map((d) => (d.updated_by && pending.names.get(d.updated_by)) || t('wf.r.someone')))] : [];
    return { fresh, notified, otherNames };
  }, [drafts, draftPeople, hasMonth, today, me, pending.names, t]);
  const shortNotice = useMemo(() => {
    const limit = new Date(Date.parse(`${today}T12:00:00Z`) + 4 * 86400000).toISOString().slice(0, 10);
    return drafts.filter((e) => e.work_date >= today && e.work_date < limit && (hasPendingChange(e) || hasMonth(e.staff_id))).length;
  }, [drafts, today, hasMonth]);

  // --- One shared calendar: who else is here, and refresh when they save ----
  const reloadTimer = useRef<number | null>(null);
  const lastNotice = useRef(0);
  const { others, announce } = useWorkforcePresence({ month: monthKey, venue }, (event) => {
    onRemoteChange();
    if (event.month !== monthKey) return;
    if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => {
      void data.reload();
      if (Date.now() - lastNotice.current > 20_000) { lastNotice.current = Date.now(); toast.info(fill(t('wf.live.updated'), { name: event.name })); }
    }, 900);
  });
  announceRef.current = announce;
  useEffect(() => () => { if (reloadTimer.current) window.clearTimeout(reloadTimer.current); }, []);

  // --- Reminder: this planner's own work that staff cannot see yet ----------
  const myPendingMonths = useMemo(() => new Set(pending.mine.map((m) => m.month)), [pending.mine]);
  const reminderUrgent = pending.mine.some((m) => isUrgent(publishTiming(m.month, today)));
  // Company-level planners also see who else has not published yet.
  const othersWaiting = useMemo(() => {
    if (access !== 'org') return [];
    const byMonth = new Map<string, Set<string>>();
    for (const o of pending.others) {
      const name = (o.plannerId && pending.names.get(o.plannerId)) || t('wf.r.someone');
      byMonth.set(o.month, (byMonth.get(o.month) ?? new Set()).add(name));
    }
    return [...byMonth].map(([month, names]) => ({ month, names: [...names] }));
  }, [access, pending.others, pending.names, t]);
  /** Show the month with only the employees this planner still has to publish; optionally publish right away. */
  const openMine = (month: string, publishNow: boolean) => {
    const [y, m] = month.split('-').map(Number);
    setQuery(''); setDepartment('all'); setStatus('mine');
    if (viewAll) setVenue('all');
    setYm({ y, m });
    if (publishNow) setConfirmPublish(true);
  };
  const openDrafts = (month: string) => {
    const [y, m] = month.split('-').map(Number);
    setQuery(''); setDepartment('all'); setStatus('draft');
    if (viewAll) setVenue('all');
    setYm({ y, m });
  };

  const monthLabel = (() => {
    const text = new Date(Date.UTC(ym.y, ym.m - 1, 1)).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return text.charAt(0).toUpperCase() + text.slice(1);
  })();

  const publish = async () => {
    const ids = draftPeople;
    // An empty list would mean "everyone" to the database: never send it.
    if (!ids.length) { setConfirmPublish(false); return; }
    const since = new Date(Date.now() - 120_000).toISOString();
    try {
      const n = await data.publish(days[0], days[days.length - 1], ids);
      if (n > 0) toast.success(countText(t, locale, 'wf.p.donePeople', ids.length));
      announce(monthKey);
      onPublished(monthKey);
      // Nothing is left behind the "my changes" filter: show everyone again.
      if (status === 'mine' || status === 'draft') setStatus('all');
      const reason = publishReason.trim();
      if (reason && ids.length) {
        // The reason goes onto the notices this publication just created.
        const { data: created } = await db.from('workforce_change_notices').select('id')
          .is('acknowledged_at', null).is('reason', null).in('staff_id', ids)
          .gte('work_date', days[0]).lte('work_date', days[days.length - 1]).gte('changed_at', since);
        await data.setChangeReason((created ?? []).map((r: { id: string }) => r.id), reason);
      }
    } catch (err) { toast.error((err as { message?: string })?.message ?? t('wf.p.fail')); }
    setConfirmPublish(false);
    setPublishReason('');
  };

  /**
   * Plan the month from the last four weeks: each empty, editable day takes the
   * shift of the same weekday 28 days earlier (absences are not copied).
   */
  const prepareCopy = async () => {
    setCopying(true);
    try {
      const people = visibleStaff.filter((s) => s.is_active && mayPlan(s));
      const ids = people.map((s) => s.id);
      const back = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
      const from = back(days[0], 28), to = back(days[0], 1);
      const prev = ids.length ? await fetchAllRows<WorkforceEntry>((a, b) => db.from('workforce_entries')
        .select('staff_id,work_date,kind,code,start_time,end_time,day_fraction,extra_minutes,hotel_id,note,status')
        .in('staff_id', ids).gte('work_date', from).lte('work_date', to).order('work_date').order('staff_id').range(a, b)) : [];
      const source = new Map<string, WorkforceEntry>(prev.map((e) => [entryKey(e.staff_id, e.work_date), e]));
      const rows: WorkforceEntry[] = [];
      const touched = new Set<string>();
      for (const s of people) {
        for (const d of days) {
          if (!canEdit(d, s) || data.entries.has(entryKey(s.id, d))) continue;
          const key = entryKey(s.id, back(d, 28));
          const src = source.get(key) ?? data.entries.get(key) ?? rows.find((r) => r.staff_id === s.id && r.work_date === back(d, 28));
          if (!src || NO_COPY_KINDS.has(src.kind)) continue;
          rows.push({
            staff_id: s.id, work_date: d, kind: src.kind, code: src.code, start_time: src.start_time?.slice(0, 5) ?? null,
            end_time: src.end_time?.slice(0, 5) ?? null, day_fraction: Number(src.day_fraction ?? 1), extra_minutes: 0,
            hotel_id: src.hotel_id, raw_text: null, note: null, status: 'draft',
          });
          touched.add(s.id);
        }
      }
      if (!rows.length) toast.info(t('wf.c4.nothing'));
      else setCopyPlan({ rows, staff: touched.size });
    } catch (err) { toast.error((err as { message?: string })?.message ?? t('wf.g.saveFail')); }
    finally { setCopying(false); }
  };
  const runCopy = async () => {
    if (!copyPlan) return;
    try { await data.saveEntries(copyPlan.rows); announce(monthKey); onEdited(monthKey); toast.success(fill(t('wf.c4.done'), { n: copyPlan.rows.length })); }
    catch (err) { toast.error((err as { message?: string })?.message ?? t('wf.g.saveFail')); }
    setCopyPlan(null);
  };

  /** History › Restore: the chosen days go back as drafts; days this person may not change are skipped. */
  const restore = async (changes: RestoreChange[]) => {
    const byId = new Map(visibleStaff.map((s) => [s.id, s]));
    const allowed: CellChange[] = [];
    for (const c of changes) {
      const person = byId.get(c.staff_id);
      if (!person || !canEdit(c.work_date, person)) continue;
      allowed.push({ staff: person, date: c.work_date, next: c.target ? entryFromSnapshot(c.staff_id, c.work_date, c.target) : null });
    }
    const ok = allowed.length ? await onApply(allowed) : true;
    return { done: ok ? allowed.length : 0, skipped: changes.length - (ok ? allowed.length : 0) };
  };

  const monthCalendar = useMemo(() => days.map((d) => calendarDay(d)).filter(Boolean) as NonNullable<ReturnType<typeof calendarDay>>[], [days]);
  const venueName = (id: string) => (id === 'all' ? t('wf.m.allHotels') : id === COMPANY_VENUE ? t('wf.m.company') : hotelShort(id));
  const teamLabel = [venue === 'all' ? null : venueName(venue), department === 'all' ? null : localName(deptName.get(department), t)].filter(Boolean).join(' · ') || t('wf.n.wholeTeam');
  const askMira = (key: string) => window.dispatchEvent(new CustomEvent('hotelcare:ask-ai', { detail: { prompt: fill(t(key), { month: monthLabel, team: teamLabel }) } }));

  const exportMonth = async () => {
    const XLSX = await import('xlsx');
    const header1 = ['', '', ...visibleStaff.map((s) => `${s.hotel_id ? hotelShort(s.hotel_id) : ''} ${roleName.get(s.job_role_id ?? '') ?? ''}`.trim())];
    const header2 = [t('wf.m.day'), t('wf.my.holiday'), ...visibleStaff.map((s) => s.full_name)];
    const body = days.map((d) => { const special = calendarDay(d); return [Number(d.slice(8)), special ? calendarDayName(special, t, language) : '', ...visibleStaff.map((s) => textOfEntry(data.entries.get(entryKey(s.id, d)), s.hotel_id))]; });
    const notes = [t('wf.m.note'), '', ...visibleStaff.map((s) => data.notes.get(s.id) ?? '')];
    const hours = [t('wf.t.hours'), '', ...visibleStaff.map((s) => Math.round(days.reduce((n, d) => n + (data.entries.get(entryKey(s.id, d))?.worked_minutes ?? 0), 0) / 6) / 10)];
    const ws = XLSX.utils.aoa_to_sheet([header1, header2, ...body, notes, hours]);
    ws['!cols'] = [{ wch: 5 }, { wch: 18 }, ...visibleStaff.map(() => ({ wch: 14 }))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, monthLabel.slice(0, 31));
    XLSX.writeFile(wb, `WORK_SCHEDULE_${ym.y}-${pad2(ym.m)}.xlsx`);
  };

  const selectionMinutes = selection.reduce((n, c) => n + (data.entries.get(entryKey(c.staff.id, c.date))?.worked_minutes ?? 0), 0);
  const palette = data.shiftCodes.some((c) => c.is_active)
    ? data.shiftCodes.filter((c) => c.is_active)
    : DEFAULT_SHIFT_CODES.map((c) => ({ ...c, id: c.code, hotel_id: null, is_active: true }));
  const detailsEntry = details ? data.entries.get(entryKey(details.staff.id, details.date)) : undefined;
  const filtered = venue !== (access === 'org' ? 'all' : currentHotel ?? 'all') || department !== 'all' || status !== 'all' || !!query.trim();
  const resetFilters = () => { setQuery(''); setDepartment('all'); setStatus('all'); if (viewAll) setVenue(access === 'org' ? 'all' : currentHotel ?? 'all'); };
  const monthIsEmpty = !data.loading && visibleStaff.length > 0 && !viewOnly && days[days.length - 1] >= today
    && !visibleStaff.some((s) => (monthEntriesByStaff.get(s.id)?.length ?? 0) > 0);
  const chip = (active: boolean) => cn('inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs transition',
    active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background text-foreground hover:bg-muted');

  return (
    <div className={cn('space-y-2', fullscreen && 'fixed inset-0 z-40 overflow-auto bg-background p-3')}>
      {/* What still waits for this planner to publish, and who else is planning right now */}
      {(others.length > 0 || pending.mine.length > 0) && (
        <div className="flex flex-wrap items-start gap-2">
          {pending.mine.length > 0 && (
            <div role="status" data-training="wf-publish-reminder"
              className={cn('min-w-[280px] flex-1 rounded-md border px-3 py-2 text-sm', reminderUrgent
                ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
                : 'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100')}>
              <p className="flex items-center gap-1.5 font-semibold"><BellRing className="h-4 w-4 shrink-0" />{t('wf.r.title')}</p>
              <ul className="mt-1.5 space-y-1.5">
                {pending.mine.map((m) => {
                  const here = m.month === monthKey;
                  const text = describeMonthWork(m, today, t, locale);
                  return (
                    <li key={m.month} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="min-w-[240px] flex-1">
                        <span className="font-semibold">{monthTitle(m.month, locale)}</span>
                        <span className="mx-1.5 opacity-50">—</span>
                        {text.people.join(' ')}
                        <span className={cn('ml-1', text.urgent ? 'font-semibold' : 'opacity-80')}>{text.when}</span>
                      </span>
                      <Button size="sm" variant={here ? 'default' : 'outline'} className={cn('h-7 shrink-0', !here && 'bg-background/80')}
                        onClick={() => openMine(m.month, here)}>
                        {here ? <Send className="mr-1 h-3.5 w-3.5" /> : <ArrowRight className="mr-1 h-3.5 w-3.5" />}
                        {capitalize(fill(t(here ? 'wf.r.publishMonth' : 'wf.r.open'), { month: monthWord(m.month, locale) }))}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {others.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs" data-training="wf-presence">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
              <span className="text-muted-foreground">{t('wf.pr.here')}:</span>
              {others.map((o) => (
                <span key={o.id} className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
                  title={fill(t('wf.pr.viewing'), { name: o.name, where: `${monthNames[Number(o.month.slice(5, 7)) - 1] ?? ''} · ${venueName(o.venue || 'all')}` })}>
                  {o.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {othersWaiting.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-training="wf-others-pending">
          <span>{t('wf.r.others')}</span>
          {othersWaiting.map((o) => (
            <button key={o.month} type="button" onClick={() => openDrafts(o.month)} className="rounded-full border bg-background px-2 py-0.5 hover:bg-muted">
              <span className="font-medium text-foreground">{monthTitle(o.month, locale)}</span> — {o.names.join(', ')}
            </button>
          ))}
        </div>
      )}

      {/* 1. Which month */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b" role="tablist" aria-label={t('wf.my.month')}>
        <Button variant="ghost" size="sm" className="h-7 px-1.5" onClick={() => setYm(({ y, m }) => ({ y: y - 1, m }))} aria-label={t('wf.m.prevYear')}><ChevronLeft className="h-4 w-4" /></Button>
        <span className="px-1 text-sm font-semibold tabular-nums">{ym.y}</span>
        <Button variant="ghost" size="sm" className="h-7 px-1.5" onClick={() => setYm(({ y, m }) => ({ y: y + 1, m }))} aria-label={t('wf.m.nextYear')}><ChevronRight className="h-4 w-4" /></Button>
        {monthNames.map((name, i) => {
          const active = ym.m === i + 1;
          const isNow = Number(today.slice(0, 4)) === ym.y && Number(today.slice(5, 7)) === i + 1;
          return (
            <button key={i} type="button" role="tab" aria-selected={active} onClick={() => setYm(({ y }) => ({ y, m: i + 1 }))}
              className={cn('-mb-px rounded-t-md border border-b-0 px-2.5 py-1 text-xs transition',
                active ? 'border-primary bg-primary font-semibold text-primary-foreground shadow-sm' : 'border-transparent text-muted-foreground hover:bg-muted',
                isNow && !active && 'font-semibold text-primary')}>
              {name}{isNow && !active && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" />}
              {myPendingMonths.has(`${ym.y}-${pad2(i + 1)}`) && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle ring-1 ring-background" title={t('wf.r.title')} />}
            </button>
          );
        })}
        <span className="ml-auto flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
          <span><strong className="text-foreground">{workingDays(days)}</strong> {t('wf.m.workingDays')}</span>
          {monthCalendar.map((d) => (
            <span key={d.date} className={d.kind === 'working_saturday' ? 'text-sky-600 dark:text-sky-400' : 'text-red-600 dark:text-red-400'}>{Number(d.date.slice(8))}. {calendarDayName(d, t, language)}</span>
          ))}
          {!swapsKnown(ym.y) && <span title={t('wf.h.rest_day')}>ⓘ</span>}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setYm({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) })}><CalendarDays className="mr-1 h-3.5 w-3.5" />{t('wf.m.today')}</Button>
        </span>
      </div>

      {/* 2. Which venue and team */}
      {viewAll && venues.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label={t('wf.m.allHotels')} data-training="wf-venues">
          <button type="button" role="tab" aria-selected={venue === 'all'} className={chip(venue === 'all')} onClick={() => setVenue('all')}>
            {t('wf.m.allHotels')}<span className="tabular-nums opacity-70">{monthStaff.length}</span>
          </button>
          {venues.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={venue === v.id} className={chip(venue === v.id)} onClick={() => setVenue(v.id)}>
              {HOTEL_STYLE[v.id] && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: HOTEL_STYLE[v.id].bg }} />}
              {venueName(v.id)}<span className="tabular-nums opacity-70">{v.count}</span>
            </button>
          ))}
        </div>
      )}
      {teams.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5" aria-label={t('wf.m.allDepartments')} data-training="wf-teams">
          <button type="button" aria-pressed={department === 'all'} className={chip(department === 'all')} onClick={() => setDepartment('all')}>
            {t('wf.m.allDepartments')}<span className="tabular-nums opacity-70">{venueStaff.length}</span>
          </button>
          {teams.map((d) => (
            <button key={d.id} type="button" aria-pressed={department === d.id} className={chip(department === d.id)} onClick={() => setDepartment(d.id)}>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color ?? '#94a3b8' }} />{localName(d.name, t)}<span className="tabular-nums opacity-70">{d.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* 3. Who to show, how big, and what to do */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input className="h-8 pl-8 text-sm" placeholder={t('wf.m.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="h-8 w-[210px]" aria-label={t('wf.f.show')}><span className="mr-1 text-muted-foreground">{t('wf.f.show')}:</span><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((f) => <SelectItem key={f} value={f}>{t(`wf.f.${f}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        {filtered && <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={resetFilters}><X className="mr-1 h-3.5 w-3.5" />{t('wf.m.resetFilters')}</Button>}
        <ToggleGroup type="single" value={view === 'day' ? 'day' : layout} onValueChange={(v) => { if (!v) return; if (v === 'day') setView('day'); else { setView('grid'); setLayout(v as 'days' | 'staff'); } }} variant="outline" size="sm">
          <ToggleGroupItem value="days" className="h-8" aria-label={t('wf.m.viewDays')} title={t('wf.m.viewDays')}><LayoutGrid className="h-4 w-4" /></ToggleGroupItem>
          <ToggleGroupItem value="staff" className="h-8" aria-label={t('wf.m.viewStaff')} title={t('wf.m.viewStaff')}><Rows3 className="h-4 w-4" /></ToggleGroupItem>
          <ToggleGroupItem value="day" className="h-8" aria-label={t('wf.m.viewDay')} title={t('wf.m.viewDay')}><List className="h-4 w-4" /></ToggleGroupItem>
        </ToggleGroup>
        {view === 'grid' && (
          <div className="flex items-center rounded-md border" role="group" data-training="wf-zoom">
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={prefs.zoom <= 0.5} onClick={() => zoomStep(-1)} aria-label={t('wf.m.zoomOut')} title={t('wf.m.zoomOut')}><ZoomOut className="h-4 w-4" /></Button>
            <button type="button" className="min-w-[46px] px-1 text-center text-xs font-medium tabular-nums hover:underline" onClick={() => updatePrefs({ zoom: 1 })} title={t('wf.m.zoomReset')}>{Math.round(prefs.zoom * 100)}%</button>
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={prefs.zoom >= 1.5} onClick={() => zoomStep(1)} aria-label={t('wf.m.zoomIn')} title={t('wf.m.zoomIn')}><ZoomIn className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none border-l" onClick={() => setFullscreen((v) => !v)} aria-pressed={fullscreen} aria-label={t(fullscreen ? 'wf.m.exitFullscreen' : 'wf.m.fullscreen')} title={t(fullscreen ? 'wf.m.exitFullscreen' : 'wf.m.fullscreen')}>
              {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        )}
        <Button variant="outline" size="sm" className="h-8" onClick={() => setHistoryOpen(true)} data-training="wf-history"><History className="mr-1 h-4 w-4" />{t('wf.m.history')}</Button>
        {canAskMira && <Button size="sm" className="h-8 border-0 bg-gradient-to-r from-violet-600 via-fuchsia-500 to-sky-500 text-white shadow-sm hover:opacity-90" onClick={() => askMira('wf.m.miraCheckPrompt')}><Sparkles className="mr-1 h-4 w-4" />{t('wf.m.askMira')}</Button>}
        <Popover>
          <PopoverTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('wf.m.shortcuts')} title={t('wf.m.shortcuts')}><HelpCircle className="h-4 w-4" /></Button></PopoverTrigger>
          <PopoverContent align="end" className="w-80 space-y-1.5 text-xs">
            <p className="font-semibold">{t('wf.m.shortcuts')}</p>
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              <li>{t('wf.m.help1')}</li><li>{t('wf.m.help2')}</li><li>{t('wf.m.help3')}</li><li>{t('wf.m.help4')}</li>
            </ul>
          </PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-8"><MoreHorizontal className="mr-1 h-4 w-4" />{t('wf.m.more')}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuCheckboxItem checked={prefs.pinTotals} onCheckedChange={(v) => updatePrefs({ pinTotals: !!v })}>{t('wf.m.pinTotals')}</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={showFormer} onCheckedChange={(v) => setShowFormer(!!v)}>{t('wf.m.formerStaff')}</DropdownMenuCheckboxItem>
            <DropdownMenuItem onSelect={() => setLegendOpen(true)}><Info className="mr-2 h-4 w-4" />{t('wf.m.legend')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={copying || viewOnly || !visibleStaff.length} onSelect={() => void prepareCopy()}><Copy className="mr-2 h-4 w-4" />{t('wf.m.copy4')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportMonth()}><Download className="mr-2 h-4 w-4" />{t('wf.m.export')}</DropdownMenuItem>
            {onImport && <DropdownMenuItem onSelect={onImport}><FileSpreadsheet className="mr-2 h-4 w-4" />{t('wf.m.import')}</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" className="h-8" disabled={!draftPeople.length} title={t('wf.m.publishHint')} onClick={() => setConfirmPublish(true)} data-training="wf-publish">
          <Send className="mr-1 h-4 w-4" />{draftPeople.length ? countText(t, locale, 'wf.m.publishCount', draftPeople.length) : t('wf.m.publish')}
        </Button>
      </div>

      {viewOnly && <p className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground"><Eye className="h-3.5 w-3.5" />{t('wf.m.viewOnly')}</p>}

      {/* 4. What to put in the selected cells */}
      {view === 'grid' && !viewOnly && palette.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" aria-label={t('wf.m.applyCode')}>
          {palette.slice(0, 18).map((c) => (
            <button key={c.id} type="button" title={c.label} onClick={() => applyRef.current?.(c.code)}
              className="h-6 rounded border px-2 text-[11px] font-medium transition hover:ring-2 hover:ring-primary/40"
              style={{ backgroundColor: KIND_STYLE[c.kind].bg, color: KIND_STYLE[c.kind].fg }}>{c.code}</button>
          ))}
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => applyRef.current?.('')}>{t('wf.m.clear')}</Button>
        </div>
      )}
      <Legend open={legendOpen} onOpenChange={setLegendOpen} />

      {/* A month nobody has planned yet: holidays are in, pick how to start. */}
      {monthIsEmpty && (
        <Alert data-training="wf-new-month">
          <CalendarDays className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p className="font-medium text-foreground">{fill(t('wf.n.title'), { month: monthLabel })}</p>
            <p className="text-xs">
              {monthCalendar.some((d) => d.kind === 'holiday')
                ? <>{t('wf.n.holidays')} {monthCalendar.filter((d) => d.kind === 'holiday').map((d) => `${Number(d.date.slice(8))}. ${calendarDayName(d, t, language)}`).join(' · ')}</>
                : t('wf.n.noHolidays')}
              {' · '}{workingDays(days)} {t('wf.m.workingDays')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={copying} onClick={() => void prepareCopy()}><Copy className="mr-1 h-4 w-4" />{t('wf.m.copy4')}</Button>
              {canPlanWithMira && <Button size="sm" className="border-0 bg-gradient-to-r from-violet-600 via-fuchsia-500 to-sky-500 text-white hover:opacity-90" onClick={() => askMira('wf.n.miraPrompt')}><Sparkles className="mr-1 h-4 w-4" />{t('wf.n.mira')}</Button>}
              <span className="text-xs text-muted-foreground">{t('wf.n.manual')}</span>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {data.loading && !data.staff.length ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />{t('wf.m.loading')}</div>
      ) : !visibleStaff.length && data.staff.length ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-md border text-sm text-muted-foreground">
          {t('wf.m.noMatch')}
          <Button size="sm" variant="outline" onClick={resetFilters}>{t('wf.m.resetFilters')}</Button>
        </div>
      ) : view === 'grid' ? (
        <>
          <WorkforceGrid
            staff={visibleStaff} days={days} today={today} departments={data.departments} jobRoles={data.jobRoles}
            entries={data.entries} notes={data.notes} leaveUsed={data.leaveUsed} codes={codes} layout={layout}
            canEdit={canEdit} onApply={onApply} applyRef={applyRef} onSelectionChange={setSelection}
            onOpenDetails={(staff, date) => setDetails({ staff, date })}
            onEditNote={(staff) => setNoteFor({ staff, text: data.notes.get(staff.id) ?? '' })}
            zoom={prefs.zoom} onZoomStep={zoomStep} pinTotals={prefs.pinTotals} tall={fullscreen}
            notices={notices} groupByHotel={venue === 'all'} cellLabels={cellLabels}
            onEditStaff={(person) => { if (mayPlan(person)) setEditStaff(person); else toast.info(t('wf.m.viewOnly')); }}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{visibleStaff.length} {t('wf.m.employees')}</span>
            {selection.length > 0 && <span>{selection.length} {t('wf.m.selected')} · {formatHours(selectionMinutes)} {t('wf.my.hours')}</span>}
            {selection.length === 1 && <button type="button" className="underline" onClick={() => setDetails(selection[0])}>{t('wf.m.openDetails')}</button>}
          </div>
        </>
      ) : (
        <DayList
          day={day} days={days} setDay={setDay} staff={visibleStaff} entries={data.entries} deptName={deptName} roleName={roleName}
          cellLabels={cellLabels} onOpen={(staff) => setDetails({ staff, date: day })}
        />
      )}

      <WorkforceEntryDialog
        open={!!details} staff={details?.staff ?? null} date={details?.date ?? null} entry={detailsEntry}
        readOnly={!details || !canEdit(details.date, details.staff)} codes={data.shiftCodes}
        onClose={() => setDetails(null)}
        onSave={(next) => onApply([{ staff: details!.staff, date: details!.date, next }])}
      />

      <WorkforceStaffDialog staff={editStaff} data={data} access={access} onClose={() => setEditStaff(null)} />

      <WorkforceHistory open={historyOpen} onOpenChange={setHistoryOpen} from={days[0]} to={days[days.length - 1]}
        staff={visibleStaff} entries={data.entries} cellLabels={cellLabels} onRestore={restore} />

      <Dialog open={!!noteFor} onOpenChange={(o) => !o && setNoteFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{fill(t('wf.note.title'), { name: noteFor?.staff.full_name ?? '', month: monthLabel })}</DialogTitle></DialogHeader>
          <Textarea rows={4} maxLength={2000} value={noteFor?.text ?? ''} onChange={(e) => setNoteFor((n) => (n ? { ...n, text: e.target.value } : n))} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteFor(null)}>{t('wf.g.cancel')}</Button>
            <Button disabled={!!noteFor && !mayPlan(noteFor.staff)} onClick={() => {
              if (!noteFor) return;
              data.saveNote(noteFor.staff.id, noteFor.text).then(() => setNoteFor(null)).catch((err) => toast.error(err?.message ?? t('wf.g.saveFail')));
            }}>{t('wf.g.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!copyPlan} onOpenChange={(o) => !o && setCopyPlan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fill(t('wf.c4.title'), { month: monthLabel })}</AlertDialogTitle>
            <AlertDialogDescription>{fill(t('wf.c4.body'), { days: copyPlan?.rows.length ?? 0, people: copyPlan?.staff ?? 0 })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('wf.g.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runCopy()}>{t('wf.c4.confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fill(t('wf.p.title'), { month: monthLabel })}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {publishPlan.fresh.length > 0 && <p>{countText(t, locale, 'wf.p.newPeople', publishPlan.fresh.length)}</p>}
                {publishPlan.notified.length > 0 && <p className="rounded-md bg-sky-50 px-2 py-1.5 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">{countText(t, locale, 'wf.p.changedPeople', publishPlan.notified.length)}</p>}
                {shortNotice > 0 && <p className="rounded-md bg-amber-50 px-2 py-1.5 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{fill(t('wf.p.short'), { n: shortNotice })}</p>}
                {publishPlan.otherNames.length > 0 && <p className="rounded-md border border-dashed px-2 py-1.5">{fill(t('wf.p.others'), { names: publishPlan.otherNames.join(', ') })}</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {publishPlan.notified.length > 0 && (
            <div className="space-y-1">
              <Label htmlFor="wf-publish-reason" className="text-xs">{t('wf.p.reason')}</Label>
              <Input id="wf-publish-reason" maxLength={300} value={publishReason} placeholder={t('wf.p.reasonPh')} onChange={(e) => setPublishReason(e.target.value)} />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('wf.g.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={!draftPeople.length} onClick={() => void publish()}>
              {draftPeople.length ? countText(t, locale, 'wf.m.publishCount', draftPeople.length) : t('wf.m.publish')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Legend({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const kinds: WorkforceKind[] = ['work', 'night', 'leave', 'half_leave', 'sick', 'unpaid_leave', 'absent', 'day_off', 'fixed_day_off', 'training', 'home_office', 'extra_day', 'other'];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('wf.m.legend')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-1 text-xs">
          {kinds.map((k) => <span key={k} className="rounded px-2 py-1" style={{ backgroundColor: KIND_STYLE[k].bg, color: KIND_STYLE[k].fg }}>{t(`wf.k.${k}`)}</span>)}
          {HOTELS.map((h) => HOTEL_STYLE[h.id] && <span key={h.id} className="rounded px-2 py-1" style={{ backgroundColor: HOTEL_STYLE[h.id].bg, color: HOTEL_STYLE[h.id].fg }}>{h.short}</span>)}
        </div>
        <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          <li>{t('wf.l.draft')}</li><li>{t('wf.l.pending')}</li><li>{t('wf.l.unseen')}</li><li>{t('wf.l.locked')}</li>
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function DayList({ day, days, setDay, staff, entries, deptName, roleName, cellLabels, onOpen }: {
  day: string; days: string[]; setDay: (d: string) => void; staff: WorkforceStaff[]; entries: Map<string, WorkforceEntry>;
  deptName: Map<string, string>; roleName: Map<string, string>; cellLabels: CellLabels; onOpen: (s: WorkforceStaff) => void;
}) {
  const { t, language } = useTranslation();
  const i = days.indexOf(day);
  const groups = new Map<string, WorkforceStaff[]>();
  for (const s of staff) { const k = s.department_id ?? 'none'; groups.set(k, [...(groups.get(k) ?? []), s]); }
  const special = calendarDay(day);
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString(intlLocale(language), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) + (special ? ` · ${calendarDayName(special, t, language)}` : '');
  const working = staff.filter((s) => { const e = entries.get(entryKey(s.id, day)); return e && ['work', 'night', 'training', 'home_office', 'extra_day'].includes(e.kind); }).length;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md border p-1">
        <Button variant="ghost" size="icon" disabled={i <= 0} onClick={() => setDay(days[i - 1])} aria-label={t('wf.d.prev')}><ChevronLeft className="h-4 w-4" /></Button>
        <div className="text-center"><div className="text-sm font-semibold">{label}</div><div className="text-xs text-muted-foreground">{t('wf.d.working').replace('{n}', String(working))}</div></div>
        <Button variant="ghost" size="icon" disabled={i >= days.length - 1} onClick={() => setDay(days[i + 1])} aria-label={t('wf.d.next')}><ChevronRight className="h-4 w-4" /></Button>
      </div>
      {[...groups].map(([k, list]) => (
        <div key={k} className="rounded-md border">
          <div className="border-b bg-muted/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide">{deptName.has(k) ? localName(deptName.get(k), t) : t('wf.g.noDept')}</div>
          <ul className="divide-y">
            {list.map((s) => {
              const e = entries.get(entryKey(s.id, day));
              const st = e ? cellStyle(e, s.hotel_id) : null;
              return (
                <li key={s.id}>
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onOpen(s)}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{s.nickname || s.full_name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{localName(roleName.get(s.job_role_id ?? ''), t)} · {s.hotel_id ? hotelShort(s.hotel_id) : t('wf.m.company')}</span>
                    </span>
                    {e ? <span className="rounded px-2 py-0.5 text-xs" style={{ backgroundColor: st!.bg, color: st!.fg }}>{e.kind === 'fixed_day_off' ? t('wf.k.fixed_day_off') : cellLabel(e, cellLabels)}</span> : <span className="text-xs text-muted-foreground">—</span>}
                    {e?.status === 'draft' && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <p className="text-center text-xs text-muted-foreground">{t('wf.d.tap')}</p>
    </div>
  );
}
