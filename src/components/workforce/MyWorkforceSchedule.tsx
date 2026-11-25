import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BellRing, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Loader2, Lock, MapPin, Moon, Palmtree, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useCanSeeOwnSchedule } from '@/hooks/useAccessPolicy';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { todayBudapest } from '@/lib/budapestTime';
import { calendarDay } from '@/lib/workforce/holidays';
import { formatHours, hotelShort, intlLocale, monthDays, summarizeStaffMonth, type ChangeNotice, type ShiftSnapshot, type WorkforceEntry, type WorkforceStaff } from '@/lib/workforce/model';
import { describeMyDay, leaveBalance, shiftDate, weekOf, type MyDay, type MyDayTone } from '@/lib/workforce/mySchedule';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Attendance = { work_date: string; check_in_time: string | null; check_out_time: string | null; total_hours: number | null };

const TONE: Record<MyDayTone, { chip: string; dot: string }> = {
  work: { chip: 'bg-emerald-600 text-white', dot: 'bg-emerald-500' },
  night: { chip: 'bg-indigo-700 text-white', dot: 'bg-indigo-500' },
  info: { chip: 'bg-sky-600 text-white', dot: 'bg-sky-500' },
  leave: { chip: 'bg-amber-500 text-black', dot: 'bg-amber-500' },
  sick: { chip: 'bg-rose-600 text-white', dot: 'bg-rose-500' },
  off: { chip: 'bg-muted text-muted-foreground', dot: 'bg-transparent' },
  unknown: { chip: 'bg-muted text-muted-foreground', dot: 'bg-transparent' },
};

/**
 * The signed-in employee's own published schedule, built for a phone:
 * what do I work today, a week to swipe through, the month at a glance, my
 * leave balance. The database only ever returns this person's own published
 * days (row-level security), so nothing about colleagues can appear here.
 */
/**
 * A person's own published shifts. Housekeepers and maintenance staff see it
 * only after HR / top management puts the schedule live (Work schedule →
 * Departments & codes); the database applies the same rule.
 */
export function MyWorkforceSchedule({ compact = false }: { compact?: boolean }) {
  const canSee = useCanSeeOwnSchedule();
  if (!canSee) return null;
  return <MyWorkforceScheduleView compact={compact} />;
}

function MyWorkforceScheduleView({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const today = todayBudapest();
  const [selected, setSelected] = useState(today);
  const [expanded, setExpanded] = useState(!compact);
  const [me, setMe] = useState<WorkforceStaff | null | undefined>(undefined);
  const [entries, setEntries] = useState<WorkforceEntry[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [leaveUsed, setLeaveUsed] = useState(0);
  /** Published days that changed and wait for this person's confirmation. */
  const [changes, setChanges] = useState<ChangeNotice[]>([]);
  /** Months a manager has published (null = unknown, before the database update). */
  const [publishedMonths, setPublishedMonths] = useState<Set<string> | null>(null);
  const [visibleUntil, setVisibleUntil] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const ym = useMemo(() => ({ y: Number(selected.slice(0, 4)), m: Number(selected.slice(5, 7)) }), [selected]);
  const days = useMemo(() => monthDays(ym.y, ym.m), [ym.y, ym.m]);

  useEffect(() => {
    if (!user?.id) return;
    void db.from('workforce_staff').select('id,full_name,nickname,hotel_id,daily_hours,annual_leave_days,department_id,job_role_id,profile_id,employment_type,leave_note,start_date,end_date,is_active,sort_order,notes,source_label')
      .eq('profile_id', user.id).maybeSingle()
      .then(({ data, error }: { data: WorkforceStaff | null; error: unknown }) => setMe(error ? null : data));
  }, [user?.id]);

  const from = shiftDate(days[0], -7), to = shiftDate(days[days.length - 1], 7);
  useEffect(() => {
    if (!me || !user?.id) return;
    let alive = true;
    const tidy = (rows: WorkforceEntry[] | null) => (rows ?? []).map((e) => ({ ...e, start_time: e.start_time?.slice(0, 5) ?? null, end_time: e.end_time?.slice(0, 5) ?? null }));
    // The database hands out exactly what was published for this person: a
    // change a manager is still working on never shows, the last published
    // version does. Before the database update, read the published rows directly.
    void db.rpc('workforce_my_schedule', { _from: from, _to: to }).then(async ({ data, error }: { data: { days?: WorkforceEntry[]; changes?: ChangeNotice[]; published_months?: string[]; visible_until?: string | null } | null; error: unknown }) => {
      if (!alive) return;
      if (!error && data) {
        setEntries(tidy(data.days ?? []));
        setChanges(data.changes ?? []);
        setPublishedMonths(new Set(data.published_months ?? []));
        setVisibleUntil(data.visible_until ?? null);
        return;
      }
      const res = await db.from('workforce_entries').select('staff_id,work_date,kind,code,start_time,end_time,day_fraction,extra_minutes,hotel_id,raw_text,note,worked_minutes,status')
        .eq('staff_id', me.id).eq('status', 'published').gte('work_date', from).lte('work_date', to).order('work_date');
      if (alive) { setEntries(tidy(res.data)); setPublishedMonths(null); }
    });
    void db.from('workforce_entries').select('kind').eq('staff_id', me.id).eq('status', 'published').in('kind', ['leave', 'half_leave'])
      .gte('work_date', `${ym.y}-01-01`).lte('work_date', `${ym.y}-12-31`)
      .then(({ data }: { data: Array<{ kind: string }> | null }) => { if (alive) setLeaveUsed((data ?? []).reduce((n, r) => n + (r.kind === 'half_leave' ? 0.5 : 1), 0)); });
    void db.from('staff_attendance').select('work_date,check_in_time,check_out_time,total_hours')
      .eq('user_id', user.id).gte('work_date', from).lte('work_date', to).order('created_at', { ascending: true })
      .then(({ data }: { data: Attendance[] | null }) => { if (alive) setAttendance(data ?? []); });
    return () => { alive = false; };
  }, [me, user?.id, from, to, ym.y, refresh]);

  // Coming back to the app (for example from the push notification) shows the latest schedule.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') setRefresh((n) => n + 1); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const byDate = useMemo(() => new Map(entries.map((e) => [e.work_date, e])), [entries]);
  const attendanceByDate = useMemo(() => new Map(attendance.map((a) => [a.work_date, a])), [attendance]);
  const plannedMonths = useMemo(() => new Set(entries.map((e) => e.work_date.slice(0, 7))), [entries]);

  if (me === undefined) return null;
  if (me === null) {
    return compact ? null : <Card><CardContent className="p-6 text-sm text-muted-foreground">{t('wf.my.notLinked')}</CardContent></Card>;
  }

  // An empty day is a day off once the month was published; days beyond the
  // visibility window are simply not confirmed yet.
  const monthPublished = (date: string) => (publishedMonths ? publishedMonths.has(date.slice(0, 7)) : plannedMonths.has(date.slice(0, 7))) && (!visibleUntil || date <= visibleUntil);
  const dayOf = (date: string): MyDay => describeMyDay(date, byDate.get(date), me.hotel_id, monthPublished(date));
  const locale = intlLocale(language);
  const fmt = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC', ...options });
  const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Budapest' }) : '—');
  const changedDates = new Set(changes.map((c) => c.work_date));
  /** One side of a change in plain words: "08:00 – 16:00 · Mika", "Day off", "Leave". */
  const shiftText = (date: string, shift: ShiftSnapshot | null, withPlace: boolean) => {
    if (!shift || shift.kind === 'day_off' || shift.kind === 'fixed_day_off') return t('wf.my.dayOff');
    const d = describeMyDay(date, { ...shift, staff_id: me.id, work_date: date, raw_text: null, status: 'published' }, me.hotel_id, true);
    // Clock times when there are any; otherwise the plain word, never a planner's code.
    const timed = shift.start_time && shift.end_time ? d.time : null;
    const place = d.isWork && shift.hotel_id && (withPlace || d.awayHotel) ? hotelShort(shift.hotel_id) : null;
    return [timed ?? t(d.labelKey), timed && d.tone !== 'work' ? t(d.labelKey) : null, place].filter(Boolean).join(' · ');
  };
  /** Say where, on both sides, when the place is what changed. */
  const placeChanged = (c: ChangeNotice) => !!c.before && !!c.after && (c.before.hotel_id ?? null) !== (c.after.hotel_id ?? null);
  const confirmChanges = async () => {
    setConfirming(true);
    const { error } = await db.rpc('workforce_acknowledge_changes', { _ids: changes.map((c) => c.id) });
    setConfirming(false);
    if (error) { toast.error(t('wf.my.changed.fail')); return; }
    setChanges([]);
    toast.success(t('wf.my.changed.thanks'));
  };
  const week = weekOf(selected);
  const sel = dayOf(selected);
  const selAttendance = attendanceByDate.get(selected);
  const holiday = calendarDay(selected);
  const monthEntries = entries.filter((e) => e.work_date.slice(0, 7) === selected.slice(0, 7));
  const summary = summarizeStaffMonth(monthEntries, days.length, Number(me.daily_hours ?? 8));
  const balance = leaveBalance(me.annual_leave_days, leaveUsed);
  const upcoming = Array.from({ length: 21 }, (_, i) => shiftDate(today, i + 1)).map(dayOf).filter((d) => d.isWork).slice(0, 3);
  const selectedTitle = selected === today ? t('wf.my.today') : selected === shiftDate(today, 1) ? t('wf.my.tomorrow') : fmt(selected, { weekday: 'long' });
  const ToneIcon = sel.tone === 'night' ? Moon : sel.tone === 'leave' ? Palmtree : sel.isWork ? Sun : CalendarDays;
  const firstWeekday = (new Date(`${days[0]}T12:00:00Z`).getUTCDay() + 6) % 7;

  return (
    <Card className="mx-auto w-full max-w-md overflow-hidden" data-training="my-schedule">
      <CardContent className="space-y-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><CalendarDays className="h-4 w-4 text-primary" />{t('wf.my.title')}</h2>
          <span className="truncate text-xs text-muted-foreground">{me.nickname || me.full_name} · {hotelShort(me.hotel_id)}</span>
        </div>

        {/* A published day changed: say exactly what, and ask for one tap. */}
        {changes.length > 0 && (
          <div className="rounded-xl border-2 border-sky-500 bg-sky-50 p-3 dark:bg-sky-950/40" role="alert" data-training="my-schedule-changes">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-sky-900 dark:text-sky-100"><BellRing className="h-4 w-4" />{t('wf.my.changed.title')}</p>
            <ul className="mt-2 space-y-2">
              {changes.map((c) => (
                <li key={c.id} className="rounded-lg bg-background p-2 text-sm shadow-sm">
                  <button type="button" className="font-semibold capitalize underline-offset-2 hover:underline" onClick={() => setSelected(c.work_date)}>
                    {fmt(c.work_date, { weekday: 'long', day: 'numeric', month: 'long' })}
                  </button>
                  <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <div><div className="text-[11px] uppercase text-muted-foreground">{t('wf.my.changed.was')}</div><div className="text-muted-foreground line-through">{shiftText(c.work_date, c.before, placeChanged(c))}</div></div>
                    <ArrowRight className="h-4 w-4 text-sky-600" />
                    <div><div className="text-[11px] uppercase text-muted-foreground">{t('wf.my.changed.now')}</div><div className="font-bold">{shiftText(c.work_date, c.after, placeChanged(c))}</div></div>
                  </div>
                  {c.reason && <p className="mt-1 text-xs"><span className="text-muted-foreground">{t('wf.my.changed.reason')}:</span> {c.reason}</p>}
                  {c.changed_by_name && <p className="mt-0.5 text-[11px] text-muted-foreground">{t('wf.my.changed.by').replace('{name}', c.changed_by_name)}</p>}
                  {c.short_notice && <p className="mt-1 rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">{t('wf.my.changed.short')}</p>}
                </li>
              ))}
            </ul>
            <Button type="button" className="mt-2 h-11 w-full text-sm" disabled={confirming} onClick={() => void confirmChanges()}>
              {confirming ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}{t('wf.my.changed.ack')}
            </Button>
          </div>
        )}

        {/* The selected day, in plain words */}
        <div className={cn('rounded-xl p-3', sel.isWork ? 'bg-primary/10' : 'bg-muted/60')} aria-live="polite">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-medium capitalize">{selectedTitle} · {fmt(selected, { day: 'numeric', month: 'long' })}</span>
            {selected !== today && <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => setSelected(today)}>{t('wf.my.today')}</button>}
          </div>
          <div className="mt-1 flex items-center gap-2.5">
            <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-full', TONE[sel.tone].chip)}><ToneIcon className="h-5 w-5" /></span>
            <div className="min-w-0">
              <div className="text-xl font-bold leading-tight tracking-tight">{sel.time ?? t(sel.labelKey)}</div>
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {sel.time && <span>{t(sel.labelKey)}</span>}
                {sel.hours != null && <span className="inline-flex items-center gap-0.5"><Clock className="h-3 w-3" />{sel.hours} {t('wf.my.hours')}</span>}
                {sel.isWork && <span className="inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" />{hotelShort(sel.awayHotel ?? me.hotel_id)}</span>}
                {holiday?.kind === 'holiday' && <span className="text-red-600 dark:text-red-400">{t('wf.my.holiday')}</span>}
              </div>
            </div>
          </div>
          {sel.awayHotel && <p className="mt-1.5 rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">{t('wf.my.at')} {hotelShort(sel.awayHotel)}</p>}
          {sel.note && <p className="mt-1.5 text-xs text-muted-foreground">{sel.note}</p>}
          {selAttendance && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t('wf.my.attendance')}: {t('wf.my.checkedIn')} <strong className="text-foreground">{clock(selAttendance.check_in_time)}</strong> · {t('wf.my.checkedOut')} <strong className="text-foreground">{clock(selAttendance.check_out_time)}</strong>
            </p>
          )}
        </div>

        {/* One week: tap a day */}
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-9 w-7 shrink-0" onClick={() => setSelected(shiftDate(selected, -7))} aria-label={t('wf.my.prevWeek')}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="grid flex-1 grid-cols-7 gap-1">
            {week.map((d) => {
              const info = dayOf(d);
              const active = d === selected;
              return (
                <button key={d} type="button" onClick={() => setSelected(d)} aria-pressed={active} aria-label={`${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}: ${info.time ?? t(info.labelKey)}`}
                  className={cn('flex flex-col items-center rounded-lg border px-0.5 py-1 transition', active ? 'border-primary bg-primary text-primary-foreground' : d === today ? 'border-primary/60 bg-background' : 'border-transparent bg-muted/50 hover:bg-muted', changedDates.has(d) && 'ring-2 ring-sky-500')}>
                  <span className={cn('text-[10px] uppercase', !active && 'text-muted-foreground')}>{fmt(d, { weekday: 'short' }).slice(0, 2)}</span>
                  <span className="text-sm font-semibold leading-tight">{Number(d.slice(8))}</span>
                  <span className={cn('mt-0.5 h-1.5 w-1.5 rounded-full', active && info.isWork ? 'bg-primary-foreground' : TONE[info.tone].dot)} />
                  <span className={cn('h-3 text-[9px] leading-3', !active && 'text-muted-foreground')}>{info.short ?? ''}</span>
                </button>
              );
            })}
          </div>
          <Button size="icon" variant="ghost" className="h-9 w-7 shrink-0" onClick={() => setSelected(shiftDate(selected, 7))} aria-label={t('wf.my.nextWeek')}><ChevronRight className="h-4 w-4" /></Button>
        </div>

        {compact && !expanded && upcoming.length > 0 && (
          <div className="text-xs">
            <p className="mb-1 font-medium text-muted-foreground">{t('wf.my.next')}</p>
            <ul className="space-y-0.5">
              {upcoming.map((d) => (
                <li key={d.date}><button type="button" className="flex w-full items-center justify-between rounded px-1 py-0.5 text-left hover:bg-muted" onClick={() => setSelected(d.date)}>
                  <span className="capitalize">{fmt(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  <span className="font-semibold tabular-nums">{d.time ?? t(d.labelKey)}</span>
                </button></li>
              ))}
            </ul>
          </div>
        )}

        {expanded && (
          <>
            {/* The month at a glance */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setSelected(shiftDate(days[0], -1).slice(0, 8) + '01')} aria-label={t('wf.my.prevMonth')}><ChevronLeft className="h-4 w-4" /></Button>
                <span className="text-sm font-semibold capitalize">{fmt(days[0], { month: 'long', year: 'numeric' })}</span>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setSelected(shiftDate(days[days.length - 1], 1))} aria-label={t('wf.my.nextMonth')}><ChevronRight className="h-4 w-4" /></Button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center">
                {week.map((d) => <span key={d} className="text-[10px] uppercase text-muted-foreground">{fmt(d, { weekday: 'short' }).slice(0, 2)}</span>)}
                {Array.from({ length: firstWeekday }, (_, i) => <span key={`pad-${i}`} />)}
                {days.map((d) => {
                  const info = dayOf(d);
                  const active = d === selected;
                  return (
                    <button key={d} type="button" onClick={() => setSelected(d)} aria-pressed={active}
                      className={cn('flex h-11 flex-col items-center justify-center rounded-md text-[10px] leading-tight transition',
                        info.tone === 'off' || info.tone === 'unknown' ? 'bg-muted/40 text-muted-foreground' : TONE[info.tone].chip,
                        active && 'ring-2 ring-primary ring-offset-1 ring-offset-background', d === today && !active && 'ring-1 ring-primary/60', d < today && 'opacity-60',
                        changedDates.has(d) && !active && 'ring-2 ring-sky-500')}>
                      <span className="text-xs font-semibold">{Number(d.slice(8))}</span>
                      <span>{info.short ?? ''}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <Mini label={t('wf.my.shifts')} value={String(summary.dayShifts + summary.nights)} />
              <Mini label={t('wf.my.hoursTotal')} value={formatHours(summary.workedMinutes)} />
              <Mini label={t('wf.my.leaveTaken')} value={String(summary.leaveDays)} />
            </div>

            {balance && (
              <div className="rounded-lg border p-2.5" data-training="my-leave">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium">{t('wf.my.leaveYear').replace('{year}', String(ym.y))}</span>
                  <span className="text-sm font-bold tabular-nums">{balance.left} <span className="text-xs font-normal text-muted-foreground">{t('wf.my.days')} · {t('wf.my.leaveLeft')}</span></span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-amber-500" style={{ width: `${balance.percentUsed}%` }} /></div>
                <p className="mt-1 text-[11px] text-muted-foreground">{t('wf.my.leaveOf').replace('{used}', String(balance.used)).replace('{total}', String(balance.total))}</p>
              </div>
            )}
            {visibleUntil && <p className="rounded-md bg-muted px-2 py-1.5 text-center text-[11px] text-muted-foreground">{t('wf.my.visibleUntil').replace('{date}', fmt(visibleUntil, { day: 'numeric', month: 'long' }))}</p>}
            <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground"><Lock className="h-3 w-3" />{t('wf.my.private')}</p>
          </>
        )}

        {compact && (
          <Button type="button" variant="ghost" size="sm" className="h-8 w-full text-xs" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {t(expanded ? 'wf.my.hide' : 'wf.my.openFull')}<ChevronDown className={cn('ml-1 h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-muted px-2 py-1.5"><div className="text-[11px] text-muted-foreground">{label}</div><div className="text-base font-semibold tabular-nums">{value}</div></div>;
}
