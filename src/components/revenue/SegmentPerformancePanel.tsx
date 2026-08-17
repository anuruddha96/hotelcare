// Segment & channel performance for the whole property.
//
// Peaqplus's users praised "property level, not one segment" reporting. This
// panel does the same from data Hotel Care already syncs from Previo: every
// booking night carries the channel it came from, so rooms, revenue, ADR and
// share can be split per channel without a single extra PMS call.

import { useMemo, useState } from "react";
import { money } from "@/lib/revenueCurrency";
import type { BookingNight } from "@/lib/revenueAnalytics";
import { Button } from "@/components/ui/button";

interface Props {
  nights: BookingNight[];
  /** "YYYY-MM" — the month currently shown on the page. */
  selectedMonth: string;
}

interface Row {
  name: string;
  roomNights: number;
  reservations: number;
  revenue: number;
  pickup: number;
}

const WINDOWS = [1, 7, 30] as const;

function channelOf(n: BookingNight): string {
  const raw = (n.source_name ?? "").trim();
  if (!raw) return "Direct / unknown";
  return raw;
}

export default function SegmentPerformancePanel({ nights, selectedMonth }: Props) {
  const [win, setWin] = useState<(typeof WINDOWS)[number]>(7);

  const { rows, totals } = useMemo(() => {
    const since = Date.now() - win * 86_400_000;
    const map = new Map<string, Row & { resIds: Set<string> }>();

    for (const n of nights) {
      if (!n.stay_date?.startsWith(selectedMonth)) continue;
      const key = channelOf(n);
      let row = map.get(key);
      if (!row) {
        row = { name: key, roomNights: 0, reservations: 0, revenue: 0, pickup: 0, resIds: new Set() };
        map.set(key, row);
      }
      row.roomNights += 1;
      row.revenue += Number(n.nightly_price_eur ?? 0);
      if (n.res_id) row.resIds.add(n.res_id);
      const created = n.created_at_pms ? new Date(n.created_at_pms).getTime() : NaN;
      if (Number.isFinite(created) && created >= since) row.pickup += 1;
    }

    const list = [...map.values()].map((r) => ({ ...r, reservations: r.resIds.size }));
    list.sort((a, b) => b.revenue - a.revenue);
    const totals = list.reduce(
      (acc, r) => ({
        roomNights: acc.roomNights + r.roomNights,
        reservations: acc.reservations + r.reservations,
        revenue: acc.revenue + r.revenue,
        pickup: acc.pickup + r.pickup,
      }),
      { roomNights: 0, reservations: 0, revenue: 0, pickup: 0 },
    );
    return { rows: list, totals };
  }, [nights, selectedMonth, win]);

  if (!rows.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No booking data for {selectedMonth} yet. Run a Previo sync and come back.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Whole property, stays in {selectedMonth}. Pickup counts room nights booked in the last{" "}
          {win} day{win > 1 ? "s" : ""}.
        </p>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <Button
              key={w}
              size="sm"
              variant={w === win ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => setWin(w)}
            >
              {w}d
            </Button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-1.5 text-left font-medium">Channel / segment</th>
              <th className="py-1.5 text-right font-medium">Room nights</th>
              <th className="py-1.5 text-right font-medium">Res.</th>
              <th className="py-1.5 text-right font-medium">Revenue</th>
              <th className="py-1.5 text-right font-medium">ADR</th>
              <th className="py-1.5 text-right font-medium">Share</th>
              <th className="py-1.5 text-right font-medium">Pickup</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const share = totals.roomNights ? (r.roomNights / totals.roomNights) * 100 : 0;
              return (
                <tr key={r.name} className="border-b border-border/50">
                  <td className="py-1.5 pr-2">
                    <div className="truncate max-w-[13rem]">{r.name}</div>
                    <div className="mt-1 h-1 rounded bg-muted">
                      <div className="h-1 rounded bg-primary" style={{ width: `${share}%` }} />
                    </div>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{r.roomNights}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.reservations}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(r.revenue)}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {r.roomNights ? money(r.revenue / r.roomNights) : "—"}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{share.toFixed(0)}%</td>
                  <td className="py-1.5 text-right tabular-nums">{r.pickup ? `+${r.pickup}` : "0"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td className="py-1.5">Whole property</td>
              <td className="py-1.5 text-right tabular-nums">{totals.roomNights}</td>
              <td className="py-1.5 text-right tabular-nums">{totals.reservations}</td>
              <td className="py-1.5 text-right tabular-nums">{money(totals.revenue)}</td>
              <td className="py-1.5 text-right tabular-nums">
                {totals.roomNights ? money(totals.revenue / totals.roomNights) : "—"}
              </td>
              <td className="py-1.5 text-right">100%</td>
              <td className="py-1.5 text-right tabular-nums">
                {totals.pickup ? `+${totals.pickup}` : "0"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
