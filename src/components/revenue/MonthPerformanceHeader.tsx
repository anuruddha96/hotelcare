import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, BedDouble, Euro, Gauge, DoorOpen, TrendingUp, TrendingDown, Info } from "lucide-react";
import { eur, formatMonth, type DayMetrics } from "@/lib/revenueAnalytics";

const PICKUP_WINDOWS = [
  { value: 1, label: "Today" },
  { value: 2, label: "Yesterday + today" },
  { value: 3, label: "Last 3 days" },
  { value: 7, label: "Last 7 days" },
  { value: 14, label: "Last 14 days" },
  { value: 30, label: "Last 30 days" },
  { value: 60, label: "Last 60 days" },
  { value: 90, label: "Last 90 days" },
];

function Explain({ title, body }: { title: string; body: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`What is ${title}?`} className="ml-1 inline-flex align-middle text-muted-foreground hover:text-foreground">
          <Info className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 text-xs leading-relaxed">
        <p className="font-semibold mb-1">{title}</p>
        <p className="text-muted-foreground">{body}</p>
      </PopoverContent>
    </Popover>
  );
}

function Tile({ label, value, sub, icon, tone, explain }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; tone?: string;
  explain?: { title: string; body: string };
}) {
  return (
    <div className="flex-1 min-w-[128px] rounded-lg border p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}<span className="truncate">{label}</span>
        {explain && <Explain {...explain} />}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

function monthKey(iso: string) { return iso.slice(0, 7); }
function shiftMonth(key: string, delta: number) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/**
 * The decision header of the Revenue page: pick a month, see how that month is
 * performing on the books, and choose the pickup window that every other
 * section on the page reads from.
 */
export default function MonthPerformanceHeader({
  today, metrics, pickupWindowDays, onPickupWindowChange,
}: {
  today: string;
  metrics: DayMetrics[];
  pickupWindowDays: number;
  onPickupWindowChange: (days: number) => void;
}) {
  const [month, setMonth] = useState(() => monthKey(today));

  const months = useMemo(() => {
    const set = new Set(metrics.map((m) => monthKey(m.stay_date)));
    return Array.from(set).sort();
  }, [metrics]);

  const agg = useMemo(() => {
    const rows = metrics.filter((m) => monthKey(m.stay_date) === month);
    const sold = rows.reduce((s, m) => s + m.roomsSold, 0);
    const capacity = rows.reduce((s, m) => s + m.roomsAvailable, 0);
    const revenue = rows.reduce((s, m) => s + m.revenueEur, 0);
    const left = rows.reduce((s, m) => s + m.roomsLeft, 0);
    const pickup = rows.reduce((s, m) => s + (m.netPickup ?? 0), 0);
    return {
      days: rows.length,
      sold,
      capacity,
      left,
      revenue,
      pickup,
      occupancyPct: capacity ? (sold / capacity) * 100 : 0,
      adr: sold ? revenue / sold : null,
      revpar: capacity ? revenue / capacity : null,
    };
  }, [metrics, month]);

  const canPrev = months.length > 0 && month > months[0];
  const canNext = months.length > 0 && month < months[months.length - 1];

  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={!canPrev}
              onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>{formatMonth(`${m}-01`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={!canNext}
              onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1" />
          <Select value={String(pickupWindowDays)} onValueChange={(v) => onPickupWindowChange(Number(v))}>
            <SelectTrigger className="h-8 w-[165px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PICKUP_WINDOWS.map((p) => (
                <SelectItem key={p.value} value={String(p.value)}>Pickup: {p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-2">
          <Tile
            label="Occupancy"
            value={agg.capacity ? `${Math.round(agg.occupancyPct)}%` : "—"}
            sub={`${agg.sold} of ${agg.capacity} room-nights`}
            icon={<BedDouble className="h-3.5 w-3.5" />}
            explain={{ title: "Monthly occupancy", body: "Room-nights sold in this month ÷ sellable room-nights in this month (rooms × days). Source: Previo reservations." }}
          />
          <Tile
            label="ADR"
            value={eur(agg.adr)}
            sub="revenue ÷ room-nights sold"
            icon={<Euro className="h-3.5 w-3.5" />}
            explain={{ title: "ADR = Average Daily Rate", body: "Room revenue ÷ room-nights sold. The average price of what you actually sold this month." }}
          />
          <Tile
            label="RevPAR"
            value={eur(agg.revpar)}
            sub="ADR × occupancy"
            icon={<Gauge className="h-3.5 w-3.5" />}
            explain={{ title: "RevPAR = ADR × Occupancy", body: "Revenue per available room: room revenue ÷ all sellable room-nights. What every room earns on average, sold or not." }}
          />
          <Tile
            label="Revenue on the books"
            value={eur(agg.revenue)}
            sub={`${agg.days} day${agg.days === 1 ? "" : "s"} in view`}
            icon={<Euro className="h-3.5 w-3.5" />}
          />
          <Tile
            label="Rooms left to sell"
            value={agg.capacity ? String(agg.left) : "—"}
            sub="across the whole month"
            icon={<DoorOpen className="h-3.5 w-3.5" />}
          />
          <Tile
            label="Pickup in window"
            value={`${agg.pickup > 0 ? "+" : ""}${agg.pickup}`}
            sub="movement for this month's dates"
            icon={agg.pickup >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            tone={agg.pickup < 0 ? "text-destructive" : agg.pickup > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}
          />
        </div>
      </CardContent>
    </Card>
  );
}
