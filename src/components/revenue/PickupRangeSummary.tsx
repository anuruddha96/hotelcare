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

  const result = useMemo(() => {
    const rows = nights.filter((n) => {
      if (n.stay_date < stayFrom || n.stay_date > stayTo) return false;
      if (!n.created_at_pms) return false;
      const created = budapestDayOf(n.created_at_pms);
      return created >= bookedFrom && created <= bookedTo;
    });
    const revenue = rows.reduce((s, n) => s + (n.nightly_price_eur ?? 0), 0);
    const byDate = new Map<string, { nights: number; revenue: number }>();
    for (const n of rows) {
      const cur = byDate.get(n.stay_date) ?? { nights: 0, revenue: 0 };
      cur.nights += 1;
      cur.revenue += n.nightly_price_eur ?? 0;
      byDate.set(n.stay_date, cur);
    }
    const reservations = new Set(rows.map((n) => n.res_id)).size;
    const top = Array.from(byDate.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => b.nights - a.nights || a.date.localeCompare(b.date))
      .slice(0, 8);
    return {
      roomNights: rows.length,
      reservations,
      revenue,
      adr: rows.length ? revenue / rows.length : null,
      top,
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

        {result.top.length > 0 && (
          <div className="rounded border divide-y">
            <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40">
              Strongest stay dates in this pickup
            </div>
            {result.top.map((r) => (
              <div key={r.date} className="flex items-center justify-between px-2 py-1 text-sm">
                <span>{new Date(`${r.date}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })}</span>
                <span className="flex items-center gap-3">
                  <span className="text-muted-foreground">{eur(r.revenue)}</span>
                  <Badge variant={r.nights >= 3 ? "destructive" : "secondary"}>+{r.nights}</Badge>
                </span>
              </div>
            ))}
          </div>
        )}
        {result.roomNights === 0 && (
          <p className="text-sm text-muted-foreground">No bookings were created in that window for those stay dates.</p>
        )}
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
