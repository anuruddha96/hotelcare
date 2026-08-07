import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowDownRight, ArrowUpRight, Scale } from "lucide-react";
import { eur, type DayMetrics } from "@/lib/revenueAnalytics";

type Filter = "all" | "gained" | "lost";

/**
 * "What moved in this pickup window?" — one readable board instead of a row of
 * chips: how many room-nights each stay date gained, how many it lost, and
 * what that is worth in money.
 */
export default function PickupMovementBoard({
  metrics, windowDays,
}: { metrics: DayMetrics[]; windowDays: number }) {
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo(
    () => metrics.filter((m) => (m.netPickup ?? 0) !== 0 || m.roomsLost > 0 || m.newBookings > 0),
    [metrics],
  );

  const totals = useMemo(() => {
    let gainedRooms = 0, lostRooms = 0, gainedEur = 0, lostEur = 0;
    for (const m of rows) {
      gainedRooms += m.newBookings;
      lostRooms += m.roomsLost;
      gainedEur += m.newRevenueEur;
      lostEur += m.lostRevenueEur;
    }
    return {
      gainedRooms, lostRooms, gainedEur, lostEur,
      netRooms: gainedRooms - lostRooms,
      netEur: Math.round((gainedEur - lostEur) * 100) / 100,
    };
  }, [rows]);

  const visible = useMemo(() => rows
    .filter((m) => (filter === "gained" ? m.newBookings > 0 : filter === "lost" ? m.roomsLost > 0 : true))
    .sort((a, b) => a.stay_date.localeCompare(b.stay_date)), [rows, filter]);

  const noBaseline = rows.length > 0 && rows.every((m) => !m.baselineAvailable);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
          What moved in the last {windowDays} day{windowDays === 1 ? "" : "s"}
          <Badge variant="outline" className="font-normal">Budapest time</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Summary
            label="Gained" rooms={totals.gainedRooms} money={totals.gainedEur}
            tone="text-emerald-600 dark:text-emerald-400"
            icon={<ArrowUpRight className="h-3.5 w-3.5" />}
            active={filter === "gained"} onClick={() => setFilter(filter === "gained" ? "all" : "gained")}
          />
          <Summary
            label="Lost" rooms={-totals.lostRooms} money={-totals.lostEur}
            tone="text-sky-600 dark:text-sky-400"
            icon={<ArrowDownRight className="h-3.5 w-3.5" />}
            active={filter === "lost"} onClick={() => setFilter(filter === "lost" ? "all" : "lost")}
          />
          <Summary
            label="Net" rooms={totals.netRooms} money={totals.netEur}
            tone={totals.netRooms < 0 ? "text-destructive" : "text-foreground"}
            icon={<Scale className="h-3.5 w-3.5" />}
            active={filter === "all"} onClick={() => setFilter("all")}
          />
        </div>

        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing was booked or cancelled for these stay dates in the selected window.
          </p>
        ) : (
          <div className="rounded border overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-1 bg-muted text-[10px] uppercase tracking-wide text-muted-foreground">
              <span>Stay date</span><span className="text-right">Gained</span>
              <span className="text-right">Lost</span><span className="text-right w-20">Net value</span>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y">
              {visible.map((m) => {
                const net = m.newBookings - m.roomsLost;
                const netEur = Math.round((m.newRevenueEur - m.lostRevenueEur) * 100) / 100;
                return (
                  <div
                    key={m.stay_date}
                    className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-1.5 text-sm items-center animate-fade-in"
                  >
                    <span className="truncate">
                      {new Date(`${m.stay_date}T00:00:00Z`).toLocaleDateString(undefined, {
                        timeZone: "UTC", weekday: "short", day: "numeric", month: "short",
                      })}
                    </span>
                    <span className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                      {m.newBookings ? `+${m.newBookings}` : "—"}
                    </span>
                    <span className="text-right tabular-nums text-sky-600 dark:text-sky-400">
                      {m.roomsLost ? `−${m.roomsLost}` : "—"}
                    </span>
                    <span className={`text-right tabular-nums w-20 font-medium ${net < 0 ? "text-destructive" : ""}`}>
                      {netEur === 0 ? "—" : `${netEur > 0 ? "+" : "−"}${eur(Math.abs(netEur))}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {noBaseline && (
          <p className="text-[11px] text-muted-foreground">
            Losses are counted from cancellations the PMS reported. Once a few more daily
            snapshots build up, rooms that quietly disappear will also be caught.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Summary({
  label, rooms, money, tone, icon, active, onClick,
}: {
  label: string; rooms: number; money: number; tone: string;
  icon: React.ReactNode; active: boolean; onClick: () => void;
}) {
  return (
    <Button
      variant={active ? "secondary" : "outline"}
      onClick={onClick}
      className="h-auto flex-col items-start gap-0.5 p-2.5 transition-transform hover:scale-[1.02]"
    >
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">{icon}{label}</span>
      <span className={`text-xl font-semibold tabular-nums ${tone}`}>
        {rooms > 0 ? "+" : rooms < 0 ? "−" : ""}{Math.abs(rooms)}
      </span>
      <span className="text-[11px] text-muted-foreground">{money === 0 ? "—" : eur(Math.abs(money))}</span>
    </Button>
  );
}
