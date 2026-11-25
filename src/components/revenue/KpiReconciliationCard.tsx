import { useMemo } from "react";
import { ShieldCheck } from "lucide-react";
import { useMonthReconciliationDays } from "@/hooks/useMonthReconciliationDays";
import { useTranslation } from "@/hooks/useTranslation";
import {
  summariseReconciliationDays,
  type KpiReconciliationMonth,
  type MonthBreakdownRow,
  type ReconciliationDay,
} from "@/lib/kpiReconciliation";

export type { KpiReconciliationMonth, MonthBreakdownRow, ReconciliationDay };

const pct = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? "—" : `${Math.round(Number(v))}%`;


/**
 * Explains, in one place, why the Previo dashboard and HotelCare show different
 * occupancy for the same month, and which figure to trust.
 */
export function KpiReconciliationView({
  row,
  hu = false,
  embedded = false,
}: {
  row: KpiReconciliationMonth;
  hu?: boolean;
  embedded?: boolean;
}) {
  const gap = row.booked_nights_all - row.previo_dashboard_occupied;
  const tiles = [
    {
      key: "previo",
      label: hu ? "Previo irányítópult" : "Previo dashboard",
      value: pct(row.previo_dashboard_occupancy_pct),
      sub: hu
        ? `${row.previo_dashboard_occupied} éj, csak kiosztott szobával`
        : `${row.previo_dashboard_occupied} room-nights with a room assigned`,
    },
    {
      key: "hotelcare",
      label: hu ? "HotelCare (kereskedelmi)" : "HotelCare (commercial)",
      value: pct(row.hotelcare_commercial_occupancy_pct),
      sub: hu
        ? `${row.commercial_sold} eladott éj, kiosztatlanokkal együtt`
        : `${row.commercial_sold} sold room-nights, incl. not-yet-assigned`,
    },
    {
      key: "best",
      label: hu ? "Ellenőrzött" : "Verified",
      value: pct(row.best_physical_occupancy_pct),
      sub: row.past_nights > 0
        ? (hu
          ? `${row.housekeeping_verified_nights}/${row.past_nights} múltbeli éj a takarítási lista alapján`
          : `${row.housekeeping_verified_nights}/${row.past_nights} past nights checked against housekeeping`)
        : (hu ? "Jövő: minden foglalás a könyvben" : "Future: every booking on the books"),
    },
  ];

  const reasons: string[] = [];
  if (row.unassigned_nights > 0) {
    reasons.push(hu
      ? `${row.unassigned_nights} foglalt éjhez még nincs szoba rendelve — a Previo ezeket nem számolja.`
      : `${row.unassigned_nights} booked room-nights have no room assigned yet — Previo's dashboard leaves them out.`);
  }
  if (row.hold_nights > 0) {
    reasons.push(hu
      ? `${row.hold_nights} éj hosszú távú (több éves) foglalás: a Previo foglaltnak számolja, a HotelCare kiveszi az eladásból és a kapacitásból is. Kereskedelmi kihasználtság ezek nélkül: ${pct(row.best_commercial_occupancy_pct)}.`
      : `${row.hold_nights} room-nights are multi-year holds: Previo counts them as occupied, HotelCare removes them from both sales and capacity. Commercial occupancy without them: ${pct(row.best_commercial_occupancy_pct)}.`);
  }
  if (row.option_nights > 0) {
    reasons.push(hu
      ? `${row.option_nights} éj opciós (nem megerősített) foglalás mindkét rendszerben benne van.`
      : `${row.option_nights} room-nights are options (not confirmed) and are counted by both systems.`);
  }
  if (row.housekeeping_mismatch_nights > 0) {
    reasons.push(hu
      ? `${row.housekeeping_mismatch_nights} éjnél a takarítási lista jelentősen eltér a foglalásoktól — ellenőrizendő.`
      : `${row.housekeeping_mismatch_nights} nights where the housekeeping list differs a lot from bookings — worth a look.`);
  }

  return (
    <div data-testid="kpi-reconciliation" className={embedded ? "mt-3 border-t pt-3" : "rounded-lg border p-3"}>

        <details className="group text-xs">
          <summary className="flex cursor-pointer items-center gap-2 font-medium">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            {hu ? "Kihasználtság ellenőrzés" : "Occupancy verified"}
            <span className="ml-auto text-muted-foreground">{gap !== 0 ? (hu ? `Previo eltérés: ${gap > 0 ? "+" : ""}${gap} éj` : `Previo gap: ${gap > 0 ? "+" : ""}${gap} room-nights`) : (hu ? "Nincs eltérés" : "No discrepancy")}</span>
          </summary>
          <div className="mt-3 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          {hu ? "Kihasználtság egyeztetés" : "Occupancy cross-check"}
          {gap !== 0 && (
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {hu ? `Eltérés a Previótól: ${gap > 0 ? "+" : ""}${gap} éj` : `Gap vs Previo: ${gap > 0 ? "+" : ""}${gap} room-nights`}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.key} className="rounded-lg border p-3">
              <div className="text-[11px] text-muted-foreground">{t.label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{t.value}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{t.sub}</div>
            </div>
          ))}
        </div>
        {reasons.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
            {reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">
          {hu
            ? "A Previo havi kártyája a friss, aznap reggeli foglalásokat késve mutathatja. Az ADR összetételét a fenti havi táblázat mutatja."
            : "Previo's month card can lag bookings made the same morning. How ADR is built is shown in the month table above."}
        </p>
          </div>
        </details>
    </div>
  );
}

/** Loads the selected month for one hotel. Renders nothing until data exists. */
export default function KpiReconciliationCard({ hotelId, month, embedded = false }: { hotelId: string | null; month: string; embedded?: boolean }) {
  const { language } = useTranslation();
  // Same cached request as the month header: one call per hotel-month.
  const { data: days = [] } = useMonthReconciliationDays(hotelId, month);

  const row = useMemo(() => summariseReconciliationDays(days), [days]);
  if (!row) return null;
  return <KpiReconciliationView row={row} hu={language === "hu"} embedded={embedded} />;
}
