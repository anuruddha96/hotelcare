import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TrendingUp } from "lucide-react";
import {
  addDays, budapestDayOf, budapestToday, eur, type BookingNight,
} from "@/lib/revenueAnalytics";

/**
 * "How much did we pick up for this date range?"
 * Counts booked room-nights whose booking was CREATED inside the chosen
 * capture window, broken down by the stay dates the user selects.
 * All dates are Budapest calendar dates.
 */
export default function PickupRangeSummary({ nights }: { nights: BookingNight[] }) {
  const today = budapestToday();
  const [stayFrom, setStayFrom] = useState(today);
  const [stayTo, setStayTo] = useState(addDays(today, 30));
  const [bookedFrom, setBookedFrom] = useState(addDays(today, -7));
  const [bookedTo, setBookedTo] = useState(today);

  /** Which stay date is expanded to show its individual bookings. */
  const [openDate, setOpenDate] = useState<string | null>(null);

  const result = useMemo(() => {
    const rows = nights.filter((n) => {
      if (n.stay_date < stayFrom || n.stay_date > stayTo) return false;
      if (!n.created_at_pms) return false;
      const created = budapestDayOf(n.created_at_pms);
      return created >= bookedFrom && created <= bookedTo;
    });
    const revenue = rows.reduce((s, n) => s + (n.nightly_price_eur ?? 0), 0);
    const byDate = new Map<string, { nights: number; revenue: number; res: Set<string>; items: BookingNight[] }>();
    for (const n of rows) {
      const cur = byDate.get(n.stay_date) ?? { nights: 0, revenue: 0, res: new Set<string>(), items: [] };
      cur.nights += 1;
      cur.revenue += n.nightly_price_eur ?? 0;
      cur.res.add(n.res_id);
      cur.items.push(n);
      byDate.set(n.stay_date, cur);
    }
    const reservations = new Set(rows.map((n) => n.res_id)).size;
    const perDate = Array.from(byDate.entries())
      .map(([date, v]) => ({
        date,
        nights: v.nights,
        revenue: v.revenue,
        reservations: v.res.size,
        items: v.items.sort((a, b) => (b.created_at_pms ?? "").localeCompare(a.created_at_pms ?? "")),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      roomNights: rows.length,
      reservations,
      revenue,
      adr: rows.length ? revenue / rows.length : null,
      perDate,
    };
  }, [nights, stayFrom, stayTo, bookedFrom, bookedTo]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Pickup explorer
          <Badge variant="outline" className="font-normal">Budapest time</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <div>
            <Label className="text-[11px] text-muted-foreground">Stay dates from</Label>
            <Input type="date" value={stayFrom} onChange={(e) => setStayFrom(e.target.value)} className="h-8" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Stay dates to</Label>
            <Input type="date" value={stayTo} onChange={(e) => setStayTo(e.target.value)} className="h-8" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Booked from</Label>
            <Input type="date" value={bookedFrom} onChange={(e) => setBookedFrom(e.target.value)} className="h-8" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Booked to</Label>
            <Input type="date" value={bookedTo} onChange={(e) => setBookedTo(e.target.value)} className="h-8" />
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Stat label="Room nights" value={String(result.roomNights)} />
          <Stat label="Reservations" value={String(result.reservations)} />
          <Stat label="Revenue" value={eur(result.revenue)} />
          <Stat label="ADR" value={eur(result.adr)} />
        </div>

        {result.perDate.length > 0 && (
          <div className="rounded border divide-y max-h-80 overflow-y-auto">
            <div className="sticky top-0 z-10 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted">
              Stay dates picked up — tap a day to see each booking
            </div>
            {result.perDate.map((r) => (
              <div key={r.date}>
                <button
                  type="button"
                  onClick={() => setOpenDate((d) => (d === r.date ? null : r.date))}
                  className="w-full flex items-center justify-between px-2 py-1.5 text-sm hover:bg-muted/50 text-left"
                >
                  <span className="flex items-center gap-2">
                    <ChevronRight className={`h-3.5 w-3.5 transition-transform ${openDate === r.date ? "rotate-90" : ""}`} />
                    {new Date(`${r.date}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })}
                  </span>
                  <span className="flex items-center gap-2 sm:gap-3">
                    <span className="text-muted-foreground text-xs hidden sm:inline">{r.reservations} res.</span>
                    <span className="text-muted-foreground text-xs">{eur(r.revenue)}</span>
                    <Badge variant={r.nights >= 3 ? "destructive" : "secondary"}>+{r.nights}</Badge>
                  </span>
                </button>
                {openDate === r.date && (
                  <div className="bg-muted/30 px-2 py-1 space-y-1">
                    {r.items.map((n, i) => (
                      <div key={`${n.res_id}-${i}`} className="flex flex-wrap items-center justify-between gap-x-3 text-[11px]">
                        <span className="text-muted-foreground">
                          booked {n.created_at_pms
                            ? new Date(n.created_at_pms).toLocaleString(undefined, { timeZone: "Europe/Budapest", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                            : "—"}
                        </span>
                        <span className="truncate max-w-[45%]">{n.room_type_name ?? "—"}</span>
                        <span className="font-medium">{eur(n.nightly_price_eur)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {result.roomNights === 0 && (
          <p className="text-sm text-muted-foreground">No bookings were created in that window for those stay dates.</p>
        )}
        <p className="text-[11px] text-muted-foreground">
          Days with strong pickup are candidates for a rate increase; open a day to see when each
          booking came in, which room type sold and at what nightly rate.
        </p>

      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-bold leading-tight">{value}</div>
    </div>
  );
}
