import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * One row of public.revenue_kpi_reconciliation_monthly.
 * Only the columns this card reads are typed.
 */
export interface KpiReconciliationMonth {
  hotel_id: string;
  month_start: string;
  capacity_room_nights: number | null;
  booked_nights_all: number;
  hold_nights: number;
  commercial_sold: number;
  unassigned_nights: number;
  option_nights: number;
  previo_dashboard_occupied: number;
  past_nights: number;
  housekeeping_verified_nights: number;
  housekeeping_mismatch_nights: number;
  previo_dashboard_occupancy_pct: number | null;
  hotelcare_commercial_occupancy_pct: number | null;
  best_physical_occupancy_pct: number | null;
  best_commercial_occupancy_pct: number | null;
}

const pct = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? "—" : `${Math.round(Number(v))}%`;

/**
 * Explains, in one place, why the Previo dashboard and HotelCare show different
 * occupancy for the same month, and which figure to trust.
 */
export function KpiReconciliationView({ row, hu = false }: { row: KpiReconciliationMonth; hu?: boolean }) {
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
  const [row, setRow] = useState<KpiReconciliationMonth | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRow(null);
    if (!hotelId || !/^\d{4}-\d{2}$/.test(month)) return;
    (async () => {
      // The view is newer than the generated Supabase types.
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (k: string, v: string) => {
              eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: KpiReconciliationMonth | null; error: unknown }> };
            };
          };
        };
      })
        .from("revenue_kpi_reconciliation_monthly")
        .select("*")
        .eq("hotel_id", hotelId)
        .eq("month_start", `${month}-01`)
        .maybeSingle();
      if (!cancelled && !error && data) setRow(data);
    })();
    return () => { cancelled = true; };
  }, [hotelId, month]);

  if (!row) return null;
  return <KpiReconciliationView row={row} hu={language === "hu"} />;
}
