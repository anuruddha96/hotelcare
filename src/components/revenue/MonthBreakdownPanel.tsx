import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { money } from "@/lib/revenueCurrency";
import type { MonthBreakdownRow } from "@/lib/kpiReconciliation";

const pct = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? "—" : `${Math.round(Number(v))}%`;
const cash = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? "—" : money(Number(v));
const dayRange = (a: string, b: string) =>
  a === b ? `${Number(a.slice(8, 10))}` : `${Number(a.slice(8, 10))}–${Number(b.slice(8, 10))}`;

/**
 * How a month's occupancy and ADR are built: nights already stayed (actual)
 * plus nights on the books (future) = the whole month. ADR is shown room-only
 * when the hotel's included breakfast value is known, next to the full booking
 * value that Previo's reservation price carries.
 */
export default function MonthBreakdownPanel({
  rows,
  monthLabel,
  breakfastPrice,
  hu = false,
  canEdit = false,
  onSaveBreakfastPrice,
}: {
  rows: MonthBreakdownRow[];
  monthLabel: string;
  breakfastPrice: number | null;
  hu?: boolean;
  canEdit?: boolean;
  onSaveBreakfastPrice?: (value: number | null) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(breakfastPrice === null ? "" : String(breakfastPrice));
  useEffect(() => { setDraft(breakfastPrice === null ? "" : String(breakfastPrice)); }, [breakfastPrice]);
  if (!rows.length) return null;

  const showRoomOnly = rows.some((r) => r.adrRoomOnly !== null);
  const whole = rows.find((r) => r.key === "month") ?? (rows.length === 1 ? rows[0] : null);
  const missingLists = whole && breakfastPrice !== null && whole.breakfastNightsKnown < whole.nightsWithSales
    ? whole.nightsWithSales - whole.breakfastNightsKnown
    : 0;

  const save = async () => {
    const trimmed = draft.trim().replace(",", ".");
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (!Number.isFinite(value) || value < 0)) return;
    if (value === breakfastPrice) return;
    await onSaveBreakfastPrice?.(value);
  };

  const label = (r: MonthBreakdownRow) =>
    r.key === "stayed" ? (hu ? "Már eltöltött" : "Already stayed")
      : r.key === "books" ? (hu ? "Könyvben (jövő)" : "On the books")
      : (hu ? "Teljes hónap" : "Whole month");

  return (
    <div data-testid="month-breakdown" className="rounded-lg border">
      <div className="px-3 pt-2 text-[11px] font-medium text-muted-foreground">
        {hu ? `Hogyan áll össze: ${monthLabel}` : `How ${monthLabel} adds up`}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-[11px] text-muted-foreground">
              <th className="px-3 py-1 text-left font-normal">{hu ? "Időszak" : "Nights"}</th>
              <th className="px-2 py-1 text-right font-normal">{hu ? "Eladott" : "Sold"}</th>
              <th className="px-2 py-1 text-right font-normal">{hu ? "Kihaszn." : "Occ."}</th>
              {showRoomOnly && <th className="px-2 py-1 text-right font-normal">{hu ? "ADR szoba" : "ADR room"}</th>}
              <th className="px-3 py-1 text-right font-normal">{hu ? "ADR reggelivel" : "ADR incl. breakfast"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.key === "month" ? "border-t font-semibold" : ""}>
                <td className="px-3 py-1 whitespace-nowrap">
                  {label(r)}
                  <span className="ml-1 text-[11px] font-normal text-muted-foreground">{dayRange(r.firstDay, r.lastDay)}</span>
                </td>
                <td className="px-2 py-1 text-right">{r.sold}<span className="text-muted-foreground font-normal">/{r.capacity}</span></td>
                <td className="px-2 py-1 text-right">{pct(r.occupancyPct)}</td>
                {showRoomOnly && <td className="px-2 py-1 text-right">{cash(r.adrRoomOnly)}</td>}
                <td className="px-3 py-1 text-right">{cash(r.adrGross)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 pb-2 pt-1 space-y-1 text-[11px] text-muted-foreground">
        <p>
          {hu
            ? "Már eltöltött = a mai nap előtti éjszakák (tényleges). Könyvben = a mai naptól a hónap végéig lefoglalt éjszakák. A kettő együtt adja a teljes hónapot. Az ADR = szobabevétel ÷ áras eladott éjszakák."
            : "Already stayed = nights before today (actual). On the books = nights from today to month end that are already booked. Together they make the whole month. ADR = room revenue ÷ priced nights sold."}
        </p>
        {whole && whole.breakfasts > 0 && (
          <p>
            {hu
              ? `A foglalási ár reggelit is tartalmaz: ${whole.breakfasts} reggeli a takarítási listákon ebben a hónapban.${breakfastPrice !== null ? ` Szobaár = foglalási ár − reggelik × ${money(breakfastPrice)}.` : ""} A Previo irányítópult és a Booking.com a szobaárat mutatja.`
              : `Booking prices include breakfast: ${whole.breakfasts} breakfasts on the housekeeping lists this month.${breakfastPrice !== null ? ` Room price = booking price − breakfasts × ${money(breakfastPrice)}.` : ""} Previo's dashboard and Booking.com show the room price.`}
          </p>
        )}
        {missingLists > 0 && (
          <p>
            {hu
              ? `${missingLists} eladott éjhez nincs takarítási lista, ezért a szobaár-ADR nem számolható.`
              : `${missingLists} sold nights have no housekeeping list yet, so room-only ADR can't be worked out.`}
          </p>
        )}
        {canEdit ? (
          <label className="flex flex-wrap items-center gap-1.5">
            <span>{hu ? "Az árban lévő reggeli értéke / fő / éj:" : "Breakfast included in rates, per guest per night:"}</span>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              inputMode="decimal"
              placeholder={hu ? "pl. 12.5" : "e.g. 12.5"}
              className="h-6 w-20 text-[11px]"
              aria-label={hu ? "Reggeli értéke vendégenként és éjszakánként" : "Breakfast value per guest per night"}
            />
            {breakfastPrice === null && (
              <span>{hu ? "Add meg a szobaár-ADR megjelenítéséhez." : "Set it to show room-only ADR."}</span>
            )}
          </label>
        ) : breakfastPrice === null && whole && whole.breakfasts > 0 ? (
          <p>{hu ? "A szobaár-ADR-hez egy adminisztrátornak meg kell adnia a reggeli értékét." : "An admin can set the breakfast value to show room-only ADR."}</p>
        ) : null}
      </div>
    </div>
  );
}
