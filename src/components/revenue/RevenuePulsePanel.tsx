import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, BedDouble, Euro, Gauge } from "lucide-react";
import { eur, type DayMetrics } from "@/lib/revenueAnalytics";
import { occupancyTone2, type RevenueThresholds, DEFAULT_THRESHOLDS } from "@/lib/revenueThresholds";

interface Props {
  today: string;
  metrics: DayMetrics[];
  roomsAvailable: number;
  thresholds?: RevenueThresholds;
}

function Tile({
  label, value, sub, icon, tone,
}: { label: string; value: string; sub?: string; icon: React.ReactNode; tone?: string }) {
  return (
    <div className="flex-1 min-w-[130px] rounded-lg border p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}<span className="truncate">{label}</span>
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

/**
 * "Today at a glance": every stay date that moved today, plus the live
 * occupancy / ADR / RevPAR for tonight — the numbers a revenue manager needs
 * before touching a single rate.
 */
export default function RevenuePulsePanel({
  today, metrics, roomsAvailable, thresholds = DEFAULT_THRESHOLDS,
}: Props) {
  const tonight = metrics.find((m) => m.stay_date === today);
  const moved = metrics.filter((m) => (m.netPickup ?? 0) !== 0);
  const totalPickup = moved.reduce((s, m) => s + (m.netPickup ?? 0), 0);
  const gained = moved.filter((m) => (m.netPickup ?? 0) > 0);
  const lost = moved.filter((m) => (m.netPickup ?? 0) < 0);
  const occTone = occupancyTone2(tonight?.occupancyPct ?? 0, thresholds);

  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          <Tile
            label="Pickup in window"
            value={`${totalPickup > 0 ? "+" : ""}${totalPickup}`}
            sub={`${gained.length} dates up · ${lost.length} down`}
            icon={totalPickup >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            tone={totalPickup < 0 ? "text-destructive" : totalPickup > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}
          />
          <Tile
            label="Occupancy tonight"
            value={tonight?.occupancyPct ? `${Math.round(tonight.occupancyPct)}%` : "—"}
            sub={`${tonight?.roomsSold ?? 0} / ${roomsAvailable} rooms`}
            icon={<BedDouble className="h-3.5 w-3.5" />}
            tone={occTone.severity === "critical" ? "text-destructive" : ""}
          />
          <Tile
            label="ADR tonight"
            value={eur(tonight?.adrEur ?? null)}
            sub="revenue ÷ rooms sold"
            icon={<Euro className="h-3.5 w-3.5" />}
          />
          <Tile
            label="RevPAR tonight"
            value={eur(tonight?.revparEur ?? null)}
            sub="ADR × occupancy"
            icon={<Gauge className="h-3.5 w-3.5" />}
          />
        </div>

        <div>
          <div className="text-[11px] font-medium text-muted-foreground mb-1">
            Dates that moved in this pickup window
          </div>
          {moved.length === 0 ? (
            <p className="text-xs text-muted-foreground">No bookings or cancellations in the selected window.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {moved.slice(0, 40).map((m) => {
                const up = (m.netPickup ?? 0) > 0;
                return (
                  <Badge
                    key={m.stay_date}
                    variant="outline"
                    className={up
                      ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-300"
                      : "border-sky-500/50 text-sky-700 dark:text-sky-300"}
                    title={`${m.newBookings} new · ${m.cancelledBookings} cancelled`}
                  >
                    {m.stay_date.slice(5)} {up ? "+" : ""}{m.netPickup}
                  </Badge>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
