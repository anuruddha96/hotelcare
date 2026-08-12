import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarRange, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";
import { addDays, isWeekend, type RoomTypeRate } from "@/lib/revenueAnalytics";
import { getRevenueCurrency, moneyBase } from "@/lib/revenueCurrency";
import { logRateChanges } from "@/lib/rateAudit";
import type { DraftChange } from "@/lib/rateDrafts";
import { publishRates } from "@/lib/ratePublishing";

type Mode = "amount" | "percent" | "set" | "round";
type Rounding = "1" | "5" | "90";

const WEEKDAYS = [
  { i: 1, label: "Mo" }, { i: 2, label: "Tu" }, { i: 3, label: "We" }, { i: 4, label: "Th" },
  { i: 5, label: "Fr" }, { i: 6, label: "Sa" }, { i: 0, label: "Su" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const dowOf = (s: string) => parse(s).getUTCDay();

function roundTo(value: number, rounding: Rounding): number {
  if (rounding === "5") return Math.max(5, Math.round(value / 5) * 5);
  if (rounding === "90") return Math.max(0.9, Math.floor(value) + 0.9);
  return Math.max(1, Math.round(value));
}

/**
 * Bulk price editor — the one place to re-price a season.
 *
 * Pick a range on the calendar, keep only the weekdays you want, narrow it to
 * some room types, choose how to change the price, and see every affected
 * night before anything is saved. Drafts first; sending to Previo is a
 * separate, explicit click.
 */
export default function BulkPriceEditor({
  open, onOpenChange, hotelId, organizationSlug, rates, today, canPush = false, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hotelId: string | null;
  organizationSlug?: string | null;
  rates: RoomTypeRate[];
  today: string;
  canPush?: boolean;
  onSaved?: () => void | Promise<void>;
}) {
  const cur = getRevenueCurrency();
  const [range, setRange] = useState<DateRange | undefined>();
  const [dows, setDows] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6]));
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [occs, setOccs] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<Mode>("amount");
  const [value, setValue] = useState("2");
  const [rounding, setRounding] = useState<Rounding>("1");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRange({ from: parse(today), to: parse(addDays(today, 29)) });
    setShowAll(false);
  }, [open, today]);


  const allTypes = useMemo(() => {
    const s = new Set<string>();
    for (const r of rates) if (r.room_type_name) s.add(r.room_type_name);
    return Array.from(s).sort();
  }, [rates]);

  const allOccs = useMemo(() => {
    const s = new Set<number>();
    for (const r of rates) s.add(r.occupancy);
    return Array.from(s).sort((a, b) => a - b);
  }, [rates]);

  const from = range?.from ? iso(range.from) : today;
  const to = range?.to ? iso(range.to) : from;

  const quick = (days: number) => setRange({ from: parse(today), to: parse(addDays(today, days - 1)) });

  const changes = useMemo(() => {
    const input = Number(value);
    if (mode !== "round" && !Number.isFinite(input)) return [] as Array<DraftChange & { label: string }>;
    const floor = Number(minPrice);
    const ceil = Number(maxPrice);
    const out: Array<DraftChange & { label: string }> = [];
    for (const r of rates) {
      if (r.stay_date < from || r.stay_date > to) continue;
      if (!dows.has(dowOf(r.stay_date))) continue;
      if (types.size > 0 && !types.has(r.room_type_name ?? "")) continue;
      if (occs.size > 0 && !occs.has(r.occupancy)) continue;
      const current = Number(r.price);
      if (!Number.isFinite(current)) continue;
      let next =
        mode === "set" ? input :
        mode === "percent" ? current * (1 + input / 100) :
        mode === "amount" ? current + input : current;
      if (!Number.isFinite(next) || next <= 0) continue;
      next = roundTo(next, rounding);
      if (Number.isFinite(floor) && minPrice !== "" && next < floor) next = roundTo(floor, rounding);
      if (Number.isFinite(ceil) && maxPrice !== "" && next > ceil) next = roundTo(ceil, rounding);
      if (Math.round(next * 100) === Math.round(current * 100)) continue;
      out.push({
        stay_date: r.stay_date,
        obk_id: r.obk_id,
        room_type_name: r.room_type_name ?? "",
        occupancy: r.occupancy,
        old_price: current,
        new_price: next,
        label: `${r.room_type_name ?? "Room"} · ${r.occupancy} guest${r.occupancy === 1 ? "" : "s"}`,
      });
    }
    return out.sort((a, b) => a.stay_date.localeCompare(b.stay_date) || a.label.localeCompare(b.label));
  }, [rates, from, to, dows, types, occs, mode, value, rounding, minPrice, maxPrice]);

  const grouped = useMemo(() => {
    const map = new Map<string, Array<DraftChange & { label: string }>>();
    for (const c of changes) {
      const list = map.get(c.stay_date) ?? [];
      list.push(c);
      map.set(c.stay_date, list);
    }
    return Array.from(map.entries());
  }, [changes]);

  const avgMove = useMemo(() => {
    if (changes.length === 0) return 0;
    return changes.reduce((s, c) => s + (c.new_price - (c.old_price ?? c.new_price)), 0) / changes.length;
  }, [changes]);

  const visibleGroups = showAll ? grouped : grouped.slice(0, 5);

  const noteFor = () =>
    mode === "percent" ? `${value}%` :
    mode === "amount" ? `${value} ${cur.code}` :
    mode === "set" ? `set ${value} ${cur.code}` : "rounded";

  async function run() {
    if (!hotelId || changes.length === 0) return;
    setBusy(true);
    try {
      const result = await publishRates({
        hotelId,
        organizationSlug,
        source: "bulk",
        changes: changes.map(({ label: _label, ...c }) => c),
      });
      await logRateChanges({
        hotelId,
        organizationSlug: organizationSlug ?? null,
        source: "bulk-editor",
        action: "sent_to_previo",
        notes: noteFor(),
        changes: changes.map((c) => ({
          stay_date: c.stay_date,
          room_type_name: c.room_type_name,
          occupancy: c.occupancy,
          old_price: c.old_price,
          new_price: c.new_price,
        })),
      });

      toast.success(`${result.queued} price${result.queued === 1 ? "" : "s"} sent to Previo`);
      await onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply the bulk change");
    } finally {
      setBusy(false);
    }
  }


  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    apply(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col gap-3 overflow-hidden rounded-2xl p-4 sm:w-full sm:max-w-2xl sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-base">Bulk edit prices</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 text-sm">
          {/* --- dates --- */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Dates</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                    <CalendarRange className="h-3.5 w-3.5" />
                    {from} → {to}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="range"
                    numberOfMonths={2}
                    selected={range}
                    onSelect={setRange}
                    defaultMonth={parse(today)}
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              {[
                { label: "7 days", d: 7 }, { label: "30 days", d: 30 },
                { label: "90 days", d: 90 }, { label: "180 days", d: 180 },
              ].map((q) => (
                <Button key={q.d} size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => quick(q.d)}>
                  {q.label}
                </Button>
              ))}
            </div>
          </div>

          {/* --- weekdays --- */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Which days</Label>
            <div className="flex flex-wrap items-center gap-1">
              {WEEKDAYS.map((w) => (
                <Button
                  key={w.i}
                  size="sm"
                  variant={dows.has(w.i) ? "default" : "outline"}
                  className="h-8 w-10 px-0 text-[11px]"
                  onClick={() => toggle(dows, w.i, setDows)}
                >
                  {w.label}
                </Button>
              ))}
              <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setDows(new Set([5, 6]))}>Weekends</Button>
              <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setDows(new Set([0, 1, 2, 3, 4]))}>Weekdays</Button>
              <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setDows(new Set([0, 1, 2, 3, 4, 5, 6]))}>All</Button>
            </div>
          </div>

          {/* --- room types / occupancy --- */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Apply to {types.size === 0 ? "all room types" : `${types.size} room type${types.size === 1 ? "" : "s"}`}
            </Label>
            <div className="flex flex-wrap gap-1">
              {allTypes.map((t) => (
                <Badge
                  key={t}
                  variant={types.has(t) ? "default" : "outline"}
                  className="cursor-pointer font-normal"
                  onClick={() => toggle(types, t, setTypes)}
                >
                  {t}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1 pt-1">
              <span className="text-[11px] text-muted-foreground">Guests:</span>
              {allOccs.map((o) => (
                <Badge
                  key={o}
                  variant={occs.has(o) ? "default" : "outline"}
                  className="cursor-pointer font-normal"
                  onClick={() => toggle(occs, o, setOccs)}
                >
                  {o}
                </Badge>
              ))}
              {occs.size > 0 && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setOccs(new Set())}>
                  All
                </Button>
              )}
            </div>
          </div>

          {/* --- the change --- */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">What to do</Label>
              <div className="flex flex-wrap gap-1">
                {([["amount", "Amount"], ["percent", "Percent"], ["set", "Fixed"], ["round", "Round"]] as Array<[Mode, string]>).map(([m, label]) => (
                  <Button key={m} size="sm" variant={mode === m ? "default" : "outline"} className="h-8 px-2 text-[11px]"
                    onClick={() => setMode(m)}>{label}</Button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                {mode === "percent" ? "Percent (− lowers)" : mode === "round" ? "Not used" : `Amount in ${cur.code}`}
              </Label>
              <Input type="number" inputMode="decimal" value={value} disabled={mode === "round"}
                onChange={(e) => setValue(e.target.value)} className="h-9 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Never below</Label>
              <Input type="number" inputMode="decimal" value={minPrice} placeholder="min"
                onChange={(e) => setMinPrice(e.target.value)} className="h-9 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Never above</Label>
              <Input type="number" inputMode="decimal" value={maxPrice} placeholder="max"
                onChange={(e) => setMaxPrice(e.target.value)} className="h-9 text-xs" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Presets:</span>
            {[1, 2, 3, 8, 11, 18, 22].map((n) => (
              <Button key={`up${n}`} size="sm" variant={mode === "amount" && value === String(n) ? "default" : "outline"}
                className="h-8 px-2 text-[11px]" onClick={() => { setMode("amount"); setValue(String(n)); }}>
                +{n}
              </Button>
            ))}
            {[-2, -5].map((n) => (
              <Button key={`dn${n}`} size="sm" variant={mode === "amount" && value === String(n) ? "default" : "outline"}
                className="h-8 px-2 text-[11px]" onClick={() => { setMode("amount"); setValue(String(n)); }}>
                {n}
              </Button>
            ))}
            <span className="ml-2 text-[11px] text-muted-foreground">Rounding:</span>
            {([["1", "Whole"], ["5", "Nearest 5"], ["90", ".90"]] as Array<[Rounding, string]>).map(([r, label]) => (
              <Button key={r} size="sm" variant={rounding === r ? "secondary" : "outline"} className="h-8 px-2 text-[11px]"
                onClick={() => setRounding(r)}>{label}</Button>
            ))}
          </div>

          {/* --- preview --- */}
          <div className="rounded border">
            <div className="flex items-center justify-between border-b bg-muted/40 px-2 py-1 text-[11px]">
              <span className="font-medium">
                {changes.length} price{changes.length === 1 ? "" : "s"} across {grouped.length} day{grouped.length === 1 ? "" : "s"}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {changes.length > 0 ? `avg ${avgMove >= 0 ? "+" : "−"}${moneyBase(Math.abs(avgMove))}` : ""}
              </span>
            </div>
            <div className="max-h-56 overflow-y-auto p-2 text-[11px]">
              {changes.length === 0 ? (
                <p className="text-muted-foreground">Nothing changes with these options yet.</p>
              ) : (
                <>
                  {visibleGroups.map(([date, list]) => (
                    <div key={date} className="mb-2">
                      <p className="font-medium">{date}</p>
                      {list.map((c) => (
                        <p key={`${date}-${c.room_type_name}-${c.occupancy}`} className="tabular-nums text-muted-foreground">
                          {c.label}: {moneyBase(c.old_price ?? 0)} → <strong className="text-foreground">{moneyBase(c.new_price)}</strong>
                        </p>
                      ))}
                    </div>
                  ))}
                  {grouped.length > 5 && (
                    <button type="button" className="text-primary underline underline-offset-2"
                      onClick={() => setShowAll((v) => !v)}>
                      {showAll ? "Show less" : `Show all ${grouped.length} days`}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {changes.length > 300 && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              That is a lot of prices at once — check the preview before applying.
            </p>
          )}

        </div>

        <DialogFooter className="shrink-0 gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          {canPush && (
            <Button disabled={busy || changes.length === 0} onClick={() => void run()}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
              Publish {changes.length} price{changes.length === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}
