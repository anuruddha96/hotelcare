import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { budapestToday, type RoomTypeRate } from "@/lib/revenueAnalytics";
import { buildGoalPriceChanges, calendarGoalRowScope, goalMonthRange } from "@/lib/adrGoalAdjustment";
import { beginRevenueEdit } from "@/lib/revenueEditGuard";
import { formatBookingMoney } from "@/lib/bookingInsights";
import { logRateChanges } from "@/lib/rateAudit";
import { publishRates, queueNote } from "@/lib/ratePublishing";

export interface GoalAdjustTarget {
  bookingId: string;
  label: string;
  from: string;
  to: string; // Last booked stay night; used for the default calendar period
  bookedAdr: number;
  targetAdr: number;
  goalDelta: number;
  roomTypeNames: string[];
}

/**
 * The ADR goal is a *signal* to raise the currently sellable prices, NOT a
 * command to rewrite a confirmed guest reservation. It adjusts the full
 * future calendar row for booked room types in the manager-selected period.
 */
export default function AdrGoalAdjustDialog({
  target, hotelId, organizationSlug, currencyCode, canPush, onClose, onApplied,
}: {
  target: GoalAdjustTarget | null;
  hotelId: string | null;
  organizationSlug: string | null;
  currencyCode: string | null;
  canPush: boolean;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const [rates, setRates] = useState<RoomTypeRate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  useEffect(() => {
    setAmount(target ? Math.max(1, Math.round(Math.abs(target.goalDelta))) : 0);
    setDirection(1);
    const initial = target ? goalMonthRange(target.from, target.to, budapestToday()) : { from: "", to: "" };
    setRangeFrom(initial.from);
    setRangeTo(initial.to);
    setRates(null);
    setError(null);
  }, [target]);

  useEffect(() => {
    if (!target) return;
    return beginRevenueEdit("adr-goal-room-row-adjustment");
  }, [target]);

  async function loadLiveRates(current: GoalAdjustTarget, propertyId: string, from: string, to: string) {
    const roomTypes = [...new Set(current.roomTypeNames.filter((room) => !!room.trim()))];
    if (!roomTypes.length) throw new Error("This booking has no recognized room type to edit.");
    const pageSize = 500;
    const prices: RoomTypeRate[] = [];
    // The database and PostgREST can cap results at 1,000. Never publish a
    // silently truncated calendar row: load every page or fail closed.
    for (let offset = 0; offset < 5000; offset += pageSize) {
      const { data, error: readError } = await supabase
        .from("revenue_room_type_rates")
        .select("stay_date,obk_id,room_type_name,occupancy,price,currency")
        .eq("hotel_id", propertyId)
        .gte("stay_date", from)
        .lte("stay_date", to)
        .in("room_type_name", roomTypes)
        .order("stay_date", { ascending: true })
        .order("room_type_name", { ascending: true })
        .order("occupancy", { ascending: true })
        .order("obk_id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (readError) throw readError;
      prices.push(...((data ?? []) as RoomTypeRate[]));
      if ((data ?? []).length < pageSize) return prices;
    }
    throw new Error("The selected range contains too many prices for one safe adjustment. Choose a shorter date range.");
  }

  const selectedScope = useMemo(() => calendarGoalRowScope(
    target?.roomTypeNames ?? [], rangeFrom, rangeTo,
  ), [target, rangeFrom, rangeTo]);
  const rangeValid = selectedScope.length > 0 && rangeFrom >= budapestToday();

  useEffect(() => {
    if (!target || !hotelId) return;
    let active = true;
    setRates(null);
    setError(null);
    if (!rangeValid) {
      setError("Choose future dates in a period of no more than 366 days.");
      return () => { active = false; };
    }
    setLoading(true);
    void loadLiveRates(target, hotelId, rangeFrom, rangeTo).then((list) => {
      if (active) { setRates(list); setError(null); }
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Could not load current prices.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [target, hotelId, rangeFrom, rangeTo, rangeValid]);

  const signedDelta = direction * Math.round(amount);
  const scoped = useMemo(() => buildGoalPriceChanges(
    rates ?? [], selectedScope, signedDelta, budapestToday(),
  ), [rates, selectedScope, signedDelta]);
  const changes = scoped.changes;
  const currencies = [...new Set(changes.map((c) => String(c.rate.currency ?? "").toUpperCase()).filter(Boolean))];
  const currencyMismatch = !!currencyCode && currencies.some((code) => code !== currencyCode.toUpperCase());
  const valid = !!target && !!hotelId && canPush && rangeValid && !loading && !saving && !error && rates !== null
    && !scoped.invalid && scoped.missing.length === 0 && scoped.missingTiers.length === 0
    && changes.length > 0 && !currencyMismatch;
  const averageBefore = changes.length ? changes.reduce((sum, c) => sum + c.from, 0) / changes.length : 0;
  const averageAfter = changes.length ? changes.reduce((sum, c) => sum + c.to, 0) / changes.length : 0;

  async function apply() {
    if (!valid || !target || !hotelId) return;
    setSaving(true);
    try {
      // Publishing a cached price as if it were current could undo a colleague's
      // recent manual edit. Re-read every impacted cell immediately before send.
      const latest = await loadLiveRates(target, hotelId, rangeFrom, rangeTo);
      const check = buildGoalPriceChanges(latest, selectedScope, signedDelta, budapestToday());
      const key = (c: { rate: RoomTypeRate }) =>
        `${c.rate.stay_date}|${c.rate.room_type_name}|${c.rate.occupancy}`;
      const before = new Map(changes.map((c) => [key(c), c.from]));
      const hasChanged = check.invalid || check.missing.length > 0 || check.missingTiers.length > 0 || check.changes.length !== changes.length
        || check.changes.some((c) => before.get(key(c)) !== c.from);
      if (hasChanged) {
        setRates(latest);
        toast.warning("Selling prices changed since preview. Please check the refreshed prices before publishing.");
        return;
      }

      const result = await publishRates({
        hotelId,
        organizationSlug,
        source: "pickup-board",
        changes: changes.map((c) => ({
          stay_date: c.rate.stay_date,
          obk_id: c.rate.obk_id,
          room_type_name: c.rate.room_type_name ?? "",
          occupancy: c.rate.occupancy,
          old_price: c.from,
          new_price: c.to,
        })),
      });
      const rejected = new Set(result.rejected.map((r) => `${r.stay_date}|${r.room_type_name}|${r.occupancy}`));
      const accepted = changes.filter((c) => !rejected.has(key(c)));
      await logRateChanges({
        hotelId,
        organizationSlug: organizationSlug ?? null,
        source: "pickup-board",
        action: "sent_to_previo",
        notes: `ADR goal adjustment for booking #${target.bookingId}; booked ADR ${target.bookedAdr.toFixed(2)}, goal ${target.targetAdr.toFixed(2)}, requested delta ${signedDelta > 0 ? "+" : ""}${signedDelta} across full room row ${rangeFrom} to ${rangeTo}, all guest occupancies; run ${result.runId}`,
        changes: accepted.map((c) => ({
          stay_date: c.rate.stay_date,
          room_type_name: c.rate.room_type_name ?? "",
          occupancy: c.rate.occupancy,
          old_price: c.from,
          new_price: c.to,
        })),
      });
      const note = queueNote(result);
      if (result.rejected.length > 0) {
        toast.warning(`${result.queued} prices queued; ${result.rejected.length} rejected, ${result.skippedSoldOut} sold-out skipped. ${result.rejected[0].reason}`);
      } else {
        toast.success(`${result.queued} room-row prices queued for Previo${result.skippedSoldOut ? ` · ${result.skippedSoldOut} sold-out skipped` : ""}${note ? ` · ${note}` : ""}`);
      }
      onApplied?.();
      onClose();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not submit price changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ArrowUpRight className="h-4 w-4 text-emerald-600" /> ADR goal · Adjust selling prices
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{target?.label}</p>
        </DialogHeader>
        {target && <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 rounded-lg border p-3 text-center">
            <div><p className="text-[10px] text-muted-foreground">Booked ADR</p><p className="font-semibold">{formatBookingMoney(target.bookedAdr, currencyCode)}</p></div>
            <div><p className="text-[10px] text-muted-foreground">Goal ADR</p><p className="font-semibold">{formatBookingMoney(target.targetAdr, currencyCode)}</p></div>
            <div><p className="text-[10px] text-muted-foreground">Gap / night</p><p className="font-semibold text-rose-600">−{formatBookingMoney(target.goalDelta, currencyCode)}</p></div>
          </div>
          <p className="text-xs text-muted-foreground">
            Increase or decrease the entire selling-price row for {target.roomTypeNames.join(", ")}.
            Every date in the selected period and every guest-occupancy price moves by the same amount.
            This includes unbooked dates and the checkout date when it falls inside the range.
            Confirmed guest reservation prices are never modified.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="goal-row-from" className="text-xs">Row from</Label>
              <Input id="goal-row-from" type="date" value={rangeFrom} disabled={saving}
                onChange={(e) => { setRates(null); setRangeFrom(e.target.value); }} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="goal-row-to" className="text-xs">Row to (inclusive)</Label>
              <Input id="goal-row-to" type="date" value={rangeTo} disabled={saving}
                onChange={(e) => { setRates(null); setRangeTo(e.target.value); }} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-md border">
              <Button size="sm" variant={direction > 0 ? "default" : "ghost"} className="rounded-none"
                onClick={() => setDirection(1)} disabled={saving}>Increase</Button>
              <Button size="sm" variant={direction < 0 ? "default" : "ghost"} className="rounded-none"
                onClick={() => setDirection(-1)} disabled={saving}>Decrease</Button>
            </div>
            <Label htmlFor="goal-rate-delta" className="text-xs">Amount per price</Label>
            <Input id="goal-rate-delta" type="number" min="1" max="1000000" step="1"
              value={amount || ""} disabled={saving} onChange={(e) => setAmount(Number(e.target.value))}
              className="h-9 w-24" aria-label="Rate adjustment amount" />
            <span className="text-xs text-muted-foreground">{currencyCode ?? "base currency"}</span>
          </div>
          {loading && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading latest selling prices…</p>}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          {rates !== null && !loading && <>
            {(scoped.missing.length > 0 || scoped.missingTiers.length > 0 || scoped.invalid || currencyMismatch) && (
              <p role="alert" className="flex items-start gap-2 rounded-md border border-amber-500/30 p-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {currencyMismatch ? "Price currency differs from the hotel's ADR goal currency. Adjust in the main rate calendar instead."
                  : scoped.invalid ? "An unsafe or invalid rate was found. No prices will be published."
                  : scoped.missing.length > 0 ? `Missing current prices for ${scoped.missing.length} room/date combination(s). Sync rates from Previo before trying again.`
                  : `Missing occupancy prices on ${scoped.missingTiers.length} selected room/date/guest combination(s). Sync rates before publishing the full row.`}
              </p>
            )}
            <div className="max-h-52 overflow-auto rounded-md border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr><th className="px-2 py-2">Date · Room · Guests</th><th className="px-2 py-2 text-right">Now</th><th className="px-2 py-2 text-right">Proposed</th></tr>
                </thead>
                <tbody className="divide-y">
                  {changes.slice(0, 150).map((c) => (
                    <tr key={`${c.rate.stay_date}|${c.rate.room_type_name}|${c.rate.occupancy}`}>
                      <td className="px-2 py-1.5">{c.rate.stay_date}<span className="block text-[10px] text-muted-foreground">{c.rate.room_type_name} · {c.rate.occupancy} guest(s)</span></td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatBookingMoney(c.from, currencyCode)}</td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatBookingMoney(c.to, currencyCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              {changes.length} prices across {selectedScope.length} room/date combinations
              {changes.length > 150 ? " (showing the first 150 in preview)" : ""} · average
              {" "}{formatBookingMoney(averageBefore, currencyCode)} → {formatBookingMoney(averageAfter, currencyCode)}.
              The difference is added to every existing selling price, not used to replace it with the ADR goal.
            </p>
          </>}
        </div>}
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button onClick={() => void apply()} disabled={!valid}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
            Apply to full room rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
