import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2 } from "lucide-react";
import { formatWhen, type RateAuditRow } from "@/lib/rateAudit";
import { markerOrigin } from "@/lib/rateMarkers";
import { ORIGIN_DOT_CLASS, ORIGIN_LABEL, budapestDayStartMs, type ChangeOrigin } from "@/lib/rateOrigin";
import { moneyBase } from "@/lib/revenueCurrency";

interface Row {
  origin: ChangeOrigin;
  room: string;
  occ: number;
  old: number | null;
  next: number | null;
  at: string;
  by: string | null;
  today: boolean;
}

/**
 * "What changed on this date" — every price cell that moved, not just the one
 * the user happened to open.
 *
 * The dot under a date says the day was touched, but on a phone there is no
 * hover card, so tapping a single cell was the only way to look for the change
 * — and if the automation had moved a different room type or a different guest
 * count, the drawer looked empty and the move seemed lost. This lists the whole
 * date so the automation's work is always findable.
 */
export default function DayChangesSheet({
  hotelId,
  date,
  onOpenChange,
  onEditPrices,
}: {
  hotelId?: string | null;
  date: string | null;
  onOpenChange: (open: boolean) => void;
  /** Jump straight from "what changed" to "change it" on a phone. */
  onEditPrices?: (date: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!hotelId || !date) { setRows([]); return; }
    setLoading(true);
    (async () => {
      try {
        const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
        const { data, error } = await supabase.rpc("rate_cell_history", {
          p_hotel_id: hotelId,
          p_stay_date: date,
          p_since: since,
          p_per_cell: 6,
        });
        if (error) throw error;
        const audit = (data ?? []) as unknown as RateAuditRow[];
        const dayStart = budapestDayStartMs();

        const out: Row[] = [];
        const ids = new Set<string>();
        for (const r of audit) {
          const origin = markerOrigin(r.source, (r.payload as any)?.confirmation_status);
          if (!origin) continue;
          const room = (r.payload as any)?.room_type_name as string | undefined;
          const occ = (r.payload as any)?.occupancy as number | undefined;
          if (!room || occ === undefined) continue;
          if (r.old_rate_eur === r.new_rate_eur) continue;
          if (r.performed_by) ids.add(r.performed_by);
          out.push({
            origin,
            room,
            occ,
            old: r.old_rate_eur ?? null,
            next: r.new_rate_eur ?? null,
            at: r.performed_at,
            by: r.performed_by ?? null,
            today: Date.parse(r.performed_at) >= dayStart,
          });
        }
        // One line per cell per minute: a publish writes a draft row, a push
        // row and a Previo read-back row for the same move.
        const seen = new Set<string>();
        const deduped = out
          .sort((a, b) => b.at.localeCompare(a.at))
          .filter((r) => {
            const key = `${r.room}|${r.occ}|${r.old}|${r.next}|${r.at.slice(0, 16)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

        let names = new Map<string, string>();
        if (ids.size > 0) {
          const { data: profs } = await supabase
            .from("profiles").select("id, full_name, nickname").in("id", Array.from(ids));
          names = new Map((profs ?? []).map((p: any) => [p.id, p.nickname || p.full_name]));
        }
        if (cancelled) return;
        setRows(deduped.map((r) => ({ ...r, by: r.by ? (names.get(r.by) ?? null) : null })));
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hotelId, date]);

  const todayRows = useMemo(() => rows.filter((r) => r.today), [rows]);
  const earlier = useMemo(() => rows.filter((r) => !r.today).slice(0, 40), [rows]);

  const line = (r: Row, i: number) => (
    <div key={`${r.at}-${r.room}-${r.occ}-${i}`} className="border-b py-2 last:border-0">
      <p className="tabular-nums text-sm">
        <i className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${ORIGIN_DOT_CLASS[r.origin]}`} />
        {moneyBase(r.old)} → <strong>{moneyBase(r.next)}</strong>
        {r.old != null && r.next != null && (
          <span className={r.next > r.old ? " text-emerald-600 dark:text-emerald-400" : " text-sky-600 dark:text-sky-400"}>
            {" "}{r.next > r.old ? "+" : "−"}{moneyBase(Math.abs(r.next - r.old))}
          </span>
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {r.room} · {r.occ}g · {r.by ?? ORIGIN_LABEL[r.origin]} · {formatWhen(r.at)}
      </p>
    </div>
  );

  return (
    <Sheet open={!!date} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-4">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-base">Price changes on {date}</SheetTitle>
        </SheetHeader>
        {onEditPrices && date && (
          <Button className="mb-2 w-full" onClick={() => onEditPrices(date)}>
            <Pencil className="mr-2 h-4 w-4" /> Change prices for this day
          </Button>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading the trail…
            </p>
          )}
          {!loading && rows.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground">No price change is recorded on this date.</p>
          )}
          {!loading && todayRows.length > 0 && (
            <>
              <p className="pt-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Today</p>
              {todayRows.map(line)}
            </>
          )}
          {!loading && earlier.length > 0 && (
            <>
              <p className="pt-4 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Earlier</p>
              {earlier.map(line)}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
