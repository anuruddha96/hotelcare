import { useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, ChevronDown, Minus, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { dayLabel, money, type RatePlan } from './types';

type Day = RatePlan['days'][number];

const BAND_STYLE: Record<string, string> = {
  surge: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  strong: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  on_pace: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
  soft: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  weak: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
};
const BAND_LABEL: Record<string, string> = { surge: 'Surge', strong: 'Strong', on_pace: 'On pace', soft: 'Soft', weak: 'Weak' };
const IMPACT_STYLE: Record<string, string> = {
  high: 'border-rose-300 bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
  medium: 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300',
  low: 'border-slate-200 bg-slate-50 text-slate-600 dark:bg-slate-500/10 dark:text-slate-300',
  none: 'border-slate-200 bg-slate-50 text-slate-600 dark:bg-slate-500/10 dark:text-slate-300',
};

function DeltaPill({ day, currency }: { day: Day; currency: string }) {
  if (day.deltaEur > 0) {
    return <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white"><ArrowUpRight className="h-3 w-3" />{money(day.deltaEur, currency)}</span>;
  }
  if (day.deltaEur < 0) {
    return <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white"><ArrowDownRight className="h-3 w-3" />{money(Math.abs(day.deltaEur), currency)}</span>;
  }
  if (day.stance === 'protect') {
    return <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"><ShieldCheck className="h-3 w-3" />Protect</span>;
  }
  return <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"><Minus className="h-3 w-3" />{day.stance === 'insufficient_data' ? 'No data' : 'Hold'}</span>;
}

function OccupancyBar({ day }: { day: Day }) {
  const occ = day.occupancyPct ?? 0;
  const pace = day.signal?.paceTargetPct ?? day.expectedOccupancyPct;
  const ahead = day.occupancyPct !== null && occ >= pace;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px] text-muted-foreground">
        <span><span className="text-sm font-semibold text-foreground">{day.occupancyPct === null ? '—' : `${Math.round(occ)}%`}</span> sold</span>
        <span>{day.roomsLeft === null ? '' : `${day.roomsLeft} left`}</span>
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-muted" aria-label={`Occupancy ${Math.round(occ)}%, pace target ${Math.round(pace)}%`}>
        <div className={cn('h-1.5 rounded-full', ahead ? 'bg-emerald-500' : 'bg-primary/70')} style={{ width: `${Math.min(100, Math.max(0, occ))}%` }} />
        <div className="absolute -top-0.5 h-2.5 w-0.5 rounded bg-foreground/60" style={{ left: `${Math.min(100, Math.max(0, pace))}%` }} title={`Pace target ${Math.round(pace)}%`} />
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-xs font-medium" title={hint}>{value}</p>
    </div>
  );
}

function DayCard({ day, currency, selectable, selected, onToggle, approved }: {
  day: Day; currency: string; selectable: boolean; selected: boolean; onToggle?: (date: string) => void; approved?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const changes = day.deltaEur !== 0;
  const band = day.signal?.band ?? null;
  return (
    <div className={cn(
      'flex flex-col gap-2 rounded-xl border bg-background p-3 transition',
      changes && selected && 'border-primary/50 shadow-sm',
      changes && !selected && selectable && 'opacity-60',
      approved && 'ring-1 ring-emerald-500/50',
    )}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold leading-tight">{dayLabel(day.date)}</p>
          <p className="text-[11px] text-muted-foreground">{day.daysOut === 0 ? 'Tonight' : day.daysOut === 1 ? 'Tomorrow' : `in ${day.daysOut} days`}</p>
        </div>
        {band && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', BAND_STYLE[band] ?? BAND_STYLE.on_pace)}>
                  {day.signal?.score ?? '–'} · {BAND_LABEL[band] ?? band}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px] text-xs">
                <p className="mb-1 font-semibold">Price Signal</p>
                <ul className="space-y-0.5">{(day.signal?.drivers ?? []).map((d) => <li key={d}>{d}</li>)}</ul>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <OccupancyBar day={day} />

      <div className="grid grid-cols-3 gap-2">
        <Metric label="Pickup 7d" value={day.pickup7d === null ? '—' : `${day.pickup7d > 0 ? '+' : ''}${day.pickup7d}`} hint={day.pickup24h !== null ? `${day.pickup24h} in the last 24 h` : undefined} />
        <Metric label="ADR" value={money(day.adr, currency)} hint="Average rate of the rooms already sold" />
        <Metric label="Market" value={day.marketMedian === null ? '—' : money(day.marketMedian, currency)} hint={day.marketCount ? `${day.marketCount} competitors${day.positionVsMarketPct !== null ? `, we are ${day.positionVsMarketPct > 0 ? '+' : ''}${day.positionVsMarketPct}%` : ''}` : 'No fresh competitor rates'} />
      </div>

      {day.events.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {day.events.slice(0, 2).map((event) => (
            <span key={event} className={cn('max-w-full truncate rounded-md border px-1.5 py-0.5 text-[11px]', IMPACT_STYLE[day.eventImpact])} title={event}>
              <Sparkles className="mr-0.5 inline h-3 w-3" />{event}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t pt-2">
        <div className="flex items-center gap-1 text-sm">
          <span className={cn('text-muted-foreground', changes && 'line-through')}>{money(day.entryRate, currency)}</span>
          {changes && <><ArrowRight className="h-3 w-3 text-muted-foreground" /><span className="font-semibold">{money(day.proposedEntryRate, currency)}</span></>}
        </div>
        <DeltaPill day={day} currency={currency} />
      </div>

      <div className="flex items-center justify-between gap-2">
        {selectable && changes ? (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <Checkbox checked={selected} onCheckedChange={() => onToggle?.(day.date)} aria-label={`Include ${day.date}`} />
            Include
          </label>
        ) : <span />}
        <button type="button" className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          Why <ChevronDown className={cn('h-3 w-3 transition', open && 'rotate-180')} />
        </button>
      </div>
      {open && (
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
          {day.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      )}
    </div>
  );
}

/**
 * A rate plan as Mira prepared it: every night with its signals, the current
 * entry rate and the proposed one. With `onToggle` the person chooses which
 * nights to approve.
 */
export function RatePlanView({ plan, selected, onToggle, approvedItems }: {
  plan: RatePlan;
  selected?: ReadonlySet<string>;
  onToggle?: (date: string) => void;
  approvedItems?: readonly string[] | null;
}) {
  const s = plan.summary;
  const approved = approvedItems ? new Set(approvedItems) : null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi icon={<CalendarDays className="h-4 w-4" />} label="Nights changing" value={`${s.changedNights} of ${s.nights}`} />
        <Kpi icon={<ArrowUpRight className="h-4 w-4 text-emerald-600" />} label="Up" value={String(s.raise)} />
        <Kpi icon={<ArrowDownRight className="h-4 w-4 text-amber-600" />} label="Down" value={String(s.lower)} />
        <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Average step" value={s.averageDeltaEur ? `${s.averageDeltaEur > 0 ? '+' : ''}${money(s.averageDeltaEur, plan.currency)}` : '—'} />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2">
        {plan.days.map((day) => (
          <DayCard key={day.date} day={day} currency={plan.currency}
            selectable={!!onToggle}
            selected={selected ? selected.has(day.date) : true}
            onToggle={onToggle}
            approved={approved?.has(day.date)} />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        One step per night moves every room type and occupancy together, so the room-type ladder stays intact.
        {plan.minimumRate ? ` Never below the ${money(plan.minimumRate, plan.currency)} floor.` : ''}
        {plan.marketScanAgeHours !== null ? ` Market scan ${Math.round(plan.marketScanAgeHours)} h old.` : ' No market scan.'}
        {plan.notes.length ? ` ${plan.notes.join(' ')}` : ''}
      </p>
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
