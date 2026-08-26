import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ArrowDownRight, ArrowUpRight, CalendarRange, Loader2, Minus, Plus, Rows3, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import {
  addDays, dateRange, formatDay, formatWeekday, isWeekend,
  type DayMetrics, type RoomTypeRate,
} from "@/lib/revenueAnalytics";
import { localizedRoomTypeName } from "@/lib/revenueThresholds";
import { getRevenueCurrency, moneyBase } from "@/lib/revenueCurrency";
import type { RevenueRoomType } from "@/hooks/useRevenueHotelData";
import type { DraftChange } from "@/lib/rateDrafts";
import { publishRates, queueNote } from "@/lib/ratePublishing";
import { logRateChanges } from "@/lib/rateAudit";
import BulkPriceEditor from "@/components/revenue/BulkPriceEditor";

const HORIZON_DAYS = 120;

interface PendingEdit {
  stay_date: string;
  obk_id: string;
  room_type_name: string;
  occupancy: number;
  old_price: number | null;
  new_price: number;
}

const keyOf = (date: string, obk: string, occ: number) => `${date}|${obk}|${occ}`;

/**
 * The phone pricing screen: pick a day on the strip, read the rooms as cards,
 * change a price with the thumb, send everything with one button.
 */
export default function MobilePricesTab({
  hotelId, organizationSlug, today, roomTypes, rates, metrics, leftByTypeDate,
  canEdit, onRatesUpdated, fullGrid,
}: {
  hotelId: string | null;
  organizationSlug: string | null;
  today: string;
  roomTypes: RevenueRoomType[];
  rates: RoomTypeRate[];
  metrics: DayMetrics[];
  leftByTypeDate: Map<string, number>;
  canEdit: boolean;
  onRatesUpdated?: () => void | Promise<void>;
  /** The full desktop grid, opened full-screen on demand. */
  fullGrid?: ReactNode;
}) {
  const { language } = useTranslation();
  const currency = getRevenueCurrency();
  const step = currency.code === "EUR" ? 1 : 100;
  const bigStep = currency.code === "EUR" ? 5 : 500;

  const [selected, setSelected] = useState(today);
  const [pending, setPending] = useState<Map<string, PendingEdit>>(new Map());
  const [optimistic, setOptimistic] = useState<Map<string, number>>(new Map());
  const [sending, setSending] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  const [occByRoom, setOccByRoom] = useState<Map<string, number>>(new Map());
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setSelected(today); }, [today]);

  const dates = useMemo(() => dateRange(today, addDays(today, HORIZON_DAYS)), [today]);
  const metricByDate = useMemo(() => {
    const m = new Map<string, DayMetrics>();
    for (const x of metrics) m.set(x.stay_date, x);
    return m;
  }, [metrics]);

  /** obk_id -> occupancy -> date -> price */
  const priceMap = useMemo(() => {
    const m = new Map<string, Map<number, Map<string, number>>>();
    for (const r of rates) {
      if (!r.obk_id) continue;
      let byOcc = m.get(r.obk_id);
      if (!byOcc) { byOcc = new Map(); m.set(r.obk_id, byOcc); }
      let byDate = byOcc.get(r.occupancy);
      if (!byDate) { byDate = new Map(); byOcc.set(r.occupancy, byDate); }
      byDate.set(r.stay_date, Number(r.price));
    }
    return m;
  }, [rates]);

  /** Lowest published price per date — the number shown on the day strip. */
  const leadByDate = useMemo(() => {
    const out = new Map<string, number>();
    for (const r of rates) {
      if (!Number.isFinite(r.price)) continue;
      const cur = out.get(r.stay_date);
      if (cur === undefined || Number(r.price) < cur) out.set(r.stay_date, Number(r.price));
    }
    return out;
  }, [rates]);

  const rooms = useMemo(() => {
    return roomTypes
      .filter((rt) => rt.is_sellable !== false && rt.pms_room_id && priceMap.has(rt.pms_room_id))
      .map((rt) => {
        const obk = rt.pms_room_id as string;
        const occupancies = Array.from(priceMap.get(obk)?.keys() ?? []).sort((a, b) => a - b);
        return {
          obk,
          rawName: rt.name,
          label: localizedRoomTypeName(rt.name, rt.name_translations, language),
          occupancies,
        };
      })
      .filter((r) => r.occupancies.length > 0);
  }, [roomTypes, priceMap, language]);

  const priceOf = useCallback((obk: string, occ: number, date: string): number | null => {
    const pend = pending.get(keyOf(date, obk, occ));
    if (pend) return pend.new_price;
    const opt = optimistic.get(keyOf(date, obk, occ));
    if (opt !== undefined) return opt;
    return priceMap.get(obk)?.get(occ)?.get(date) ?? null;
  }, [pending, optimistic, priceMap]);

  const publishedOf = useCallback(
    (obk: string, occ: number, date: string) => priceMap.get(obk)?.get(occ)?.get(date) ?? null,
    [priceMap],
  );

  const setPrice = useCallback((room: { obk: string; rawName: string }, occ: number, next: number) => {
    if (!canEdit) return;
    const value = Math.max(1, Math.round(next));
    const published = publishedOf(room.obk, occ, selected);
    setPending((prev) => {
      const map = new Map(prev);
      const k = keyOf(selected, room.obk, occ);
      if (published !== null && value === published) map.delete(k);
      else map.set(k, {
        stay_date: selected, obk_id: room.obk, room_type_name: room.rawName,
        occupancy: occ, old_price: published, new_price: value,
      });
      return map;
    });
  }, [canEdit, publishedOf, selected]);

  const pendingList = useMemo(() => Array.from(pending.values()), [pending]);

  const send = useCallback(async () => {
    if (!hotelId || pendingList.length === 0) return;
    setSending(true);
    const changes: DraftChange[] = pendingList.map((p) => ({
      stay_date: p.stay_date, obk_id: p.obk_id, room_type_name: p.room_type_name,
      occupancy: p.occupancy, old_price: p.old_price, new_price: p.new_price,
    }));
    // Show the new prices straight away; Previo confirms in the background.
    setOptimistic((prev) => {
      const map = new Map(prev);
      for (const p of pendingList) map.set(keyOf(p.stay_date, p.obk_id, p.occupancy), p.new_price);
      return map;
    });
    setPending(new Map());
    try {
      const result = await publishRates({ hotelId, organizationSlug, source: "manual", changes });
      if (result.rejected.length > 0) {
        toast.warning(
          `${result.queued} of ${changes.length} prices sent — ${result.rejected.length} could not be queued`,
          { description: result.rejected[0]?.reason?.slice(0, 160) },
        );
      } else {
        toast.success(`${changes.length} price${changes.length === 1 ? "" : "s"} on the way to Previo`, {
          description: queueNote(result) ?? undefined,
        });
      }
      void logRateChanges({
        hotelId,
        organizationSlug: organizationSlug ?? null,
        source: "cell-edit",
        action: "sent_to_previo",
        notes: "mobile price editor",
        changes: changes.map((c) => ({
          stay_date: c.stay_date, room_type_name: c.room_type_name,
          occupancy: c.occupancy, old_price: c.old_price, new_price: c.new_price,
        })),
      });
      [8000, 20000, 45000].forEach((d) => setTimeout(() => { void onRatesUpdated?.(); }, d));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the prices to Previo");
    } finally {
      setSending(false);
    }
  }, [hotelId, organizationSlug, pendingList, onRatesUpdated]);

  const selectedMetric = metricByDate.get(selected);

  return (
    <div className="space-y-3 pb-24">
      {/* Day strip */}
      <div ref={stripRef} className="-mx-3 overflow-x-auto px-3 pb-1 snap-x snap-mandatory">
        <div className="flex gap-2">
          {dates.map((d) => {
            const m = metricByDate.get(d);
            const active = d === selected;
            const lead = leadByDate.get(d) ?? null;
            const pickup = m?.netPickup ?? null;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setSelected(d)}
                className={cn(
                  "snap-start shrink-0 w-[74px] rounded-xl border px-2 py-2 text-center transition-colors",
                  active ? "border-primary bg-primary/10" : "bg-card",
                  !active && isWeekend(d) && "bg-muted/50",
                )}
              >
                <div className="text-[10px] uppercase text-muted-foreground">{formatWeekday(d)}</div>
                <div className={cn("text-sm font-semibold", active && "text-primary")}>{formatDay(d)}</div>
                <div className="mt-1 text-[11px] font-medium">{lead !== null ? moneyBase(lead) : "—"}</div>
                <div className="mt-1 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
                  <span>{m?.occupancyPct != null ? `${Math.round(m.occupancyPct)}%` : "—"}</span>
                  {pickup !== null && pickup !== 0 && (
                    pickup > 0
                      ? <ArrowUpRight className="h-3 w-3 text-primary" />
                      : <ArrowDownRight className="h-3 w-3 text-destructive" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected day summary */}
      <div className="flex items-center justify-between rounded-xl border bg-card px-3 py-2">
        <div>
          <div className="text-sm font-semibold">{formatWeekday(selected)} {formatDay(selected)}</div>
          <div className="text-[11px] text-muted-foreground">
            {selectedMetric
              ? `${Math.round(selectedMetric.occupancyPct)}% sold · ${selectedMetric.roomsLeft} left`
              : "No data yet"}
          </div>
        </div>
        {selectedMetric?.netPickup != null && selectedMetric.netPickup !== 0 && (
          <Badge variant={selectedMetric.netPickup > 0 ? "default" : "destructive"} className="text-[11px]">
            {selectedMetric.netPickup > 0 ? "+" : ""}{selectedMetric.netPickup} rooms
          </Badge>
        )}
      </div>

      {/* Room cards */}
      <div className="space-y-2">
        {rooms.length === 0 && (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
            No published prices for this property yet.
          </CardContent></Card>
        )}
        {rooms.map((room) => {
          const occ = occByRoom.get(room.obk)
            ?? (room.occupancies.includes(2) ? 2 : room.occupancies[room.occupancies.length - 1]);
          const price = priceOf(room.obk, occ, selected);
          const published = publishedOf(room.obk, occ, selected);
          const changed = pending.has(keyOf(selected, room.obk, occ));
          const left = leftByTypeDate.get(`${room.rawName}|${selected}`);
          return (
            <Card key={room.obk} className={cn(changed && "border-primary")}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{room.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {left != null ? `${left} room${left === 1 ? "" : "s"} left` : "—"}
                    </div>
                  </div>
                  {room.occupancies.length > 1 && (
                    <div className="flex shrink-0 gap-1">
                      {room.occupancies.map((o) => (
                        <button
                          key={o}
                          type="button"
                          onClick={() => setOccByRoom((prev) => new Map(prev).set(room.obk, o))}
                          className={cn(
                            "min-w-[32px] rounded-md border px-2 py-1 text-[11px]",
                            o === occ ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
                          )}
                        >
                          {o}g
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline" size="icon" className="h-12 w-12 shrink-0"
                    disabled={!canEdit || price === null}
                    onClick={() => price !== null && setPrice(room, occ, price - step)}
                    aria-label="Lower price"
                  >
                    <Minus className="h-5 w-5" />
                  </Button>
                  <div className="flex-1 text-center">
                    <Input
                      inputMode="numeric"
                      className="h-12 border-0 bg-transparent text-center text-2xl font-semibold shadow-none focus-visible:ring-0"
                      value={price ?? ""}
                      disabled={!canEdit}
                      onChange={(e) => {
                        const v = Number(e.target.value.replace(/[^\d]/g, ""));
                        if (Number.isFinite(v) && v > 0) setPrice(room, occ, v);
                      }}
                      aria-label={`Price for ${room.label}`}
                    />
                    {changed && published != null && (
                      <div className="text-[11px] text-muted-foreground">was {moneyBase(published)}</div>
                    )}
                  </div>
                  <Button
                    variant="outline" size="icon" className="h-12 w-12 shrink-0"
                    disabled={!canEdit || price === null}
                    onClick={() => price !== null && setPrice(room, occ, price + step)}
                    aria-label="Raise price"
                  >
                    <Plus className="h-5 w-5" />
                  </Button>
                </div>

                {canEdit && price !== null && (
                  <div className="flex gap-2">
                    {[-bigStep, bigStep].map((delta) => (
                      <Button
                        key={delta}
                        variant="secondary" size="sm" className="h-9 flex-1"
                        onClick={() => setPrice(room, occ, price + delta)}
                      >
                        {delta > 0 ? "+" : ""}{delta}
                      </Button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-11" onClick={() => setBulkOpen(true)} disabled={!canEdit}>
          <CalendarRange className="mr-1 h-4 w-4" />Several days
        </Button>
        {fullGrid && (
          <Button variant="outline" className="h-11" onClick={() => setGridOpen(true)}>
            <Rows3 className="mr-1 h-4 w-4" />Full grid
          </Button>
        )}
      </div>

      {/* Pending bar */}
      {pendingList.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t bg-background/95 px-3 py-2 backdrop-blur">
          <div className="flex items-center gap-2">
            <Button variant="ghost" className="h-11" onClick={() => setPending(new Map())}>Cancel</Button>
            <Button className="h-11 flex-1" onClick={() => void send()} disabled={sending}>
              {sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
              Update {pendingList.length} price{pendingList.length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}

      <BulkPriceEditor
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        hotelId={hotelId}
        organizationSlug={organizationSlug}
        rates={rates}
        today={today}
        canPush={canEdit}
        onSaved={() => { void onRatesUpdated?.(); }}
      />

      {fullGrid && (
        <Sheet open={gridOpen} onOpenChange={setGridOpen}>
          <SheetContent side="bottom" className="h-[95dvh] p-0">
            <SheetHeader className="border-b px-4 py-3">
              <SheetTitle className="text-base">Full rate calendar</SheetTitle>
            </SheetHeader>
            <div className="h-[calc(95dvh-3.5rem)] overflow-y-auto p-3">{fullGrid}</div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
