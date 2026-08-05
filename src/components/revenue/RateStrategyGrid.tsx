import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CalendarRange } from "lucide-react";
import {
  addDays, dateRange, eur, formatDay, formatMonth, formatWeekday, isWeekend, pickupHeat,
  type DayMetrics, type RoomTypeRate,
} from "@/lib/revenueAnalytics";
import type { RevenueRoomType } from "@/hooks/useRevenueHotelData";

interface Props {
  loading: boolean;
  today: string;
  roomTypes: RevenueRoomType[];
  rates: RoomTypeRate[];
  metrics: DayMetrics[];
  pickupWindowDays: number;
  onPickupWindowChange: (days: number) => void;
}

const RANGE_OPTIONS = [
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days" },
  { value: 120, label: "120 days" },
  { value: 180, label: "6 months" },
];

const PICKUP_WINDOWS = [
  { value: 1, label: "Yesterday" },
  { value: 3, label: "Last 3 days" },
  { value: 7, label: "Last 7 days" },
  { value: 14, label: "Last 14 days" },
  { value: 30, label: "Last 30 days" },
];

/**
 * Excel-style strategy calendar: room types down the left, dates across the top.
 * Each cell shows the live Previo base-plan price for that room type on that date.
 * The header rows carry occupancy and pickup, with pickup driving the heat colour.
 */
export default function RateStrategyGrid({
  loading, today, roomTypes, rates, metrics, pickupWindowDays, onPickupWindowChange,
}: Props) {
  const [days, setDays] = useState(90);
  const [occupancy, setOccupancy] = useState(2);

  const dates = useMemo(() => dateRange(today, addDays(today, days - 1)), [today, days]);

  const availableOccupancies = useMemo(() => {
    const s = new Set<number>();
    for (const r of rates) s.add(r.occupancy);
    return Array.from(s).sort((a, b) => a - b);
  }, [rates]);

  // obk_id -> stay_date -> price, for the chosen guest count.
  const priceMap = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const r of rates) {
      if (r.occupancy !== occupancy) continue;
      let inner = m.get(r.obk_id);
      if (!inner) { inner = new Map(); m.set(r.obk_id, inner); }
      inner.set(r.stay_date, Number(r.price));
    }
    return m;
  }, [rates, occupancy]);

  const metricByDate = useMemo(() => {
    const m = new Map<string, DayMetrics>();
    for (const x of metrics) m.set(x.stay_date, x);
    return m;
  }, [metrics]);

  // Only show room types Previo actually prices, ordered by the PMS order.
  const rows = useMemo(() => {
    const priced = roomTypes.filter((rt) => rt.pms_room_id && priceMap.has(rt.pms_room_id));
    return priced.length ? priced : roomTypes;
  }, [roomTypes, priceMap]);

  // Month spans for the grouped header.
  const monthSpans = useMemo(() => {
    const out: Array<{ label: string; span: number }> = [];
    for (const d of dates) {
      const label = formatMonth(d);
      const last = out[out.length - 1];
      if (last && last.label === label) last.span += 1;
      else out.push({ label, span: 1 });
    }
    return out;
  }, [dates]);

  const cellW = "min-w-[54px] w-[54px]";

  return (
    <Card data-training="revenue-grid">
      <CardHeader className="pb-3 gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-primary" />
            Rate &amp; pickup calendar
            <Badge variant="outline" className="font-normal">Previo base plan · EUR</Badge>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={String(occupancy)} onValueChange={(v) => setOccupancy(Number(v))}>
              <SelectTrigger className="h-8 w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(availableOccupancies.length ? availableOccupancies : [1, 2]).map((o) => (
                  <SelectItem key={o} value={String(o)}>{o} guest{o > 1 ? "s" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(pickupWindowDays)} onValueChange={(v) => onPickupWindowChange(Number(v))}>
              <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PICKUP_WINDOWS.map((p) => (
                  <SelectItem key={p.value} value={String(p.value)}>Pickup: {p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex rounded-md border overflow-hidden">
              {RANGE_OPTIONS.map((r) => (
                <Button
                  key={r.value}
                  size="sm"
                  variant={days === r.value ? "default" : "ghost"}
                  className="h-8 rounded-none px-2 text-xs"
                  onClick={() => setDays(r.value)}
                >
                  {r.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><i className="h-3 w-3 rounded-sm bg-orange-100 dark:bg-orange-900/40 border inline-block" />1 booking</span>
          <span className="flex items-center gap-1"><i className="h-3 w-3 rounded-sm bg-orange-300 dark:bg-orange-800/70 border inline-block" />2 bookings</span>
          <span className="flex items-center gap-1"><i className="h-3 w-3 rounded-sm bg-red-400 dark:bg-red-800 border inline-block" />3 bookings</span>
          <span className="flex items-center gap-1"><i className="h-3 w-3 rounded-sm bg-red-600 dark:bg-red-700 border inline-block" />4+ bookings</span>
          <span className="flex items-center gap-1"><i className="h-3 w-3 rounded-sm bg-sky-100 dark:bg-sky-900/40 border inline-block" />cancellations</span>
          <span className="flex items-center gap-1"><i className="h-3 w-3 rounded-sm bg-muted border inline-block" />weekend column</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading calendar…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            No room types yet — run a sync to pull them from Previo.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th className="sticky left-0 z-30 bg-card border-b border-r px-2 py-1 text-left min-w-[170px]" />
                  {monthSpans.map((m, i) => (
                    <th
                      key={`${m.label}-${i}`}
                      colSpan={m.span}
                      className="bg-muted/60 border-b border-l-2 border-l-foreground/30 px-2 py-1 text-left font-semibold whitespace-nowrap"
                    >
                      {m.label}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="sticky left-0 z-30 bg-card border-b border-r px-2 py-1 text-left">Date</th>
                  {dates.map((d) => (
                    <th
                      key={d}
                      className={`${cellW} border-b px-1 py-1 text-center font-medium ${isWeekend(d) ? "bg-muted" : "bg-card"} ${d.endsWith("-01") ? "border-l-2 border-l-foreground/30" : ""}`}
                    >
                      <div className="text-[10px] text-muted-foreground">{formatWeekday(d)}</div>
                      <div>{formatDay(d)}</div>
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="sticky left-0 z-30 bg-card border-b border-r px-2 py-1 text-left font-medium">
                    Pickup
                  </th>
                  {dates.map((d) => {
                    const m = metricByDate.get(d);
                    const pickup = m?.netPickup ?? m?.newBookings ?? 0;
                    const heat = pickupHeat(pickup);
                    return (
                      <th
                        key={d}
                        title={`${d} · ${pickup > 0 ? "+" : ""}${pickup} (${heat.label})`}
                        className={`${cellW} border-b px-1 py-1 text-center font-semibold ${heat.bg} ${heat.text} ${d.endsWith("-01") ? "border-l-2 border-l-foreground/30" : ""}`}
                      >
                        {pickup === 0 ? "·" : `${pickup > 0 ? "+" : ""}${pickup}`}
                      </th>
                    );
                  })}
                </tr>
                <tr>
                  <th className="sticky left-0 z-30 bg-card border-b border-r px-2 py-1 text-left font-medium">
                    Occupancy
                  </th>
                  {dates.map((d) => {
                    const m = metricByDate.get(d);
                    const pct = m?.occupancyPct ?? 0;
                    return (
                      <th
                        key={d}
                        title={`${m?.roomsSold ?? 0} / ${m?.roomsAvailable ?? 0} rooms`}
                        className={`${cellW} border-b px-1 py-1 text-center font-normal ${isWeekend(d) ? "bg-muted/60" : ""} ${d.endsWith("-01") ? "border-l-2 border-l-foreground/30" : ""}`}
                      >
                        {pct ? `${Math.round(pct)}%` : "—"}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((rt) => (
                  <tr key={rt.id} className="hover:bg-muted/40">
                    <td className="sticky left-0 z-10 bg-card border-b border-r px-2 py-1 whitespace-nowrap">
                      <span className="font-medium">{rt.name}</span>
                      {rt.is_reference && <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0">REF</Badge>}
                      <span className="ml-1 text-[10px] text-muted-foreground">×{rt.num_rooms}</span>
                    </td>
                    {dates.map((d) => {
                      const price = rt.pms_room_id ? priceMap.get(rt.pms_room_id)?.get(d) : undefined;
                      return (
                        <td
                          key={d}
                          className={`${cellW} border-b px-1 py-1 text-center tabular-nums ${isWeekend(d) ? "bg-muted/50" : ""} ${d.endsWith("-01") ? "border-l-2 border-l-foreground/30" : ""}`}
                        >
                          {price === undefined ? <span className="text-muted-foreground">—</span> : eur(price)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="bg-muted/30">
                  <td className="sticky left-0 z-10 bg-muted/30 border-r px-2 py-1 font-medium">ADR (realised)</td>
                  {dates.map((d) => (
                    <td key={d} className={`${cellW} px-1 py-1 text-center tabular-nums ${d.endsWith("-01") ? "border-l-2 border-l-foreground/30" : ""}`}>
                      {eur(metricByDate.get(d)?.adrEur ?? null)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
