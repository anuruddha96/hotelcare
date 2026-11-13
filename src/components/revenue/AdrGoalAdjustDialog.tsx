import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { budapestToday, type RoomTypeRate } from "@/lib/revenueAnalytics";
import { buildGoalPriceChanges, type GoalPriceScope } from "@/lib/adrGoalAdjustment";
import { beginRevenueEdit } from "@/lib/revenueEditGuard";
import { formatBookingMoney } from "@/lib/bookingInsights";
import { logRateChanges } from "@/lib/rateAudit";
import { publishRates, queueNote } from "@/lib/ratePublishing";

export interface GoalAdjustTarget {
  bookingId: string;
  label: string;
  from: string;
  to: string; // Last affected stay night, not checkout
  bookedAdr: number;
  targetAdr: number;
  goalDelta: number;
  allowedCells: GoalPriceScope[];
}

/**
 * The ADR goal is a *signal* to raise the currently sellable prices, NOT a
 * command to rewrite a confirmed guest reservation. Scope is immutable and is
 * derived from the actual Previo movement nights, including discontinuities.
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

  useEffect(() => {
    setAmount(target ? Math.max(1, Math.round(Math.abs(target.goalDelta))) : 0);
    setDirection(1);
    setRates(null);
    setError(null);
  }, [target]);

  useEffect(() => {
    if (!target) return;
    return beginRevenueEdit("adr-goal-booking-adjustment");
  }, [target]);

  async function loadLiveRates(current: GoalAdjustTarget, propertyId: string) {
    const roomTypes = [...new Set(current.allowedCells.map((c) => c.roomTypeName))];
    if (!roomTypes.length) throw new Error("This booking has no recognized room type to edit.");
    const { data, error: readError } = await supabase
      .from("revenue_room_type_rates")
      .select("stay_date,obk_id,room_type_name,occupancy,price,currency")
      .eq("hotel_id", propertyId)
      .gte("stay_date", current.from)
      .lte("stay_date", current.to)
      .in("room_type_name", roomTypes)
      .limit(4000);
    if (readError) throw readError;
    return (data ?? []) as RoomTypeRate[];
  }

  useEffect(() => {
    if (!target || !hotelId) return;
    let active = true;
    setLoading(true);
    void loadLiveRates(target, hotelId).then((list) => {
      if (active) { setRates(list); setError(null); }
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Could not load current prices.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [target, hotelId]);

  const signedDelta = direction * Math.round(amount);
  const scoped = useMemo(() => buildGoalPriceChanges(
    rates ?? [], target?.allowedCells ?? [], signedDelta, budapestToday(),
  ), [rates, target, signedDelta]);
  const changes = scoped.changes;
  const currencies = [...new Set(changes.map((c) => String(c.rate.currency ?? "").toUpperCase()).filter(Boolean))];
  const currencyMismatch = !!currencyCode && currencies.some((code) => code !== currencyCode.toUpperCase());
  const valid = !!target && !!hotelId && canPush && !loading && !saving && !error && rates !== null
    && !scoped.invalid && scoped.missing.length === 0 && changes.length > 0 && !currencyMismatch;
  const averageBefore = changes.length ? changes.reduce((sum, c) => sum + c.from, 0) / changes.length : 0;
  const averageAfter = changes.length ? changes.reduce((sum, c) => sum + c.to, 0) / changes.length : 0;

  async function apply() {
    if (!valid || !target || !hotelId) return;
    setSaving(true);
    try {
      // Publishing a cached price as if it were current could undo a colleague's
      // recent manual edit. Re-read every impacted cell immediately before send.
      const latest = await loadLiveRates(target, hotelId);
      const check = buildGoalPriceChanges(latest, target.allowedCells, signedDelta, budapestToday());
      const key = (c: { rate: RoomTypeRate }) =>
        `${c.rate.stay_date}|${c.rate.room_type_name}|${c.rate.occupancy}`;
      const before = new Map(changes.map((c) => [key(c), c.from]));
      const hasChanged = check.invalid || check.missing.length > 0 || check.changes.length !== changes.length
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
        notes: `ADR goal adjustment for booking #${target.bookingId}; booked ADR ${target.bookedAdr.toFixed(2)}, goal ${target.targetAdr.toFixed(2)}, requested delta ${signedDelta > 0 ? "+" : ""}${signedDelta} per room/date/occupancy; run ${result.runId}`,
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
        toast.warning(`${result.queued} prices queued; ${result.rejected.length} rejected. ${result.rejected[0].reason}`);
      } else {
        toast.success(`${result.queued} prices queued for Previo${note ? ` · ${note}` : ""}`);
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
            Only the room types and actual booked nights below will change. Checkout and other dates are excluded.
            Confirmed guest reservation prices are never modified.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-md border">
              <Button size="sm" variant={direction > 0 ? "default" : "ghost"} className="rounded-none"
                onClick={() => setDirection(1)}>Increase</Button>
              <Button size="sm" variant={direction < 0 ? "default" : "ghost"} className="rounded-none"
                onClick={() => setDirection(-1)}>Decrease</Button>
            </div>
            <Label htmlFor="goal-rate-delta" className="text-xs">Amount per price</Label>
            <Input id="goal-rate-delta" type="number" min="1" max="1000000" step="1"
              value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))}
              className="h-9 w-24" aria-label="Rate adjustment amount" />
            <span className="text-xs text-muted-foreground">{currencyCode ?? "base currency"}</span>
          </div>
          {loading && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading latest selling prices…</p>}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          {rates !== null && !loading && <>
            {(scoped.missing.length > 0 || scoped.invalid || currencyMismatch) && (
              <p role="alert" className="flex items-start gap-2 rounded-md border border-amber-500/30 p-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {currencyMismatch ? "Price currency differs from the hotel's ADR goal currency. Adjust in the main rate calendar instead."
                  : scoped.invalid ? "An unsafe or invalid rate was found. No prices will be published."
                  : `Missing current prices for ${scoped.missing.length} booked room/date combination(s). Sync rates from Previo before trying again.`}
              </p>
            )}
            <div className="max-h-52 overflow-auto rounded-md border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr><th className="px-2 py-2">Date · Room · Guests</th><th className="px-2 py-2 text-right">Now</th><th className="px-2 py-2 text-right">Proposed</th></tr>
                </thead>
                <tbody className="divide-y">
                  {changes.map((c) => (
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
              {changes.length} price cells · average {formatBookingMoney(averageBefore, currencyCode)} → {formatBookingMoney(averageAfter, currencyCode)}.
              This adds the difference to existing selling prices; it does not set every night to the ADR goal.
            </p>
          </>}
        </div>}
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button onClick={() => void apply()} disabled={!valid}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
            Apply to booked nights
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
