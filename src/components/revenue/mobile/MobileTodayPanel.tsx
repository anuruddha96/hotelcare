import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { addDays, dateRange, formatWeekday, type DayMetrics } from "@/lib/revenueAnalytics";
import { money } from "@/lib/revenueCurrency";

/**
 * The whole of "today" on one phone screen: what is sold, what it earned, and
 * how the next week is picking up. No multi-series charts.
 */
export default function MobileTodayPanel({
  today, metrics, lastSyncAt,
}: {
  today: string;
  metrics: DayMetrics[];
  lastSyncAt: string | null;
}) {
  const byDate = useMemo(() => {
    const m = new Map<string, DayMetrics>();
    for (const x of metrics) m.set(x.stay_date, x);
    return m;
  }, [metrics]);

  const t = byDate.get(today);
  const week = useMemo(() => dateRange(today, addDays(today, 6)).map((d) => ({
    date: d,
    m: byDate.get(d),
  })), [today, byDate]);

  const maxPickup = Math.max(1, ...week.map((w) => Math.abs(w.m?.netPickup ?? 0)));

  const stats = [
    { label: "Rooms sold", value: t ? String(t.roomsSold) : "—" },
    { label: "Occupancy", value: t?.occupancyPct != null ? `${Math.round(t.occupancyPct)}%` : "—" },
    { label: "Revenue", value: t ? money(t.revenueEur) : "—" },
    { label: "ADR", value: t?.adrEur != null ? money(t.adrEur) : "—" },
  ];

  return (
    <div className="space-y-3 pb-6">
      <div className="grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
              <div className="mt-1 text-xl font-semibold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="text-sm font-medium">Next 7 days</div>
          <div className="mt-3 flex items-end justify-between gap-1">
            {week.map((w) => {
              const pickup = w.m?.netPickup ?? 0;
              const height = Math.round((Math.abs(pickup) / maxPickup) * 44) + 2;
              return (
                <div key={w.date} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-12 items-end">
                    <div
                      className={cn("w-5 rounded-t", pickup >= 0 ? "bg-primary" : "bg-destructive")}
                      style={{ height }}
                    />
                  </div>
                  <div className="text-[10px] font-medium">{pickup > 0 ? `+${pickup}` : pickup}</div>
                  <div className="text-[10px] text-muted-foreground">{formatWeekday(w.date)}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {w.m?.occupancyPct != null ? `${Math.round(w.m.occupancyPct)}%` : "—"}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Bars show rooms gained or given back in the pickup window.
          </p>
        </CardContent>
      </Card>

      {lastSyncAt && (
        <p className="text-center text-[11px] text-muted-foreground">
          Data from {new Date(lastSyncAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </div>
  );
}
