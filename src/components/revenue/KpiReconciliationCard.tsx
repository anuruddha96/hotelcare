import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "@/hooks/useTranslation";
import {
  buildMonthBreakdown,
  summariseReconciliationDays,
  type KpiReconciliationMonth,
  type MonthBreakdownRow,
  type ReconciliationDay,
} from "@/lib/kpiReconciliation";

export type { KpiReconciliationMonth, MonthBreakdownRow, ReconciliationDay };

const pct = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? "—" : `${Math.round(Number(v))}%`;

const eur = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? "—" : `€${Math.round(Number(v))}`;

const dayRange = (a: string, b: string) => `${Number(a.slice(8, 10))}–${Number(b.slice(8, 10))}`;

/**
 * Explains, in one place, why the Previo dashboard and HotelCare show different
 * occupancy for the same month, and which figure to trust.
 */
export function KpiReconciliationView({
  row,
  hu = false,
  breakdown = [],
}: {
  row: KpiReconciliationMonth;
  hu?: boolean;
  breakdown?: MonthBreakdownRow[];
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
    <Card data-testid="kpi-reconciliation">
      <CardContent className="p-4 space-y-3">
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
        {breakdown.length > 1 && (
          <div data-testid="kpi-month-breakdown" className="rounded-lg border">
            <div className="px-3 pt-2 text-[11px] font-medium text-muted-foreground">
              {hu ? "Hogyan áll össze a hónap" : "How this month adds up"}
            </div>
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-[11px] text-muted-foreground">
                  <th className="px-3 py-1 text-left font-normal">{hu ? "Időszak" : "Period"}</th>
                  <th className="px-2 py-1 text-right font-normal">{hu ? "Eladott éj" : "Nights sold"}</th>
                  <th className="px-2 py-1 text-right font-normal">{hu ? "Kihaszn." : "Occ."}</th>
                  <th className="px-3 py-1 text-right font-normal">ADR*</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((b) => (
                  <tr key={b.key} className={b.key === "month" ? "border-t font-semibold" : ""}>
                    <td className="px-3 py-1">
                      {b.key === "stayed" ? (hu ? "Már eltöltött" : "Already stayed")
                        : b.key === "books" ? (hu ? "Könyvben (jövő)" : "On the books")
                        : (hu ? "Teljes hónap" : "Whole month")}
                      <span className="ml-1 text-[11px] font-normal text-muted-foreground">{dayRange(b.firstDay, b.lastDay)}</span>
                    </td>
                    <td className="px-2 py-1 text-right">{b.sold}</td>
                    <td className="px-2 py-1 text-right">{pct(b.occupancyPct)}</td>
                    <td className="px-3 py-1 text-right">{eur(b.adrGross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 pb-2 text-[11px] text-muted-foreground">
              {hu
                ? "*Reggelivel és extrákkal. A fenti csempék csak a mai naptól mutatják a hónapot."
                : "*Incl. breakfast and extras. The tiles above show this month from today only."}
            </p>
          </div>
        )}
        {reasons.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
            {reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">
          {hu
            ? "Az ADR itt a teljes foglalási ár (reggelivel, extrákkal). A Previo irányítópult ADR-je csak a szobaár, ezért vendégenként és éjszakánként kb. 12–13 €-val alacsonyabb. A Previo havi kártyája a friss, aznap reggeli foglalásokat késve mutathatja."
            : "ADR here is the full reservation price (incl. breakfast and extras). Previo's dashboard ADR is room-only, so it reads about €12–13 lower per guest per night. Previo's month card can also lag bookings made the same morning."}
        </p>
      </CardContent>
    </Card>
  );
}

/** Loads the selected month for one hotel. Renders nothing until data exists. */
export default function KpiReconciliationCard({ hotelId, month }: { hotelId: string | null; month: string }) {
  const { language } = useTranslation();
  const [days, setDays] = useState<ReconciliationDay[]>([]);

  useEffect(() => {
    let cancelled = false;
    setDays([]);
    if (!hotelId || !/^\d{4}-\d{2}$/.test(month)) return;
    (async () => {
      // One access check and one hotel-month on the server; the function is
      // newer than the generated Supabase types.
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, string>) => Promise<{ data: ReconciliationDay[] | null; error: unknown }>;
      }).rpc("revenue_kpi_reconciliation_days", {
        p_hotel_id: hotelId,
        p_from: `${month}-01`,
        p_to: `${month}-01`,
      });
      if (!cancelled && !error && Array.isArray(data)) setDays(data);
    })();
    return () => { cancelled = true; };
  }, [hotelId, month]);

  const row = useMemo(() => summariseReconciliationDays(days), [days]);
  const breakdown = useMemo(() => buildMonthBreakdown(days), [days]);
  if (!row) return null;
  return <KpiReconciliationView row={row} breakdown={breakdown} hu={language === "hu"} />;
}
