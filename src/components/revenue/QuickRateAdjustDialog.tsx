import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { logRateChanges } from "@/lib/rateAudit";
import { moneyBase, getRevenueCurrency } from "@/lib/revenueCurrency";
import { pushRateDrafts, saveRateDrafts } from "@/lib/rateDrafts";
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
 * straight from a movement row: pick a preset, see what would change, then
 * either keep it as a draft or send it to Previo right away.
 */
export default function QuickRateAdjustDialog({
  target, hotelId, organizationSlug, rates, canPush = false, onClose, onApplied,
}: {
  target: QuickAdjustTarget | null;
  hotelId: string | null;
  organizationSlug: string | null;
  rates: RoomTypeRate[];
  canPush?: boolean;
  onClose: () => void;
  onApplied?: (summary?: string) => void;
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

  async function apply(push: boolean) {
    if (!hotelId || changes.length === 0) return;
    setSaving(true);
    try {
      const ids = await saveRateDrafts({
        hotelId,
        organizationSlug,
        changes: changes.map((c) => ({
          stay_date: c.rate.stay_date,
          obk_id: c.rate.obk_id,
          room_type_name: c.rate.room_type_name ?? "",
          occupancy: c.rate.occupancy,
          old_price: c.from,
          new_price: c.to,
        })),
      });
      await logRateChanges({
        hotelId,
        organizationSlug: organizationSlug ?? null,
        source: "pickup-board",
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

      const verb = direction > 0 ? "Raised" : "Lowered";
      if (!push) {
        toast.success(`${ids.length} price${ids.length === 1 ? "" : "s"} saved as draft — not sent to Previo yet`);
        onApplied?.(`${verb} ${ids.length} price${ids.length === 1 ? "" : "s"} · draft`);
      } else {
        const res = await pushRateDrafts(hotelId, ids);
        if (res.failed) {
          toast.error(`${res.pushed} sent, ${res.failed} failed — open the price list to see why`);
          onApplied?.(`${verb} ${res.pushed} · ${res.failed} failed`);
        } else {
          toast.success(`${res.pushed} price${res.pushed === 1 ? "" : "s"} sent to Previo`);
          onApplied?.(`${verb} ${res.pushed} price${res.pushed === 1 ? "" : "s"} · sent`);
        }
      }
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

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void apply(false)} disabled={saving || changes.length === 0}>
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Save {changes.length} draft{changes.length === 1 ? "" : "s"}
            </Button>
            {canPush && (
              <Button onClick={() => void apply(true)} disabled={saving || changes.length === 0}>
                <Send className="mr-1 h-3.5 w-3.5" />
                Send to Previo now
              </Button>
            )}
          </div>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}
