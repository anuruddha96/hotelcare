import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDown, ArrowUp, CalendarClock, Flame, Loader2, Minus, Sparkles, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { moneyBase } from "@/lib/revenueCurrency";
import { addDays, dateRange, formatDay, formatWeekday, isWeekend, type RoomTypeRate } from "@/lib/revenueAnalytics";
import {
  DEFAULT_LADDER, DEMAND_RATING_LABEL, GROUP_PRESETS, applyPreset, suggestLadderPrice,
  type DemandRating, type GroupPreset, type LadderSettings,
} from "@/lib/demandPricing";
import { saveRateDrafts } from "@/lib/rateDrafts";

interface Night { stay_date: string; created_at_pms?: string | null; room_type_name?: string | null }

interface Props {
  hotelId: string | null;
  organizationSlug: string | null;
  today: string;
  nights: Night[];
  rates: RoomTypeRate[];
  canEdit?: boolean;
  /** Re-read drafts in the calendar after prices are staged here. */
  onDraftsChanged?: () => void;
}

interface RatingRow {
  stay_date: string; rating: DemandRating; reason: string | null;
  event_name: string | null; created_by_name: string | null;
}

const HORIZON = 14;

function ratingTone(r: DemandRating | undefined): string {
  if (r === "high") return "bg-destructive text-destructive-foreground";
  if (r === "medium") return "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-50";
  if (r === "low") return "bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-50";
  return "bg-muted text-muted-foreground";
}

/**
 * The revenue manager's action desk: grade a day's demand in words, see what
 * the pickup rules propose in money, and stage the change — all without typing
 * a price. Everything staged here lands in the same draft list as the calendar
 * and only reaches Previo on an explicit push.
 */
export default function DemandPricingPanel({
  hotelId, organizationSlug, today, nights, rates, canEdit = false, onDraftsChanged,
}: Props) {
  const [settings, setSettings] = useState<LadderSettings>(DEFAULT_LADDER);
  const [ratings, setRatings] = useState<Map<string, RatingRow>>(new Map());
  const [lastYear, setLastYear] = useState<Map<string, RatingRow>>(new Map());
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [grade, setGrade] = useState<{ date: string; rating: DemandRating; reason: string; event: string } | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [preset, setPreset] = useState<GroupPreset>(GROUP_PRESETS[0]);
  const [groupFrom, setGroupFrom] = useState(today);
  const [groupDays, setGroupDays] = useState(7);
  const [groupWeekdays, setGroupWeekdays] = useState<"all" | "weekend" | "weekday">("all");
  const [groupBusy, setGroupBusy] = useState(false);

  const dates = useMemo(() => dateRange(today, addDays(today, HORIZON - 1)), [today]);

  /** Rule settings, in the hotel's own currency. */
  useEffect(() => {
    if (!hotelId) return;
    let alive = true;
    void (async () => {
      const { data } = await supabase
        .from("hotel_revenue_settings")
        .select("min_adr, pickup_step_1_eur, pickup_step_2_eur, pickup_step_3_eur, pickup_burst_minutes, idle_decay_hours, idle_decay_eur, low_demand_decrease_eur, base_currency, eur_conversion_rate")
        .eq("hotel_id", hotelId)
        .maybeSingle();
      if (!alive || !data) return;
      const foreign = (data.base_currency ?? "EUR") !== "EUR";
      setSettings({
        ...DEFAULT_LADDER,
        minAdr: data.min_adr === null || data.min_adr === undefined ? null : Number(data.min_adr),
        step1Eur: Number(data.pickup_step_1_eur ?? DEFAULT_LADDER.step1Eur),
        step2Eur: Number(data.pickup_step_2_eur ?? DEFAULT_LADDER.step2Eur),
        step3Eur: Number(data.pickup_step_3_eur ?? DEFAULT_LADDER.step3Eur),
        burstMinutes: Number(data.pickup_burst_minutes ?? DEFAULT_LADDER.burstMinutes),
        idleDecayHours: Number(data.idle_decay_hours ?? DEFAULT_LADDER.idleDecayHours),
        idleDecayEur: Number(data.idle_decay_eur ?? DEFAULT_LADDER.idleDecayEur),
        lowDemandDecreaseEur: Number(data.low_demand_decrease_eur ?? DEFAULT_LADDER.lowDemandDecreaseEur),
        highDemandIncreaseEur: Number(data.pickup_step_1_eur ?? DEFAULT_LADDER.highDemandIncreaseEur),
        eurToBase: foreign ? Number(data.eur_conversion_rate ?? 1) || 1 : 1,
      });
    })();
    return () => { alive = false; };
  }, [hotelId]);

  /** This year's grades, plus the same window one year ago for the pattern. */
  const loadRatings = useCallback(async () => {
    if (!hotelId) return;
    const lyFrom = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
    const [{ data: now }, { data: prev }] = await Promise.all([
      supabase.from("revenue_demand_ratings")
        .select("stay_date, rating, reason, event_name, created_by_name")
        .eq("hotel_id", hotelId).gte("stay_date", dates[0]).lte("stay_date", dates[dates.length - 1]),
      supabase.from("revenue_demand_ratings")
        .select("stay_date, rating, reason, event_name, created_by_name")
        .eq("hotel_id", hotelId).gte("stay_date", lyFrom).lte("stay_date", addDays(lyFrom, HORIZON - 1)),
    ]);
    setRatings(new Map((now ?? []).map((r) => [r.stay_date, r as RatingRow])));
    setLastYear(new Map((prev ?? []).map((r) => [r.stay_date, r as RatingRow])));
  }, [hotelId, today, dates]);

  useEffect(() => { void loadRatings(); }, [loadRatings]);

  /** Booking timestamps per stay date, used for pickup bursts and idle time. */
  const bookingTimesByDate = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const n of nights) {
      if (!n.created_at_pms) continue;
      const arr = m.get(n.stay_date) ?? [];
      arr.push(n.created_at_pms);
      m.set(n.stay_date, arr);
    }
    return m;
  }, [nights]);

  /** Lowest published price per date — what the guest actually sees first. */
  const priceByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rates) {
      const p = Number(r.price);
      if (!Number.isFinite(p) || p <= 0) continue;
      const prev = m.get(r.stay_date);
      if (prev === undefined || p < prev) m.set(r.stay_date, p);
    }
    return m;
  }, [rates]);

  const now = useMemo(() => new Date(), [nights]);

  const rows = useMemo(() => dates.map((d) => {
    const result = suggestLadderPrice({
      currentPrice: priceByDate.get(d) ?? null,
      bookingTimes: bookingTimesByDate.get(d) ?? [],
      now,
      rating: ratings.get(d)?.rating ?? null,
      settings,
    });
    return { date: d, result };
  }), [dates, priceByDate, bookingTimesByDate, now, ratings, settings]);

  const movers = useMemo(() => rows.filter((r) => r.result.burstBookings > 0), [rows]);

  /** Save a demand grade. The reason feeds next year's read of this date. */
  async function saveGrade() {
    if (!grade || !hotelId) return;
    setBusyDate(grade.date);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const { data: profile } = auth.user
        ? await supabase.from("profiles").select("full_name").eq("id", auth.user.id).maybeSingle()
        : { data: null };
      const { error } = await supabase.from("revenue_demand_ratings").upsert({
        hotel_id: hotelId,
        organization_slug: organizationSlug,
        stay_date: grade.date,
        rating: grade.rating,
        reason: grade.reason.trim() || null,
        event_name: grade.event.trim() || null,
        created_by: auth.user?.id ?? null,
        created_by_name: profile?.full_name ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "hotel_id,stay_date" });
      if (error) throw error;

      // A named event is worth keeping on the hotel's event calendar too.
      if (grade.event.trim()) {
        await supabase.from("hotel_events").insert({
          hotel_id: hotelId,
          organization_slug: organizationSlug,
          event_date: grade.date,
          title: grade.event.trim(),
          category: "demand",
          impact: grade.rating === "high" ? "high" : grade.rating === "low" ? "low" : "medium",
          notes: grade.reason.trim() || null,
          created_by: auth.user?.id ?? null,
        });
      }
      await loadRatings();
      toast.success(`${formatDay(grade.date)} graded ${DEMAND_RATING_LABEL[grade.rating].toLowerCase()}`);
      setGrade(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the grade");
    } finally {
      setBusyDate(null);
    }
  }

  /** Stage the suggested move for every priced room type on that date. */
  async function stageSuggestion(date: string, target: number) {
    if (!hotelId) return;
    setBusyDate(date);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const cells = rates.filter((r) => r.stay_date === date && Number(r.price) > 0);
      if (cells.length === 0) { toast.error("No published prices for that date yet"); return; }
      const base = priceByDate.get(date) ?? null;
      const delta = base === null ? 0 : target - base;

      const rows = cells.map((c) => {
        const current = Number(c.price);
        let next = Math.round(current + delta);
        if (settings.minAdr !== null && next < settings.minAdr) next = Math.round(settings.minAdr);
        return {
          hotel_id: hotelId,
          organization_slug: organizationSlug,
          stay_date: date,
          obk_id: c.obk_id,
          room_type_name: c.room_type_name,
          occupancy: c.occupancy,
          old_price: current,
          new_price: next,
          status: "draft",
          created_by: auth.user?.id ?? null,
        };
      }).filter((r) => r.new_price > 0 && r.new_price !== r.old_price);

      if (rows.length === 0) { toast.info("Nothing to change on that date"); return; }
      await saveRateDrafts({ hotelId, organizationSlug, changes: rows });
      onDraftsChanged?.();
      toast.success(`${rows.length} price${rows.length === 1 ? "" : "s"} staged for ${formatDay(date)} — not in Previo yet`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not stage the change");
    } finally {
      setBusyDate(null);
    }
  }

  /** Bulk move: one preset across a date range and weekday filter. */
  async function applyGroup() {
    if (!hotelId) return;
    setGroupBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const span = dateRange(groupFrom, addDays(groupFrom, Math.max(1, groupDays) - 1))
        .filter((d) => groupWeekdays === "all" ? true : groupWeekdays === "weekend" ? isWeekend(d) : !isWeekend(d));
      const set = new Set(span);
      const rows = rates
        .filter((r) => set.has(r.stay_date) && Number(r.price) > 0)
        .map((r) => {
          const next = applyPreset(Number(r.price), preset, settings);
          return next === null ? null : {
            hotel_id: hotelId,
            organization_slug: organizationSlug,
            stay_date: r.stay_date,
            obk_id: r.obk_id,
            room_type_name: r.room_type_name,
            occupancy: r.occupancy,
            old_price: Number(r.price),
            new_price: next,
            status: "draft",
            created_by: auth.user?.id ?? null,
          };
        })
        .filter((r): r is NonNullable<typeof r> => !!r && r.new_price !== r.old_price);

      if (rows.length === 0) { toast.error("Nothing to change with these options"); return; }
      await saveRateDrafts({ hotelId, organizationSlug, changes: rows });
      onDraftsChanged?.();
      toast.success(`${rows.length} price${rows.length === 1 ? "" : "s"} staged across ${span.length} date${span.length === 1 ? "" : "s"}`);
      setGroupOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply the group change");
    } finally {
      setGroupBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />Demand desk
          </CardTitle>
          {canEdit && (
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setGroupOpen(true)}>
              <Sparkles className="h-3.5 w-3.5 mr-1" />Group change
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Grade each day in words — high, normal or low demand — and Hotel Care turns that into money using your own rules:
          a booking burst adds {settings.step1Eur}/{settings.step2Eur}/{settings.step3Eur} EUR equivalent,
          a quiet stretch takes off {settings.idleDecayEur} EUR every {settings.idleDecayHours}h,
          and no suggestion ever drops below your minimum rate{settings.minAdr !== null ? ` of ${moneyBase(settings.minAdr)}` : ""}.
          Your reason is stored, so next year this date reads back with the event that caused it.
        </p>
        {movers.length > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
            <Flame className="h-4 w-4 text-destructive shrink-0" />
            <span>
              <strong>{movers.length}</strong> date{movers.length === 1 ? "" : "s"} picked up in the last {settings.burstMinutes} minutes —
              act on them below before the next booking lands.
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map(({ date, result }) => {
          const rating = ratings.get(date);
          const ly = lastYear.get(`${Number(date.slice(0, 4)) - 1}${date.slice(4)}`);
          const up = result.deltaBase > 0;
          return (
            <div
              key={date}
              className={`rounded-lg border p-2.5 ${result.burstBookings > 0 ? "border-destructive/50 bg-destructive/5" : "bg-card"}`}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="w-24 shrink-0">
                  <div className="text-sm font-semibold">{formatDay(date)}</div>
                  <div className="text-[10px] text-muted-foreground">{formatWeekday(date)}</div>
                </div>

                <Badge variant="outline" className={`font-normal ${ratingTone(rating?.rating)}`}>
                  {rating ? DEMAND_RATING_LABEL[rating.rating] : "Not graded"}
                </Badge>

                <span className="text-xs text-muted-foreground">
                  {result.burstBookings > 0
                    ? `${result.burstBookings} booking${result.burstBookings === 1 ? "" : "s"} in ${settings.burstMinutes} min`
                    : result.hoursIdle === null ? "No bookings yet" : `Quiet for ${result.hoursIdle}h`}
                </span>

                <span className="text-xs tabular-nums">
                  {moneyBase(result.currentPrice)}
                  {result.suggestedPrice !== null && result.deltaBase !== 0 && (
                    <>
                      <span className="mx-1 text-muted-foreground">→</span>
                      <strong className={up ? "text-emerald-600 dark:text-emerald-400" : "text-sky-600 dark:text-sky-400"}>
                        {moneyBase(result.suggestedPrice)}
                      </strong>
                    </>
                  )}
                </span>

                <div className="ml-auto flex items-center gap-1.5">
                  {canEdit && (
                    <>
                      <div className="flex rounded-md border overflow-hidden">
                        {(["low", "medium", "high"] as DemandRating[]).map((r) => (
                          <Button
                            key={r}
                            size="sm"
                            variant={rating?.rating === r ? "default" : "ghost"}
                            className="h-7 rounded-none px-2 text-[11px]"
                            onClick={() => setGrade({
                              date, rating: r,
                              reason: rating?.reason ?? "",
                              event: rating?.event_name ?? "",
                            })}
                          >
                            {r === "low" ? <ArrowDown className="h-3 w-3" /> : r === "medium" ? <Minus className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
                            <span className="ml-1">{r === "low" ? "Low" : r === "medium" ? "Normal" : "High"}</span>
                          </Button>
                        ))}
                      </div>
                      <Button
                        size="sm"
                        className="h-7 text-[11px]"
                        disabled={result.suggestedPrice === null || result.deltaBase === 0 || busyDate === date}
                        onClick={() => result.suggestedPrice !== null && stageSuggestion(date, result.suggestedPrice)}
                      >
                        {busyDate === date ? <Loader2 className="h-3 w-3 animate-spin" /> : "Stage"}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {(result.drivers.length > 0 || rating?.reason || ly) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {result.drivers.map((d, i) => (
                    <span key={i}>
                      {d.label} <span className="tabular-nums">({d.deltaBase > 0 ? "+" : ""}{moneyBase(d.deltaBase)})</span>
                    </span>
                  ))}
                  {rating?.reason && <span className="italic">“{rating.reason}”{rating.created_by_name ? ` — ${rating.created_by_name}` : ""}</span>}
                  {ly && (
                    <span className="flex items-center gap-1">
                      <CalendarClock className="h-3 w-3" />
                      Last year: {DEMAND_RATING_LABEL[ly.rating].toLowerCase()}
                      {ly.event_name ? ` · ${ly.event_name}` : ""}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>

      {/* Grade a day ------------------------------------------------------- */}
      <Dialog open={!!grade} onOpenChange={(o) => !o && setGrade(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">
              {grade ? `${DEMAND_RATING_LABEL[grade.rating]} · ${formatDay(grade.date)}` : ""}
            </DialogTitle>
          </DialogHeader>
          {grade && (
            <div className="space-y-3 text-sm">
              <div>
                <label className="text-xs text-muted-foreground">Event or reason (optional)</label>
                <Input
                  value={grade.event}
                  placeholder="e.g. Sziget Festival, city marathon"
                  onChange={(e) => setGrade({ ...grade, event: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">What are you seeing?</label>
                <Textarea
                  rows={3}
                  value={grade.reason}
                  placeholder="Competitors sold out, three bookings in an hour, group enquiry…"
                  onChange={(e) => setGrade({ ...grade, reason: e.target.value })}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Saved against this date so next year's calendar shows what happened — and the price rules use the grade straight away.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGrade(null)}>Cancel</Button>
            <Button onClick={saveGrade} disabled={!!busyDate}>
              {busyDate ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Save grade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Group change ------------------------------------------------------ */}
      <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Group change</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="grid gap-2">
              {GROUP_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p)}
                  className={`rounded-md border p-2 text-left transition-colors ${preset.id === p.id ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
                >
                  <div className="text-xs font-medium">{p.label}</div>
                  <div className="text-[11px] text-muted-foreground">{p.description}</div>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">From</label>
                <Input type="date" value={groupFrom} onChange={(e) => setGroupFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Number of days</label>
                <Input
                  type="number" min={1} max={180} value={groupDays}
                  onChange={(e) => setGroupDays(Number(e.target.value) || 1)}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Which days</label>
              <Select value={groupWeekdays} onValueChange={(v) => setGroupWeekdays(v as typeof groupWeekdays)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every day</SelectItem>
                  <SelectItem value="weekend">Weekends only</SelectItem>
                  <SelectItem value="weekday">Weekdays only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Applies to every room type and guest count on the selected dates, saved as drafts.
              {settings.minAdr !== null && ` No price goes below your minimum rate of ${moneyBase(settings.minAdr)}.`}
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGroupOpen(false)}>Cancel</Button>
            <Button onClick={applyGroup} disabled={groupBusy}>
              {groupBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Stage changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
