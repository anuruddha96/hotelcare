import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { todayBudapest } from '@/lib/budapestTime';
import { calendarDay } from '@/lib/workforce/holidays';
import {
  cellLabel, cellStyle, formatHours, hotelShort, KIND_STYLE, monthDays, pad2, summarizeStaffMonth, WEEKDAY_SHORT, weekdayOf,
  type WorkforceEntry, type WorkforceStaff,
} from '@/lib/workforce/model';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** The signed-in employee's own published schedule (housekeeping, maintenance, laundry, reception…). */
export function MyWorkforceSchedule({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const today = todayBudapest();
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) }));
  const [me, setMe] = useState<WorkforceStaff | null | undefined>(undefined);
  const [entries, setEntries] = useState<WorkforceEntry[]>([]);
  const [leaveUsed, setLeaveUsed] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    void db.from('workforce_staff').select('id,full_name,nickname,hotel_id,daily_hours,annual_leave_days,department_id,job_role_id,profile_id,employment_type,leave_note,start_date,end_date,is_active,sort_order,notes,source_label')
      .eq('profile_id', user.id).maybeSingle()
      .then(({ data, error }: { data: WorkforceStaff | null; error: unknown }) => setMe(error ? null : data));
  }, [user?.id]);

  const days = useMemo(() => monthDays(ym.y, ym.m), [ym]);
  useEffect(() => {
    if (!me) return;
    const from = days[0], to = days[days.length - 1];
    void db.from('workforce_entries').select('staff_id,work_date,kind,code,start_time,end_time,day_fraction,extra_minutes,hotel_id,raw_text,note,worked_minutes,status')
      .eq('staff_id', me.id).eq('status', 'published').gte('work_date', from).lte('work_date', to).order('work_date')
      .then(({ data }: { data: WorkforceEntry[] | null }) => setEntries((data ?? []).map((e) => ({ ...e, start_time: e.start_time?.slice(0, 5) ?? null, end_time: e.end_time?.slice(0, 5) ?? null }))));
    void db.from('workforce_entries').select('kind').eq('staff_id', me.id).eq('status', 'published').in('kind', ['leave', 'half_leave'])
      .gte('work_date', `${ym.y}-01-01`).lte('work_date', `${ym.y}-12-31`)
      .then(({ data }: { data: Array<{ kind: string }> | null }) => setLeaveUsed((data ?? []).reduce((n, r) => n + (r.kind === 'half_leave' ? 0.5 : 1), 0)));
  }, [me, days, ym.y]);

  if (me === undefined) return null;
  if (me === null) {
    return compact ? null : (
      <Card><CardContent className="p-6 text-sm text-muted-foreground">Your work schedule will appear here once HR links your account to the staff schedule.</CardContent></Card>
    );
  }

  const byDate = new Map(entries.map((e) => [e.work_date, e]));
  const summary = summarizeStaffMonth(entries, days.length, Number(me.daily_hours ?? 8));
  const upcoming = days.filter((d) => d >= today).slice(0, compact ? 7 : 14);
  const shift = (delta: number) => setYm(({ y, m }) => { const d = new Date(Date.UTC(y, m - 1 + delta, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; });
  const monthLabel = new Date(Date.UTC(ym.y, ym.m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const list = compact ? upcoming : days;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="h-4 w-4" />My work schedule</CardTitle>
            <CardDescription>{me.nickname || me.full_name} · {hotelShort(me.hotel_id)}</CardDescription>
          </div>
          {!compact && (
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
              <span className="min-w-[120px] text-center text-sm font-medium">{monthLabel}</span>
              <Button size="icon" variant="ghost" onClick={() => shift(1)} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          <Mini label="Shifts" value={String(summary.dayShifts + summary.nights)} />
          <Mini label="Hours" value={formatHours(summary.workedMinutes)} />
          <Mini label="Leave" value={String(summary.leaveDays)} />
          <Mini label="Leave left" value={me.annual_leave_days == null ? '—' : String(me.annual_leave_days - leaveUsed)} />
        </div>
        <ul className="divide-y rounded-md border">
          {list.map((d) => {
            const e = byDate.get(d);
            const style = e ? cellStyle(e, me.hotel_id) : null;
            const away = e?.hotel_id && e.hotel_id !== me.hotel_id ? hotelShort(e.hotel_id) : '';
            return (
              <li key={d} className={`flex items-center gap-3 px-3 py-2 text-sm ${d === today ? 'bg-primary/5' : ''}`}>
                <span className="w-14 shrink-0 tabular-nums text-muted-foreground">{WEEKDAY_SHORT[weekdayOf(d)]} {Number(d.slice(8))}.{pad2(Number(d.slice(5, 7)))}</span>
                {e ? (
                  <span className="rounded px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: style!.bg, color: style!.fg }}>
                    {e.kind === 'fixed_day_off' ? 'Fixed day off' : (cellLabel(e) || KIND_STYLE[e.kind].label)}
                  </span>
                ) : <span className="text-xs text-muted-foreground">Day off</span>}
                {e && !['work', 'night'].includes(e.kind) && e.kind !== 'fixed_day_off' && <span className="text-xs text-muted-foreground">{KIND_STYLE[e.kind].label}</span>}
                {away && <span className="text-xs text-muted-foreground">at {away}</span>}
                {calendarDay(d)?.kind === 'holiday' && <span className="text-xs text-red-600 dark:text-red-400">{calendarDay(d)!.nameHu}</span>}
                {e?.worked_minutes ? <span className="ml-auto text-xs tabular-nums text-muted-foreground">{formatHours(e.worked_minutes)} h</span> : null}
              </li>
            );
          })}
          {!list.length && <li className="px-3 py-4 text-sm text-muted-foreground">Nothing scheduled.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md bg-muted px-2 py-1.5"><div className="text-[11px] text-muted-foreground">{label}</div><div className="text-base font-semibold tabular-nums">{value}</div></div>;
}
