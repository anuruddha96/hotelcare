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

  const roomsLeftTonight = Math.max(0, roomsAvailable - (tonight?.roomsSold ?? 0));
  const action = roomsLeftTonight === 0
    ? "Sold out tonight — protect rate on the next open dates."
    : occTone.severity === "critical"
      ? `${roomsLeftTonight} unit${roomsLeftTonight === 1 ? "" : "s"} still open tonight — consider a short-term price cut, but never below the minimum ADR.`
      : totalPickup > 0
        ? `Pickup is positive (${totalPickup} net) — hold or raise prices on the dates that moved.`
        : `${roomsLeftTonight} unit${roomsLeftTonight === 1 ? "" : "s"} left tonight — watch pickup before changing anything.`;

  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Today's performance</h2>
          <span className="text-[11px] text-muted-foreground">tonight's stay date</span>
        </div>

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

        {moved.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {gained.length} date{gained.length === 1 ? "" : "s"} up · {lost.length} down — see the
            movement board below for the detail.
          </p>
        )}

      </CardContent>
    </Card>
  );
}
