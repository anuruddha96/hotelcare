import { Clock, Moon, Users, AlertTriangle, CalendarPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { hours, signedHours, type PlannedCell, type ScheduleCardPlan } from './types';

const WEEKDAY_INITIAL: Record<string, string> = { Mon: 'M', Tue: 'T', Wed: 'W', Thu: 'T', Fri: 'F', Sat: 'S', Sun: 'S' };

function cellText(cell: PlannedCell): string {
  if (cell.startTime && cell.endTime) {
    const start = Number(cell.startTime.slice(0, 2));
    const end = Number(cell.endTime.slice(0, 2));
    return `${start}–${end}`;
  }
  return cell.code ?? '✓';
}

function BalancePill({ minutes }: { minutes: number | null }) {
  if (minutes === null) return <span className="text-xs text-muted-foreground">no norm</span>;
  const h = minutes / 60;
  const tone = Math.abs(h) <= 4 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
    : h < 0 ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
      : 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300';
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', tone)}>{signedHours(minutes)}</span>;
}

/**
 * A schedule plan: who works when (new shifts highlighted next to what is
 * already in the schedule), hours against the monthly norm, and staffing per
 * day. With `onToggle` the manager chooses whose shifts to save.
 */
export function SchedulePlanView({ plan, selected, onToggle, approvedItems }: {
  plan: ScheduleCardPlan;
  selected?: ReadonlySet<string>;
  onToggle?: (staffId: string) => void;
  approvedItems?: readonly string[] | null;
}) {
  const dates = plan.days.map((d) => d.date);
  const cells = new Map(plan.cells.map((c) => [`${c.staffId}|${c.date}`, c]));
  const approved = approvedItems ? new Set(approvedItems) : null;
  const buckets = [...new Set(plan.days.flatMap((d) => d.coverage.filter((c) => c.required > 0 || c.after > 0).map((c) => c.bucket)))];
  const t = plan.totals;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi icon={<CalendarPlus className="h-4 w-4" />} label="Shifts added" value={String(t.shiftsAdded)} />
        <Kpi icon={<Clock className="h-4 w-4" />} label="Hours added" value={hours(t.minutesAdded)} />
        <Kpi icon={<Users className="h-4 w-4" />} label="People" value={String(t.staff)} />
        <Kpi icon={<AlertTriangle className={cn('h-4 w-4', t.understaffedDays ? 'text-amber-600' : '')} />} label="Short-staffed days" value={String(t.understaffedDays)} />
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-max min-w-full border-collapse text-xs">
          <thead>
            <tr className="bg-muted/50">
              <th className="sticky left-0 z-10 min-w-[170px] bg-muted/90 px-2 py-1.5 text-left font-medium backdrop-blur">Person</th>
              {plan.days.map((d) => (
                <th key={d.date} className={cn('w-9 px-0.5 py-1 text-center font-normal', (d.weekday === 'Sat' || d.weekday === 'Sun' || d.holiday) && 'bg-muted')}>
                  <span className="block text-[10px] text-muted-foreground">{WEEKDAY_INITIAL[d.weekday] ?? d.weekday}</span>
                  <span className="block font-medium">{Number(d.date.slice(8, 10))}</span>
                </th>
              ))}
              <th className="min-w-[150px] px-2 py-1.5 text-right font-medium">Hours vs norm</th>
            </tr>
          </thead>
          <tbody>
            {plan.staff.map((row) => {
              const name = plan.staffNames?.[row.staffId] ?? row.name;
              const isSelected = selected ? selected.has(row.staffId) : true;
              const existing = plan.existing?.[row.staffId] ?? {};
              return (
                <tr key={row.staffId} className={cn('border-t', !isSelected && 'opacity-50', approved?.has(row.staffId) && 'bg-emerald-50/40 dark:bg-emerald-500/5')}>
                  <td className="sticky left-0 z-10 bg-background px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      {onToggle && row.proposedShifts > 0 && (
                        <Checkbox checked={isSelected} onCheckedChange={() => onToggle(row.staffId)} aria-label={`Include ${name}`} />
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-medium">{name}</p>
                        <p className="truncate text-[10px] text-muted-foreground">
                          {row.jobRole} · {row.template.startTime && row.template.endTime ? `${row.template.startTime.slice(0, 5)}–${row.template.endTime.slice(0, 5)}` : row.template.code ?? 'full day'}
                        </p>
                      </div>
                    </div>
                  </td>
                  {dates.map((date) => {
                    const planned = cells.get(`${row.staffId}|${date}`);
                    const before = existing[date];
                    return (
                      <td key={date} className="px-0.5 py-1 text-center">
                        {planned ? (
                          <span className={cn(
                            'inline-flex h-6 min-w-[2rem] items-center justify-center gap-0.5 rounded-md px-1 text-[10px] font-semibold',
                            planned.kind === 'night' ? 'bg-indigo-600 text-white' : 'bg-primary text-primary-foreground',
                          )} title={`${date}: new ${planned.kind === 'night' ? 'night' : 'day'} shift (${hours(planned.minutes)})`}>
                            {planned.kind === 'night' && <Moon className="h-2.5 w-2.5" />}{cellText(planned)}
                          </span>
                        ) : before ? (
                          <span className="inline-flex h-6 min-w-[2rem] items-center justify-center rounded-md bg-muted px-1 text-[10px] text-muted-foreground" title={`${date}: already in the schedule`}>{before}</span>
                        ) : <span className="text-muted-foreground/40">·</span>}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-muted-foreground">{hours(row.existingMinutes + row.proposedMinutes)}{row.targetMinutes !== null ? ` / ${hours(row.targetMinutes)}` : ''}</span>
                      <BalancePill minutes={row.balanceAfterMinutes} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {buckets.map((bucket) => (
              <tr key={bucket} className="border-t bg-muted/30">
                <td className="sticky left-0 z-10 bg-muted/90 px-2 py-1 text-[11px] font-medium backdrop-blur">{bucket}</td>
                {plan.days.map((d) => {
                  const c = d.coverage.find((x) => x.bucket === bucket);
                  if (!c || (c.required === 0 && c.after === 0)) return <td key={d.date} />;
                  const short = c.after < c.required;
                  return (
                    <td key={d.date} className="px-0.5 py-1 text-center">
                      <span className={cn('inline-block min-w-[1.75rem] rounded px-1 text-[10px] font-semibold',
                        short ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300')}
                        title={`${c.after} working, ${c.required} usually needed${d.demand ? ` · ${d.demand.checkouts} checkouts, ${d.demand.stayovers} stayovers` : ''}`}>
                        {c.after}/{c.required}
                      </span>
                    </td>
                  );
                })}
                <td />
              </tr>
            ))}
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-primary" /> new day shift</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-indigo-600" /> new night shift</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-muted" /> already in the schedule</span>
        <span>Bottom rows: people working / usually needed.</span>
      </div>
      {[...plan.assumptions, ...plan.warnings].length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
          {[...plan.warnings, ...plan.assumptions].map((text) => <li key={text}>{text}</li>)}
        </ul>
      )}
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
      <span className="text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[11px] text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}
