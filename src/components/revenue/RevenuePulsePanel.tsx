import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, BedDouble, Euro, Gauge } from "lucide-react";
import { eur, type DayMetrics } from "@/lib/revenueAnalytics";
import { occupancyTone2, type RevenueThresholds, DEFAULT_THRESHOLDS } from "@/lib/revenueThresholds";
import { useTranslation } from "@/hooks/useTranslation";

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
  const { language } = useTranslation();
  const hu = language === "hu";
  const tonight = metrics.find((m) => m.stay_date === today);
  const hasTonightData = Boolean(tonight);
  const moved = metrics.filter((m) => (m.netPickup ?? 0) !== 0);
  const totalPickup = moved.reduce((s, m) => s + (m.netPickup ?? 0), 0);
  const gained = moved.filter((m) => (m.netPickup ?? 0) > 0);
  const lost = moved.filter((m) => (m.netPickup ?? 0) < 0);
  const occTone = hasTonightData ? occupancyTone2(tonight?.occupancyPct ?? 0, thresholds) : null;

  // Prefer the stay-date metric's PMS-derived inventory. The prop is a legacy
  // fallback and can represent a different hotel-level/static room count.
  const tonightInventory = hasTonightData
    ? (tonight?.roomsAvailable ?? roomsAvailable)
    : null;
  const roomsLeftTonight = hasTonightData
    ? (tonight?.roomsLeft ?? Math.max(0, (tonightInventory ?? 0) - (tonight?.roomsSold ?? 0)))
    : null;
  const action = hu ? (!hasTonightData
    ? "A ma esti PMS-adatok nem érhetők el. Az adatok frissítéséig ne módosíts tarifát ezen kártya alapján."
    : roomsLeftTonight === 0 ? "Ma estére minden szoba elkelt. Védd a következő elérhető napok árait."
    : occTone?.severity === "critical" ? `${roomsLeftTonight} szoba még szabad estére – mérlegelj rövid távú árcsökkentést a minimális ADR alatt nem.`
    : totalPickup > 0 ? `Pozitív a foglalásváltozás (${totalPickup} nettó) – tartsd vagy emeld az érintett napok árait.`
    : `${roomsLeftTonight} szoba maradt estére – árkorrekció előtt figyeld a foglalásváltozást.`)
    : !hasTonightData
    ? "Tonight's PMS metrics are unavailable. Do not make a rate decision from this card until the stay-date data refreshes."
    : roomsLeftTonight === 0
      ? "Sold out tonight — protect rate on the next open dates."
      : occTone?.severity === "critical"
        ? `${roomsLeftTonight} unit${roomsLeftTonight === 1 ? "" : "s"} still open tonight — consider a short-term price cut, but never below the minimum ADR.`
        : totalPickup > 0
          ? `Pickup is positive (${totalPickup} net) — hold or raise prices on the dates that moved.`
          : `${roomsLeftTonight} unit${roomsLeftTonight === 1 ? "" : "s"} left tonight — watch pickup before changing anything.`;

  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">{hu ? "Mai teljesítmény" : "Today's performance"}</h2>
          <span className="text-[11px] text-muted-foreground">{hu ? 'ma esti tartózkodás' : "tonight's stay date"}</span>
        </div>

        {!hasTonightData && (
          <div role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-800 dark:text-amber-200">
            {hu ? "A ma esti PMS-adatok nem elérhetők. A hiányzó értékeket nem tekintjük nullának." : "Tonight's PMS data is unavailable. Values below stay blank instead of being treated as zero."}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Tile
            label={hu ? "Foglalásváltozás az időszakban" : "Pickup in window"}
            value={`${totalPickup > 0 ? "+" : ""}${totalPickup}`}
            sub={`${gained.length} ${hu ? "nap nőtt" : "dates up"} · ${lost.length} ${hu ? "csökkent" : "down"}`}
            icon={totalPickup >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            tone={totalPickup < 0 ? "text-destructive" : totalPickup > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}
          />
          <Tile
            label={hu ? "Ma esti kihasználtság" : "Occupancy tonight"}
            value={hasTonightData ? `${Math.round(tonight?.occupancyPct ?? 0)}%` : "—"}
            sub={hasTonightData ? `${tonight?.roomsSold ?? 0} / ${tonightInventory} ${hu ? "szoba" : "rooms"}` : (hu ? "PMS-adatok nem elérhetők" : "PMS stay-date data unavailable")}
            icon={<BedDouble className="h-3.5 w-3.5" />}
            tone={occTone?.severity === "critical" ? "text-destructive" : ""}
          />
          <Tile
            label={hu ? "Ma esti ADR" : "ADR tonight"}
            value={hasTonightData ? eur(tonight?.adrEur ?? null) : "—"}
            sub={hasTonightData ? (hu ? "bevétel ÷ eladott szobák" : "revenue ÷ rooms sold") : "PMS stay-date data unavailable"}
            icon={<Euro className="h-3.5 w-3.5" />}
          />
          <Tile
            label={hu ? "Ma esti RevPAR" : "RevPAR tonight"}
            value={hasTonightData ? eur(tonight?.revparEur ?? null) : "—"}
            sub={hasTonightData ? (hu ? "ADR × kihasználtság" : "ADR × occupancy") : "PMS stay-date data unavailable"}
            icon={<Gauge className="h-3.5 w-3.5" />}
          />
        </div>

        <div className="rounded-md border bg-muted/30 px-2.5 py-2 text-[11px]">
          <span className="font-medium">{hu ? "Javasolt teendő: " : "What to do now: "}</span>
          <span className="text-muted-foreground">{action}</span>
          {hasTonightData && moved.length > 0 && (
            <span className="text-muted-foreground">
              {" "}({hu ? `${gained.length} nap növekedés · ${lost.length} csökkenés – részletek a foglalásváltozási táblában.` : `${gained.length} date${gained.length === 1 ? "" : "s"} up · ${lost.length} down — detail in the movement board below.`})
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
