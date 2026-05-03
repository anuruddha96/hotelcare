import { useMemo } from "react";

export interface MiniDay {
  date: string;
  rate: number | null;
  suggestedDelta: number | null;
  inMonth: boolean;
  abnormal: boolean;
  hasEvent: boolean;
}

interface Props {
  monthsAhead?: number; // default 12
  startMonth?: Date;
  rowsByDate: Map<string, any>;
  onSelect: (date: string) => void;
}

const DOW_LABELS = ["M","T","W","T","F","S","S"];

function startOfMonthUTC(d: Date) { const x = new Date(d); x.setUTCDate(1); x.setUTCHours(0,0,0,0); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setUTCDate(x.getUTCDate()+n); return x; }
function iso(d: Date) { return d.toISOString().slice(0,10); }
function fmtMonth(d: Date) { return d.toLocaleString("en-US", { month: "short", year: "2-digit" }); }

function MiniMonth({ month, rowsByDate, onSelect }: { month: Date; rowsByDate: Map<string, any>; onSelect: (d: string) => void }) {
  const cells = useMemo(() => {
    const first = startOfMonthUTC(month);
    const offset = (first.getUTCDay() + 6) % 7;
    const start = addDays(first, -offset);
    const days: { d: Date; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      days.push({ d, inMonth: d.getUTCMonth() === month.getUTCMonth() });
    }
    return days;
  }, [month]);

  return (
    <div className="rounded-lg border p-2 bg-card">
      <div className="text-sm font-semibold mb-1 text-center">{fmtMonth(month)}</div>
      <div className="grid grid-cols-7 gap-px text-[9px] text-muted-foreground mb-1">
        {DOW_LABELS.map((l, i) => <div key={i} className="text-center">{l}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {cells.map(({ d, inMonth }) => {
          const date = iso(d);
          const r = rowsByDate.get(date);
          const delta = r?.suggestedDelta as number | null | undefined;
          let bg = "bg-transparent";
          if (inMonth && r?.rate != null) {
            if (delta != null && delta > 0) bg = delta > 10 ? "bg-emerald-500/70" : "bg-emerald-500/30";
            else if (delta != null && delta < 0) bg = delta < -10 ? "bg-red-500/70" : "bg-red-500/30";
            else bg = "bg-muted";
          }
          if (r?.abnormal) bg = "bg-red-600/80";
          return (
            <button
              key={date}
              type="button"
              onClick={() => inMonth && onSelect(date)}
              disabled={!inMonth}
              title={inMonth && r?.rate != null ? `${date} · €${r.rate}${delta ? ` (${delta>0?'+':''}${delta})` : ""}` : ""}
              className={`aspect-square rounded-sm text-[9px] font-medium flex items-center justify-center transition
                ${inMonth ? "hover:ring-1 hover:ring-primary cursor-pointer" : "opacity-20"}
                ${bg}
                ${r?.hasEvent ? "ring-1 ring-purple-500" : ""}`}
            >
              {d.getUTCDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CalendarYearView({ monthsAhead = 12, startMonth, rowsByDate, onSelect }: Props) {
  const months = useMemo(() => {
    const start = startMonth ? startOfMonthUTC(startMonth) : startOfMonthUTC(new Date());
    return Array.from({ length: monthsAhead }, (_, i) => {
      const x = new Date(start);
      x.setUTCMonth(start.getUTCMonth() + i);
      return x;
    });
  }, [startMonth, monthsAhead]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/70" /> Increase</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500/70" /> Decrease</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-muted" /> No change</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded ring-1 ring-purple-500" /> Event</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-600/80" /> Abnormal pickup</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {months.map(m => <MiniMonth key={iso(m)} month={m} rowsByDate={rowsByDate} onSelect={onSelect} />)}
      </div>
    </div>
  );
}

export function CalendarQuarterView({ startMonth, rowsByDate, onSelect }: Omit<Props, "monthsAhead">) {
  return <CalendarYearView monthsAhead={3} startMonth={startMonth} rowsByDate={rowsByDate} onSelect={onSelect} />;
}
