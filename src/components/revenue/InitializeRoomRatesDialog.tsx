import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { publishRates, queueNote } from "@/lib/ratePublishing";
import { inferredGuestCapacity, initialRateDates, validateFirstRateLadder } from "@/lib/revenue/initialRoomRates";
import type { RevenueRoomType } from "@/hooks/useRevenueHotelData";
import { toast } from "sonner";

interface Props {
  room: RevenueRoomType | null;
  hotelId: string | null;
  organizationSlug: string | null;
  today: string;
  onClose: () => void;
  onPublished?: () => void;
}

export default function InitializeRoomRatesDialog({ room, hotelId, organizationSlug, today, onClose, onPublished }: Props) {
  const [guests, setGuests] = useState(2);
  const [prices, setPrices] = useState<string[]>(["", ""]);
  const [days, setDays] = useState(7);
  const [start, setStart] = useState(today);
  const [saving, setSaving] = useState(false);
  const [currency, setCurrency] = useState<{ code: string; minimumStep: number } | null>(null);

  useEffect(() => {
    if (!room) return;
    const count = Math.min(6, Math.max(1, inferredGuestCapacity(room.name, room.guest_levels)));
    setGuests(count);
    setPrices(Array(count).fill(""));
    setDays(7);
    setStart(today);
  }, [room, today]);

  useEffect(() => {
    setCurrency(null);
    if (!room || !hotelId) return;
    let active = true;
    void (async () => {
      const { data, error } = await (supabase as any).from("hotel_revenue_settings")
        .select("base_currency,eur_conversion_rate")
        .eq("hotel_id", hotelId).maybeSingle();
      if (!active) return;
      if (error || !data) {
        toast.error("Unable to load this hotel's pricing currency");
        return;
      }
      const code = String(data.base_currency ?? "EUR").toUpperCase();
      const fx = Number(data.eur_conversion_rate);
      if (code !== "EUR" && (!Number.isFinite(fx) || fx <= 0)) {
        toast.error(`No valid EUR-to-${code} rate is configured for the €1 minimum guest increment`);
        return;
      }
      setCurrency({ code, minimumStep: code === "EUR" ? 1 : Math.max(1, Math.round(fx)) });
    })();
    return () => { active = false; };
  }, [hotelId, room]);

  async function submit() {
    if (!room?.pms_room_id || !hotelId || saving) return;
    if (!currency) { toast.error("The hotel's currency settings are not ready"); return; }
    const ladder = validateFirstRateLadder(prices, guests, currency.minimumStep);
    const dates = initialRateDates(start, days);
    if (!ladder || dates.length !== days || start < today) {
      toast.error(`Enter positive whole-${currency.code} prices, increasing by at least ${currency.minimumStep} ${currency.code} per additional guest, and choose a future date.`);
      return;
    }
    setSaving(true);
    try {
      // A new kind has no original price to edit. Don't substitute a sibling
      // kind's Previo ID or rate plan; an EXACT mapping is required.
      const { data: mappings, error: mappingError } = await (supabase as any)
        .from("previo_rate_plan_mapping")
        .select("previo_rate_plan_id,previo_room_type_id")
        .eq("hotel_id", hotelId)
        .eq("previo_room_type_id", room.pms_room_id)
        .limit(1);
      if (mappingError) throw new Error(mappingError.message);
      if (!mappings?.some((m: any) => m.previo_rate_plan_id && m.previo_room_type_id === room.pms_room_id)) {
        throw new Error("The new room type needs an exact Previo rate-plan mapping. First use Refresh room types or Pricing Strategy → Rooms Setup to configure its correct Alap rate-plan ID.");
      }

      // Stop if a newer PMS sync already found published rates on any selected
      // day: first-time initialization must never overwrite live PMS pricing.
      const { count, error: rateError } = await (supabase as any)
        .from("revenue_room_type_rates")
        .select("id", { count: "exact", head: true })
        .eq("hotel_id", hotelId).eq("obk_id", room.pms_room_id)
        .gte("stay_date", dates[0]).lte("stay_date", dates[dates.length - 1]);
      if (rateError) throw new Error(rateError.message);
      if ((count ?? 0) > 0) {
        throw new Error("Previo rates already exist on some selected dates. Use the normal Rate Grid editor to avoid replacing them.");
      }

      const changes = dates.flatMap((stay_date) => ladder.map((new_price, index) => ({
        stay_date, obk_id: room.pms_room_id, room_type_name: room.name,
        occupancy: index + 1, old_price: null, new_price,
      })));
      const result = await publishRates({
        hotelId, organizationSlug, source: "manual", changes,
      });
      if (result.rejected.length || result.queued !== changes.length) {
        toast.warning(`${result.queued} of ${changes.length} first prices queued; review the remaining errors.`, {
          description: result.rejected[0]?.reason,
        });
      } else {
        toast.success(`${changes.length} new guest-rate cells queued for Previo. Confirm them after syncing.`);
      }
      const note = queueNote(result);
      if (note) toast.info(note);
      onPublished?.();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to initialize new Previo rates");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!room} onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-md">
        <DialogHeader><DialogTitle>Set first Previo prices</DialogTitle></DialogHeader>
        {room && (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              {room.name} · {room.num_rooms} physical rooms. No rates have been received for this type.
            </p>
            <div className="space-y-1">
              <label className="text-xs font-medium">Guest occupancy levels</label>
              <Select value={String(guests)} onValueChange={(value) => {
                const n = Number(value);
                setGuests(n);
                setPrices((old) => Array.from({ length: n }, (_, i) => old[i] ?? ""));
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{[1,2,3,4,5,6].map((n) => <SelectItem key={n} value={String(n)}>{n} guest{n > 1 ? "s" : ""}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Match the maximum capacity configured in Previo (2+1 means three guests).</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {prices.map((value, index) => (
                <label key={index} className="space-y-1 text-xs">
                  <span>{index + 1} guest{index > 0 ? "s" : ""} · {currency?.code ?? "…"}</span>
                  <Input type="number" min={1} step={1} inputMode="numeric" value={value}
                    onChange={(event) => setPrices((old) => old.map((v, i) => i === index ? event.target.value : v))}
                    placeholder="Enter price" />
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs"><span>Start date</span>
                <Input type="date" min={today} value={start} onChange={(event) => setStart(event.target.value)} />
              </label>
              <label className="space-y-1 text-xs"><span>Apply for</span>
                <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{[1,7,14,30].map((n) => <SelectItem key={n} value={String(n)}>{n} day{n === 1 ? "" : "s"}</SelectItem>)}</SelectContent>
                </Select>
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Each additional guest must cost at least {currency ? `${currency.minimumStep} ${currency.code}` : "the EUR-equivalent of €1"} more. Staff-entered prices are not subject to the automated €10 supplement. Only your entered rates will be queued. Room availability and occupancy are not changed. Previo must accept and confirm the rate plan before these rooms can be priced.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving || !currency || !validateFirstRateLadder(prices, guests, currency.minimumStep) || start < today}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Publish first prices
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
