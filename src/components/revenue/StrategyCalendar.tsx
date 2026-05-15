import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, TrendingDown, TrendingUp, Zap } from "lucide-react";

interface Row {
  date: string;
  rate: number | null;
  occupancy: number | null;
  pickupDelta: number;
  suggestedRate?: number | null;
  suggestedDelta?: number | null;
  rec?: { recommended_rate_eur: number; delta_eur: number } | null;
  abnormal?: boolean;
  events?: { id: string; title: string }[];
  hasDecision?: boolean;
  decisionType?: string | null;
}

interface Props {
  rowsByDate: Map<string, any>;
  onSelect: (date: string) => void;
  decisionsByDate?: Map<string, { decision_type: string; reason: string | null }>;
}

const DOW = ["Mo","Tu","We","Th","Fr","Sa","Su"];
const startOfMonth = (d: Date) => { const x = new Date(d); x.setUTCDate(1); x.setUTCHours(0,0,0,0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate()+n); return x; };
const iso = (d: Date) => d.toISOString().slice(0,10);
const fmt = (d: Date) => d.toLocaleString("en-US", { month: "long", year: "numeric" });

function MonthCard({ month, rowsByDate, onSelect, decisionsByDate, dense }: {
  month: Date; rowsByDate: Map<string, any>; onSelect: (d: string) => void;
  decisionsByDate?: Map<string, any>; dense?: boolean;
}) {
  const days = useMemo(() => {
    const first = startOfMonth(month);
    const offset = (first.getUTCDay() + 6) % 7;
    const start = addDays(first, -offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = addDays(start, i);
      return { d, inMonth: d.getUTCMonth() === month.getUTCMonth() };
    });
  }, [month]);

  return (
    <Card>
      <CardContent className="p-2">
        <div className="text-sm font-semibold text-center mb-1">{fmt(month)}</div>
        <div className="grid grid-cols-7 gap-px text-[10px] text-muted-foreground mb-1">
          {DOW.map(l => <div key={l} className="text-center">{l}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map(({ d, inMonth }) => {
            const date = iso(d);
            const r = rowsByDate.get(date) as Row | undefined;
            const decision = decisionsByDate?.get(date);
            const occ = r?.occupancy ?? null;
            const rate = r?.rec?.recommended_rate_eur ?? r?.rate ?? null;
            const delta = r?.rec?.delta_eur ?? r?.suggestedDelta ?? null;
            const isWeekend = (d.getUTCDay() === 0 || d.getUTCDay() === 6);

            return (
              <button
                key={date}
                type="button"
                disabled={!inMonth}
                onClick={() => inMonth && onSelect(date)}
                title={inMonth && r ? `${date} · €${rate ?? "—"}${occ != null ? ` · ${occ}% occ` : ""}${r.pickupDelta ? ` · pickup ${r.pickupDelta > 0 ? "+" : ""}${r.pickupDelta}` : ""}${decision ? ` · ${decision.reason ?? decision.decision_type}` : ""}` : ""}
                className={`text-left rounded-md border p-1 transition
                  ${dense ? "min-h-[44px]" : "min-h-[78px]"}
                  ${inMonth ? "hover:border-primary cursor-pointer" : "opacity-25"}
                  ${r?.abnormal ? "border-red-500 ring-1 ring-red-300" : ""}
                  ${isWeekend && inMonth ? "bg-muted/40" : ""}`}
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-semibold">{d.getUTCDate()}</span>
                  {r?.hasDecision || decision ? <Zap className="h-3 w-3 text-amber-500" /> : null}
                </div>
                {inMonth && rate != null && (
                  <div className={`text-[11px] font-bold leading-tight ${r?.rec ? "text-primary" : ""}`}>
                    €{Math.round(rate)}
                    {delta != null && delta !== 0 && (
                      <span className={`ml-1 text-[9px] font-medium ${delta > 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {delta > 0 ? "+" : ""}{Math.round(delta)}
                      </span>
                    )}
                  </div>
                )}
                {!dense && inMonth && occ != null && (
                  <div className="mt-0.5 h-1 rounded bg-muted overflow-hidden">
                    <div
                      className={`h-full ${occ >= 80 ? "bg-red-500" : occ >= 50 ? "bg-amber-400" : "bg-emerald-500"}`}
                      style={{ width: `${Math.min(100, occ)}%` }}
                    />
                  </div>
                )}
                {!dense && inMonth && r?.pickupDelta ? (
                  <div className={`mt-0.5 inline-flex items-center gap-0.5 text-[9px] font-medium px-1 rounded
                    ${r.pickupDelta > 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                    {r.pickupDelta > 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                    {r.pickupDelta > 0 ? "+" : ""}{r.pickupDelta}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default function StrategyCalendar({ rowsByDate, onSelect, decisionsByDate }: Props) {
  const [span, setSpan] = useState<"month" | "quarter" | "year">("quarter");
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));

  const months = useMemo(() => {
    const n = span === "month" ? 1 : span === "quarter" ? 3 : 12;
    return Array.from({ length: n }, (_, i) => {
      const x = new Date(cursor); x.setUTCMonth(cursor.getUTCMonth() + i);
      return x;
    });
  }, [cursor, span]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => setCursor(c => { const x = new Date(c); x.setUTCMonth(c.getUTCMonth() - (span === "year" ? 12 : span === "quarter" ? 3 : 1)); return x; })}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setCursor(c => { const x = new Date(c); x.setUTCMonth(c.getUTCMonth() + (span === "year" ? 12 : span === "quarter" ? 3 : 1)); return x; })}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor(startOfMonth(new Date()))}>Today</Button>
        </div>
        <div className="flex border rounded-md overflow-hidden">
          {(["month","quarter","year"] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setSpan(v)}
              className={`px-3 py-1 text-sm capitalize ${span === v ? "bg-primary text-primary-foreground" : ""}`}
            >{v}</button>
          ))}
        </div>
      </div>
      <div className={`grid gap-2 ${span === "month" ? "grid-cols-1" : span === "quarter" ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"}`}>
        {months.map(m => (
          <MonthCard
            key={iso(m)}
            month={m}
            rowsByDate={rowsByDate}
            onSelect={onSelect}
            decisionsByDate={decisionsByDate}
            dense={span === "year"}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500" /> Low occ</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-400" /> Mid occ</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500" /> High occ</span>
        <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3 text-amber-500" /> Autopilot decision</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded border border-red-500" /> Abnormal pickup</span>
      </div>
    </div>
  );
}
