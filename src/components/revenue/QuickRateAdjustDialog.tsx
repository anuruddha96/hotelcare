import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logRateChanges } from "@/lib/rateAudit";
import { moneyBase, getRevenueCurrency } from "@/lib/revenueCurrency";
import type { RoomTypeRate } from "@/lib/revenueAnalytics";

const PRESETS = [2, 3, 8, 11, 22];

export interface QuickAdjustTarget {
  from: string;
  to: string;
  roomTypeName?: string | null;
  label?: string;
}

/**
 * "This date range just picked up — raise it." A tiny pricing tool opened
 * straight from a movement row: pick a preset, see what would change, save
 * drafts. Nothing reaches Previo until the usual confirmed push.
 */
export default function QuickRateAdjustDialog({
  target, hotelId, organizationSlug, rates, onClose, onApplied,
}: {
  target: QuickAdjustTarget | null;
  hotelId: string | null;
  organizationSlug: string | null;
  rates: RoomTypeRate[];
  onClose: () => void;
  onApplied?: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState<number>(2);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [onlyType, setOnlyType] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    setFrom(target.from);
    setTo(target.to);
    setAmount(2);
    setDirection(1);
    setOnlyType(!!target.roomTypeName);
  }, [target]);

  const changes = useMemo(() => {
    if (!target || !from || !to) return [];
    const delta = direction * (Number.isFinite(amount) ? amount : 0);
    if (!delta) return [];
    return rates
      .filter((r) => r.stay_date >= from && r.stay_date <= to)
      .filter((r) => !(onlyType && target.roomTypeName) || r.room_type_name === target.roomTypeName)
      .map((r) => ({ rate: r, from: r.price, to: Math.max(1, Math.round(r.price + delta)) }))
      .filter((c) => c.to !== Math.round(c.from));
  }, [rates, target, from, to, amount, direction, onlyType]);

  const preview = useMemo(() => {
    if (changes.length === 0) return null;
    const avgFrom = changes.reduce((s, c) => s + c.from, 0) / changes.length;
    const avgTo = changes.reduce((s, c) => s + c.to, 0) / changes.length;
    return { avgFrom, avgTo };
  }, [changes]);

  async function apply() {
    if (!hotelId || changes.length === 0) return;
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const rows = changes.map((c) => ({
        hotel_id: hotelId,
        organization_slug: organizationSlug ?? null,
        stay_date: c.rate.stay_date,
        obk_id: c.rate.obk_id,
        room_type_name: c.rate.room_type_name,
        occupancy: c.rate.occupancy,
        old_price: c.from,
        new_price: c.to,
        status: "draft",
        created_by: auth.user?.id ?? null,
      }));
      const { error } = await supabase.from("revenue_rate_drafts").upsert(rows, {
        onConflict: "hotel_id,stay_date,room_type_name,occupancy,status",
      });
      if (error) throw error;
      await logRateChanges({
        hotelId,
        organizationSlug: organizationSlug ?? null,
        source: "day-tool",
        action: "draft_saved",
        notes: `${direction > 0 ? "+" : "−"}${amount} ${getRevenueCurrency().code} from pickup`,
        changes: changes.map((c) => ({
          stay_date: c.rate.stay_date,
          room_type_name: c.rate.room_type_name,
          occupancy: c.rate.occupancy,
          old_price: c.from,
          new_price: c.to,
        })),
      });
      toast.success(`${rows.length} price${rows.length === 1 ? "" : "s"} saved as draft — not sent to Previo yet`);
      onApplied?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the drafts");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">
            {direction > 0 ? "Raise" : "Lower"} prices{target?.label ? ` · ${target.label}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border overflow-hidden">
              <Button size="sm" variant={direction > 0 ? "default" : "ghost"} className="h-8 rounded-none px-3 text-xs"
                onClick={() => setDirection(1)}>Increase</Button>
              <Button size="sm" variant={direction < 0 ? "default" : "ghost"} className="h-8 rounded-none px-3 text-xs"
                onClick={() => setDirection(-1)}>Decrease</Button>
            </div>
            {PRESETS.map((p) => (
              <Button key={p} size="sm" variant={amount === p ? "secondary" : "outline"} className="h-8 px-2.5 text-xs tabular-nums"
                onClick={() => setAmount(p)}>
                {direction > 0 ? "+" : "−"}{p}
              </Button>
            ))}
            <Input
              type="number" min={1} value={Number.isFinite(amount) ? amount : ""}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="h-8 w-20" aria-label="Custom amount"
            />
          </div>

          {target?.roomTypeName && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" className="h-3.5 w-3.5" checked={onlyType} onChange={(e) => setOnlyType(e.target.checked)} />
              Only {target.roomTypeName}
            </label>
          )}

          <p className="text-xs text-muted-foreground">
            {preview
              ? `${changes.length} price${changes.length === 1 ? "" : "s"}, avg ${moneyBase(preview.avgFrom)} → ${moneyBase(preview.avgTo)}`
              : "Nothing to change for this range yet."}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void apply()} disabled={saving || changes.length === 0}>
            Save {changes.length} draft{changes.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
