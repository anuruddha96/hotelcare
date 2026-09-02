import { createClient } from "npm:@supabase/supabase-js@2";
import { createOpenAI } from "npm:@ai-sdk/openai@4";
import { streamText } from "npm:ai@7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const PREMIUM_MODEL = Deno.env.get("OPENAI_PREMIUM_MODEL") || "gpt-5.6-terra";
const HOTEL_TZ = "Europe/Budapest";

type Scope = "revenue" | "housekeeping" | "maintenance" | "reception";
type PaceStats = {
  day: string;
  booking_units: number;
  room_nights: number;
  room_revenue_eur: number;
  cancellations: number;
  net_booking_units: number;
  avg_booking_value_eur: number | null;
  avg_room_nights_per_booking: number | null;
  avg_room_revenue_per_night_eur: number | null;
  lead_time_mix: Record<string, number>;
  affected_stay_dates: string[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function extractText(message: any): string {
  return (message?.parts ?? [])
    .filter((p: any) => p?.type === "text")
    .map((p: any) => String(p.text ?? ""))
    .join("")
    .trim();
}

function isComplexQuestion(question: string): boolean {
  const q = question.toLowerCase();
  const hotelTopic = /\b(sales?|sold|bookings?|booked|pickup|pace|revenue|adr|revpar|occupancy|rates?|prices?|pricing|demand|automation|housekeep|cleaning|rooms?|maintenance|tickets?|repair|arrival|departure|check.?in|check.?out|breakfast|reservation|operations?)\b/.test(q);
  const problemSolving = /\b(why|what can (?:i|we)|what should (?:i|we)|should (?:i|we)|how can (?:i|we)|recommend|recommendation|strategy|analyse|analyze|analysis|investigate|root cause|problem|issue|complaint|wrong|low|weak|not much|underperform|declin|drop|improv|optim|fix|explain|compare|reason|plan|action)\b/.test(q);
  return (hotelTopic && problemSolving) || (question.length >= 320 && hotelTopic);
}

function requestedScope(question: string): Scope | null {
  const q = question.toLowerCase();
  if (/\b(sales?|sold|bookings?|booked|pickup|pace|revenue|adr|revpar|occupancy|rates?|prices?|pricing|demand|automation|min.?stay)\b/.test(q)) return "revenue";
  if (/\b(housekeep|cleaning|dirty room|inspected room|room assignment|linen|towel)\b/.test(q)) return "housekeeping";
  if (/\b(maintenance|ticket|repair|broken|sla|overdue issue)\b/.test(q)) return "maintenance";
  if (/\b(arrival|departure|check.?in|check.?out|breakfast|reservation|front office|reception)\b/.test(q)) return "reception";
  return null;
}

function allowedScopes(role: string) {
  if (["admin", "manager", "top_management", "top_management_manager"].includes(role)) {
    return new Set<Scope>(["revenue", "housekeeping", "maintenance", "reception"]);
  }
  if (["housekeeping", "housekeeping_manager", "supervisor"].includes(role)) return new Set<Scope>(["housekeeping"]);
  if (["maintenance", "maintenance_manager"].includes(role)) return new Set<Scope>(["maintenance"]);
  if (["reception", "reception_manager", "front_office", "breakfast_staff"].includes(role)) return new Set<Scope>(["reception"]);
  if (role === "back_office_manager") return new Set<Scope>(["housekeeping", "maintenance", "reception"]);
  return new Set<Scope>();
}

function budapestParts(value: string | Date = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: HOTEL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function budapestDay(value: string | Date = new Date()) {
  return budapestParts(value).day;
}

function addDays(day: string, amount: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function pctVs(current: number | null, baseline: number | null) {
  if (current === null || baseline === null || baseline === 0) return null;
  return round2(((current - baseline) / Math.abs(baseline)) * 100);
}

function classifyRatio(current: number | null, baseline: number | null) {
  if (current === null || baseline === null || baseline <= 0) return "insufficient_baseline";
  const ratio = current / baseline;
  if (ratio <= 0.65) return "materially_below";
  if (ratio < 0.9) return "slightly_below";
  if (ratio <= 1.1) return "around_baseline";
  return "above_baseline";
}

function manualStream(text: string, metadata: Record<string, unknown>) {
  const messageId = crypto.randomUUID();
  const id = "answer";
  const body =
    `data: ${JSON.stringify({ type: "start", messageId, messageMetadata: metadata })}\n\n` +
    `data: ${JSON.stringify({ type: "text-start", id })}\n\n` +
    `data: ${JSON.stringify({ type: "text-delta", id, delta: text })}\n\n` +
    `data: ${JSON.stringify({ type: "text-end", id })}\n\n` +
    `data: ${JSON.stringify({ type: "finish", finishReason: "stop", messageMetadata: metadata })}\n\n` +
    "data: [DONE]\n\n";
  return new Response(body, {
    headers: { ...CORS, "Content-Type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
  });
}

function normalizeHotel(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bhotel\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function selectedHotels(question: string, page: any, hotels: any[]) {
  const q = question.toLowerCase();
  const named = hotels.filter((h) => {
    const id = String(h.hotel_id ?? "").toLowerCase();
    const name = String(h.hotel_name ?? "").toLowerCase();
    return (id && q.includes(id)) || (name && q.includes(name));
  });
  if (named.length) return named.slice(0, 5);

  const hints = [
    page?.entityType === "hotel" ? page?.entityId : null,
    page?.hotelId,
    typeof page?.route === "string" ? page.route.match(/\/revenue\/([^/?#]+)/)?.[1] : null,
  ].filter(Boolean);

  for (const hint of hints) {
    const needle = normalizeHotel(hint);
    if (!needle) continue;
    const match = hotels.find((h) =>
      normalizeHotel(h.hotel_id) === needle || normalizeHotel(h.hotel_name) === needle,
    );
    if (match) return [match];
  }

  return hotels.slice(0, 5);
}

function paceStatsForDay(nights: any[], cancellations: any[], day: string, cutoffMinutes: number): PaceStats {
  const units = new Map<string, { revenue: number; nights: number; firstStay: string | null }>();
  const stayDates = new Set<string>();

  for (const n of nights) {
    if (!n?.created_at_pms) continue;
    const created = budapestParts(n.created_at_pms);
    if (created.day !== day || created.minutes > cutoffMinutes) continue;
    const key = `${n?.res_id ?? ""}|${n?.room_key ?? ""}`;
    const unit = units.get(key) ?? { revenue: 0, nights: 0, firstStay: null };
    const stayDate = n?.stay_date ? String(n.stay_date) : null;
    unit.revenue += Number(n?.nightly_price_eur ?? 0);
    unit.nights += 1;
    if (stayDate && (!unit.firstStay || stayDate < unit.firstStay)) unit.firstStay = stayDate;
    units.set(key, unit);
    if (stayDate) stayDates.add(stayDate);
  }

  const cancelledUnits = new Set<string>();
  for (const c of cancellations) {
    if (!c?.cancelled_at) continue;
    const cancelled = budapestParts(c.cancelled_at);
    if (cancelled.day !== day || cancelled.minutes > cutoffMinutes) continue;
    cancelledUnits.add(`${c?.res_id ?? ""}|${c?.room_key ?? ""}`);
  }

  const bookingUnits = units.size;
  const roomNights = [...units.values()].reduce((sum, unit) => sum + unit.nights, 0);
  const revenue = [...units.values()].reduce((sum, unit) => sum + unit.revenue, 0);
  const leadTimeMix = { same_day: 0, days_1_3: 0, days_4_7: 0, days_8_30: 0, days_31_plus: 0 };

  for (const unit of units.values()) {
    if (!unit.firstStay) continue;
    const lead = daysBetween(day, unit.firstStay);
    if (lead === null || lead <= 0) leadTimeMix.same_day += 1;
    else if (lead <= 3) leadTimeMix.days_1_3 += 1;
    else if (lead <= 7) leadTimeMix.days_4_7 += 1;
    else if (lead <= 30) leadTimeMix.days_8_30 += 1;
    else leadTimeMix.days_31_plus += 1;
  }

  return {
    day,
    booking_units: bookingUnits,
    room_nights: roomNights,
    room_revenue_eur: round2(revenue),
    cancellations: cancelledUnits.size,
    net_booking_units: bookingUnits - cancelledUnits.size,
    avg_booking_value_eur: bookingUnits ? round2(revenue / bookingUnits) : null,
    avg_room_nights_per_booking: bookingUnits ? round2(roomNights / bookingUnits) : null,
    avg_room_revenue_per_night_eur: roomNights ? round2(revenue / roomNights) : null,
    lead_time_mix: leadTimeMix,
    affected_stay_dates: [...stayDates].sort().slice(0, 30),
  };
}

function summarizeBaseline(days: PaceStats[], label: string) {
  const activeDays = days.filter((d) => d.booking_units > 0 || d.cancellations > 0).length;
  const totalBookings = days.reduce((s, d) => s + d.booking_units, 0);
  const totalRoomNights = days.reduce((s, d) => s + d.room_nights, 0);
  const totalRevenue = days.reduce((s, d) => s + d.room_revenue_eur, 0);
  const avgNet = days.length ? days.reduce((s, d) => s + d.net_booking_units, 0) / days.length : 0;
  const avgRevenue = days.length ? totalRevenue / days.length : 0;
  const medNet = median(days.map((d) => d.net_booking_units));
  const medRevenue = median(days.map((d) => d.room_revenue_eur));
  const weightedBookingValue = totalBookings ? totalRevenue / totalBookings : null;
  const weightedLos = totalBookings ? totalRoomNights / totalBookings : null;
  const weightedNightValue = totalRoomNights ? totalRevenue / totalRoomNights : null;

  return {
    label,
    days: days.length,
    active_days: activeDays,
    average_net_booking_units: round2(avgNet),
    median_net_booking_units: medNet === null ? null : round2(medNet),
    average_room_revenue_eur: round2(avgRevenue),
    median_room_revenue_eur: medRevenue === null ? null : round2(medRevenue),
    weighted_avg_booking_value_eur: weightedBookingValue === null ? null : round2(weightedBookingValue),
    weighted_avg_room_nights_per_booking: weightedLos === null ? null : round2(weightedLos),
    weighted_avg_revenue_per_room_night_eur: weightedNightValue === null ? null : round2(weightedNightValue),
  };
}

function bookingPaceSummary(payload: any, today: string) {
  const nights = Array.isArray(payload?.nights) ? payload.nights : [];
  const cancellations = Array.isArray(payload?.cancellations) ? payload.cancellations : [];
  const cutoffMinutes = budapestParts().minutes;
  const statsFor = (day: string) => paceStatsForDay(nights, cancellations, day, cutoffMinutes);

  const current = statsFor(today);
  const yesterday = statsFor(addDays(today, -1));
  const trailing7 = Array.from({ length: 7 }, (_, i) => statsFor(addDays(today, -(i + 1))));
  const sameWeekday4 = Array.from({ length: 4 }, (_, i) => statsFor(addDays(today, -7 * (i + 1))));
  const trailing28 = Array.from({ length: 28 }, (_, i) => statsFor(addDays(today, -(i + 1))));
  const recent = summarizeBaseline(trailing7, "previous_7_days_same_time");
  const sameWeekday = summarizeBaseline(sameWeekday4, "previous_4_same_weekdays_same_time");
  const longer = summarizeBaseline(trailing28, "previous_28_days_same_time");

  const preferred = sameWeekday.active_days >= 2 && sameWeekday.average_net_booking_units > 0
    ? sameWeekday
    : recent.active_days >= 2 && recent.average_net_booking_units > 0
      ? recent
      : longer.active_days >= 4 && longer.average_net_booking_units > 0
        ? longer
        : null;

  let revenueReference = preferred?.average_room_revenue_eur ?? null;
  let revenueReferenceMethod = preferred ? "average" : null;
  if (
    preferred &&
    preferred.median_room_revenue_eur !== null &&
    preferred.median_room_revenue_eur > 0 &&
    preferred.average_room_revenue_eur > preferred.median_room_revenue_eur * 1.6
  ) {
    revenueReference = preferred.median_room_revenue_eur;
    revenueReferenceMethod = "median_due_to_high_value_outliers";
  }

  const volumeAssessment = classifyRatio(current.net_booking_units, preferred?.average_net_booking_units ?? null);
  const revenueAssessment = classifyRatio(current.room_revenue_eur, revenueReference);
  const valueAssessment = classifyRatio(current.avg_booking_value_eur, preferred?.weighted_avg_booking_value_eur ?? null);
  const losAssessment = classifyRatio(current.avg_room_nights_per_booking, preferred?.weighted_avg_room_nights_per_booking ?? null);

  let commercialDiagnosis = "insufficient_comparable_history";
  if (volumeAssessment === "materially_below" || volumeAssessment === "slightly_below") {
    commercialDiagnosis = revenueAssessment === "materially_below" || revenueAssessment === "slightly_below"
      ? "genuinely_weak_booking_volume_and_value"
      : "fewer_bookings_but_value_is_holding";
  } else if (volumeAssessment === "around_baseline" || volumeAssessment === "above_baseline") {
    commercialDiagnosis = revenueAssessment === "materially_below" || revenueAssessment === "slightly_below"
      ? "booking_volume_is_healthy_but_booking_value_or_length_of_stay_is_weaker"
      : "booking_volume_and_commercial_value_are_healthy";
  }

  return {
    available: true,
    comparison_basis: `booking creation activity up to the same Budapest-local clock time (${String(Math.floor(cutoffMinutes / 60)).padStart(2, "0")}:${String(cutoffMinutes % 60).padStart(2, "0")})`,
    today_so_far: current,
    yesterday_same_time: yesterday,
    baselines: {
      preferred: preferred?.label ?? null,
      previous_7_days_same_time: recent,
      previous_4_same_weekdays_same_time: sameWeekday,
      previous_28_days_same_time: longer,
    },
    volume_vs_preferred_pct: pctVs(current.net_booking_units, preferred?.average_net_booking_units ?? null),
    revenue_vs_preferred_pct: pctVs(current.room_revenue_eur, revenueReference),
    avg_booking_value_vs_preferred_pct: pctVs(current.avg_booking_value_eur, preferred?.weighted_avg_booking_value_eur ?? null),
    avg_los_vs_preferred_pct: pctVs(current.avg_room_nights_per_booking, preferred?.weighted_avg_room_nights_per_booking ?? null),
    volume_assessment: volumeAssessment,
    revenue_assessment: revenueAssessment,
    booking_value_assessment: valueAssessment,
    length_of_stay_assessment: losAssessment,
    revenue_reference_method: revenueReferenceMethod,
    revenue_reference_eur: revenueReference,
    commercial_diagnosis: commercialDiagnosis,
  };
}

function latestSnapshotForDate(snapshots: any[], stayDate: string) {
  return snapshots
    .filter((s: any) => String(s?.stay_date ?? "") === stayDate)
    .sort((a: any, b: any) => {
      const at = Date.parse(String(a?.captured_at ?? `${a?.captured_date ?? ""}T23:59:59Z`));
      const bt = Date.parse(String(b?.captured_at ?? `${b?.captured_date ?? ""}T23:59:59Z`));
      return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
    })[0] ?? null;
}

function revenueSummary(payload: any, today: string, syncCompletedAt: string | null) {
  const nights = Array.isArray(payload?.nights) ? payload.nights : [];
  const cancellations = Array.isArray(payload?.cancellations) ? payload.cancellations : [];
  const snapshots = Array.isArray(payload?.snapshots) ? payload.snapshots : [];
  const roomTypes = Array.isArray(payload?.roomTypes) ? payload.roomTypes : [];
  const rates = Array.isArray(payload?.rates) ? payload.rates : [];
  const settings = payload?.settings ?? {};
  const inventoryFromTypes = roomTypes
    .filter((r: any) => r?.is_sellable !== false && r?.counts_toward_inventory !== false)
    .reduce((sum: number, r: any) => sum + Number(r?.num_rooms ?? 0), 0);
  const snapshotRooms = Number(latestSnapshotForDate(snapshots, today)?.rooms_available ?? snapshots[0]?.rooms_available ?? 0);
  const roomsAvailable = Number(settings?.sellable_rooms ?? 0) ||
    (snapshotRooms > 0 && inventoryFromTypes > snapshotRooms * 1.2 ? snapshotRooms : inventoryFromTypes) ||
    snapshotRooms;

  const byStay = new Map<string, { sold: number; revenue: number; priced: number }>();
  for (const n of nights) {
    const date = String(n?.stay_date ?? "");
    if (!date) continue;
    const row = byStay.get(date) ?? { sold: 0, revenue: 0, priced: 0 };
    row.sold += 1;
    row.revenue += Number(n?.nightly_price_eur ?? 0);
    if (Number(n?.nightly_price_eur ?? 0) > 0) row.priced += 1;
    byStay.set(date, row);
  }

  const todayStay = byStay.get(today) ?? { sold: 0, revenue: 0, priced: 0 };
  const todaySnapshot = latestSnapshotForDate(snapshots, today);
  const pace = bookingPaceSummary(payload, today);
  const todayCreated = pace.today_so_far;
  const next14 = Array.from({ length: 15 }, (_, i) => {
    const date = addDays(today, i);
    const row = byStay.get(date) ?? { sold: 0, revenue: 0, priced: 0 };
    return {
      stay_date: date,
      rooms_sold: row.sold,
      rooms_available: roomsAvailable,
      rooms_left: Math.max(0, roomsAvailable - row.sold),
      occupancy_pct: roomsAvailable ? Math.round((row.sold / roomsAvailable) * 1000) / 10 : null,
      revenue_eur: round2(row.revenue),
      adr_eur: row.priced ? round2(row.revenue / row.priced) : null,
    };
  });
  const weakDates = [...next14]
    .filter((d) => d.occupancy_pct !== null && d.stay_date > today)
    .sort((a, b) => Number(a.occupancy_pct) - Number(b.occupancy_pct))
    .slice(0, 6);
  const nextRates = rates
    .filter((r: any) => r?.stay_date >= today && r?.stay_date <= addDays(today, 7))
    .slice(0, 160)
    .map((r: any) => ({
      stay_date: r.stay_date,
      room_type: r.room_type_name,
      occupancy: r.occupancy,
      price: r.price,
      currency: r.currency ?? "EUR",
    }));

  const parsedSync = syncCompletedAt ? Date.parse(syncCompletedAt) : NaN;
  const syncAgeMinutes = Number.isFinite(parsedSync) ? Math.max(0, Math.round((Date.now() - parsedSync) / 60000)) : null;
  const snapshotSold = todaySnapshot ? Number(todaySnapshot.rooms_sold ?? 0) : null;
  const liveSold = todayStay.sold;
  const sourceDiff = snapshotSold === null ? null : liveSold - snapshotSold;

  return {
    data_quality: {
      dataset_last_synced_at: syncCompletedAt,
      sync_age_minutes: syncAgeMinutes,
      confidence: syncAgeMinutes !== null && syncAgeMinutes <= 180 ? "current" : "stale_or_unknown",
      stay_date_crosscheck: {
        current_booking_nights_rooms_sold: liveSold,
        latest_stored_snapshot_rooms_sold: snapshotSold,
        difference_rooms: sourceDiff,
        note: sourceDiff === null
          ? "No stored snapshot was available for this stay date."
          : sourceDiff === 0
            ? "Current booking-night view and stored snapshot agree."
            : "Current booking-night view and stored snapshot differ; flag the mismatch before treating occupancy as fully verified.",
      },
    },
    today_stay_date: {
      available: roomsAvailable > 0,
      rooms_sold: liveSold,
      rooms_available: roomsAvailable,
      rooms_left: Math.max(0, roomsAvailable - liveSold),
      occupancy_pct: roomsAvailable ? Math.round((liveSold / roomsAvailable) * 1000) / 10 : null,
      room_revenue_eur: round2(todayStay.revenue),
      adr_eur: todayStay.priced ? round2(todayStay.revenue / todayStay.priced) : null,
      source: "same current booking-night dataset used by HotelCare revenue calendar",
    },
    sales_created_today: {
      available: true,
      booking_units: todayCreated.booking_units,
      room_nights: todayCreated.room_nights,
      new_room_revenue_eur: todayCreated.room_revenue_eur,
      cancellations: todayCreated.cancellations,
      net_booking_units: todayCreated.net_booking_units,
      avg_booking_value_eur: todayCreated.avg_booking_value_eur,
      avg_room_nights_per_booking: todayCreated.avg_room_nights_per_booking,
      avg_room_revenue_per_night_eur: todayCreated.avg_room_revenue_per_night_eur,
      lead_time_mix: todayCreated.lead_time_mix,
      affected_future_stay_dates: todayCreated.affected_stay_dates,
    },
    booking_pace_same_time: pace,
    next_14_days: next14,
    weak_next_14_days: weakDates,
    current_rates_next_7_days: nextRates,
  };
}

function competitorPosition(rows: any[], competitors: any[], revenueRows: any[], today: string) {
  const primaryHotel = revenueRows.length === 1 ? String(revenueRows[0].hotel_id) : null;
  const scopedRows = primaryHotel ? rows.filter((r: any) => String(r.hotel_id) === primaryHotel) : rows;
  const scopedCompetitors = primaryHotel ? competitors.filter((c: any) => String(c.hotel_id) === primaryHotel) : competitors;
  const byDate = new Map<string, number[]>();

  for (const row of scopedRows) {
    const stayDate = String(row?.stay_date ?? "");
    if (!stayDate || stayDate < today || stayDate > addDays(today, 7)) continue;
    const rate = Number(row?.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const list = byDate.get(stayDate) ?? [];
    list.push(rate);
    byDate.set(stayDate, list);
  }

  const ours = new Map<string, number>();
  for (const hotel of revenueRows) {
    for (const rate of hotel.current_rates_next_7_days ?? []) {
      const value = Number(rate?.price);
      if (!Number.isFinite(value) || value <= 0) continue;
      const key = String(rate.stay_date);
      const prev = ours.get(key);
      if (prev === undefined || value < prev) ours.set(key, value);
    }
  }

  const dates = [...byDate.keys()].sort().slice(0, 7).map((date) => {
    const set = byDate.get(date) ?? [];
    const avg = set.length ? set.reduce((a, b) => a + b, 0) / set.length : null;
    const our = ours.get(date) ?? null;
    return {
      stay_date: date,
      competitor_count: set.length,
      competitor_average_rate: avg === null ? null : round2(avg),
      competitor_median_rate: set.length ? round2(median(set) ?? 0) : null,
      competitor_min_rate: set.length ? round2(Math.min(...set)) : null,
      competitor_max_rate: set.length ? round2(Math.max(...set)) : null,
      our_lowest_rate: our,
      our_vs_competitor_average_pct: avg && our ? round2(((our - avg) / avg) * 100) : null,
    };
  });

  const latestScan = scopedCompetitors.map((c: any) => c?.last_scan_at).filter(Boolean).sort().at(-1) ?? null;
  const latestScanMs = latestScan ? Date.parse(latestScan) : NaN;
  const ageHours = Number.isFinite(latestScanMs) ? round2(Math.max(0, (Date.now() - latestScanMs) / 3_600_000)) : null;

  return {
    available: scopedCompetitors.length > 0 && scopedRows.length > 0,
    usable_for_pricing: scopedCompetitors.length > 0 && scopedRows.length > 0 && ageHours !== null && ageHours <= 48,
    watched_properties: scopedCompetitors.length,
    latest_scan_at: latestScan,
    latest_scan_age_hours: ageHours,
    freshness: ageHours === null ? "unknown" : ageHours <= 48 ? "fresh" : "stale",
    next_7_days: dates,
  };
}

function dateHasHighImpactEvent(events: any[], date: string) {
  return events.some((event) => {
    const start = String(event?.event_date ?? "");
    const end = String(event?.end_date ?? start);
    const impact = String(event?.expected_impact ?? "").toLowerCase();
    return start && date >= start && date <= end && /(high|major|very high|strong)/.test(impact);
  });
}

function buildPricingSignals(revenueRows: any[], competitor: any, rules: any[], events: any[], today: string) {
  if (revenueRows.length !== 1) return [];
  const hotel = revenueRows[0];
  const rule = rules.find((r: any) => String(r.hotel_id) === String(hotel.hotel_id)) ?? null;
  const floor = Number(rule?.minimum_adr ?? 0) || 0;
  const compByDate = new Map((competitor?.next_7_days ?? []).map((d: any) => [String(d.stay_date), d]));
  const ownRate = new Map<string, number>();
  for (const rate of hotel.current_rates_next_7_days ?? []) {
    const value = Number(rate?.price);
    if (!Number.isFinite(value) || value <= 0) continue;
    const date = String(rate.stay_date);
    const previous = ownRate.get(date);
    if (previous === undefined || value < previous) ownRate.set(date, value);
  }

  return (hotel.next_14_days ?? [])
    .filter((d: any) => d.stay_date > today && d.stay_date <= addDays(today, 7))
    .map((d: any) => {
      const comp: any = compByDate.get(String(d.stay_date));
      const ours = ownRate.get(String(d.stay_date)) ?? null;
      const compAvg = competitor?.usable_for_pricing ? Number(comp?.competitor_average_rate ?? 0) || null : null;
      const premiumPct = compAvg && ours ? round2(((ours - compAvg) / compAvg) * 100) : null;
      const highImpactEvent = dateHasHighImpactEvent(events, String(d.stay_date));
      const occupancy = Number(d.occupancy_pct ?? 0);
      const roomsLeft = Number(d.rooms_left ?? 0);
      let stance = "hold_and_watch";
      let targetBand: [number, number] | null = null;
      let reason = "No strong price signal either way.";

      if (roomsLeft <= 3 || occupancy >= 85) {
        stance = "protect_rate_or_raise_if_pickup_continues";
        reason = "Inventory is scarce; avoid discounting remaining rooms.";
      } else if (highImpactEvent && occupancy < 65) {
        stance = "protect_event_value_but_watch_pickup";
        reason = "A high-impact event supports value protection even though occupancy still has room to grow.";
      } else if (occupancy <= 55 && compAvg && ours && premiumPct !== null && premiumPct > 5) {
        const low = Math.max(floor, Math.round(compAvg * 1.01));
        const high = Math.max(low, Math.round(compAvg * 1.04));
        targetBand = [low, high];
        stance = "consider_controlled_rate_step_down";
        reason = "Occupancy is weak while the entry rate carries a material premium to the fresh competitor set.";
      } else if (occupancy <= 55 && compAvg && ours && premiumPct !== null && premiumPct <= 3) {
        stance = "do_not_chase_price_focus_on_visibility_and_conversion";
        reason = "Occupancy is weak but price is already competitive, so a further cut is not the first lever.";
      } else if (occupancy <= 55) {
        stance = "watch_pickup_before_price_move";
        reason = "Occupancy is weak, but there is not enough fresh market-price evidence for a confident cut.";
      }

      return {
        stay_date: d.stay_date,
        occupancy_pct: d.occupancy_pct,
        rooms_left: d.rooms_left,
        our_lowest_rate: ours,
        competitor_average_rate: compAvg,
        our_vs_competitor_average_pct: premiumPct,
        high_impact_event: highImpactEvent,
        stance,
        controlled_target_band_eur: targetBand,
        reason,
      };
    })
    .sort((a: any, b: any) => Number(a.occupancy_pct ?? 100) - Number(b.occupancy_pct ?? 100));
}

async function buildContext(db: any, profile: any, hotels: any[], question: string, page: any, scope: Scope | null) {
  const today = budapestDay();
  const picked = selectedHotels(question, page, hotels);
  const context: any = {
    now: {
      timezone: HOTEL_TZ,
      today,
      local_datetime: new Intl.DateTimeFormat("en-GB", {
        timeZone: HOTEL_TZ,
        dateStyle: "full",
        timeStyle: "long",
      }).format(new Date()),
    },
    properties: picked.map((h) => ({ id: h.hotel_id, name: h.hotel_name })),
    scope,
    page_target: {
      route: page?.route ?? null,
      route_hotel_id: page?.entityType === "hotel" ? page?.entityId ?? null : null,
      page_hotel_id: page?.hotelId ?? null,
    },
  };

  if (scope === "revenue") {
    const ids = picked.map((h) => h.hotel_id);
    if (!ids.length) {
      context.revenue = [];
      context.context_readiness = {
        selected_property_count: 0,
        revenue_data_available: false,
        reason: "No authorized hotel could be resolved for this page.",
      };
      return context;
    }

    const [published, rules, actions, events, competitorProps, competitorRates] = await Promise.all([
      db.from("revenue_published_payloads").select("hotel_id,sync_completed_at,payload").in("hotel_id", ids).limit(10),
      db.from("revenue_pickup_automation_rules").select("hotel_id,is_enabled,auto_publish,minimum_adr,maximum_increase,no_pickup_enabled,no_pickup_decrease,low_occupancy_pct,high_occupancy_pct,last_run_at,last_run_status,last_error,updated_at").eq("organization_slug", profile.organization_slug).in("hotel_id", ids).limit(20),
      db.from("revenue_pickup_automation_actions").select("hotel_id,stay_date,room_type_name,old_price,new_price,decision_type,decision_reason,reason_detail,net_pickup,status,push_error,created_at").eq("organization_slug", profile.organization_slug).in("hotel_id", ids).order("created_at", { ascending: false }).limit(100),
      db.from("demand_events").select("hotel_id,title,category,event_date,end_date,expected_impact,surcharge_eur,confidence,approved").eq("organization_slug", profile.organization_slug).in("hotel_id", ids).gte("event_date", today).lte("event_date", addDays(today, 60)).order("event_date").limit(100),
      db.from("competitor_properties").select("id,hotel_id,name,active,last_scan_at,last_scan_status,last_scan_prices").in("hotel_id", ids).eq("active", true).limit(100),
      db.from("competitor_rates").select("hotel_id,competitor_id,stay_date,rate,currency,confidence").in("hotel_id", ids).gte("stay_date", today).lte("stay_date", addDays(today, 7)).order("stay_date").limit(1000),
    ]);

    const publishedRows = [...(published.data ?? [])];
    const loadedIds = new Set(publishedRows.map((row: any) => String(row.hotel_id)));
    for (const hotel of picked) {
      if (loadedIds.has(String(hotel.hotel_id))) continue;
      const fallback = await db
        .from("revenue_published_payloads")
        .select("hotel_id,sync_completed_at,payload")
        .eq("hotel_id", hotel.hotel_id)
        .maybeSingle();
      if (!fallback.error && fallback.data?.payload) {
        publishedRows.push(fallback.data);
        loadedIds.add(String(hotel.hotel_id));
      }
    }

    context.revenue = publishedRows.map((row: any) => ({
      hotel_id: row.hotel_id,
      hotel_name: picked.find((h) => h.hotel_id === row.hotel_id)?.hotel_name ?? row.hotel_id,
      ...revenueSummary(row.payload, today, row.sync_completed_at ?? null),
    }));
    context.automation_rules = rules.data ?? [];
    context.recent_automation_activity = actions.data ?? [];
    context.demand_events = events.data ?? [];
    context.competitor_position = competitorPosition(
      competitorRates.data ?? [],
      competitorProps.data ?? [],
      context.revenue,
      today,
    );
    context.pricing_signals = buildPricingSignals(
      context.revenue,
      context.competitor_position,
      context.automation_rules,
      context.demand_events,
      today,
    );

    const primary = context.revenue.length === 1 ? context.revenue[0] : null;
    context.context_readiness = {
      selected_property_count: picked.length,
      selected_property_ids: ids,
      revenue_rows_loaded: context.revenue.length,
      revenue_data_available: context.revenue.length > 0,
      primary_property_resolved: primary?.hotel_id ?? null,
      same_time_pace_available: Boolean(primary?.booking_pace_same_time?.available),
      booking_mix_available: Boolean(primary?.sales_created_today?.avg_booking_value_eur !== undefined),
      today_stay_metrics_available: Boolean(primary?.today_stay_date?.available),
      today_sales_available: Boolean(primary?.sales_created_today?.available),
      rate_change_history_available: (context.recent_automation_activity?.length ?? 0) > 0,
      demand_context_available: (context.demand_events?.length ?? 0) > 0,
      competitor_context_available: Boolean(context.competitor_position?.available),
      competitor_context_fresh: Boolean(context.competitor_position?.usable_for_pricing),
      pricing_signals_available: (context.pricing_signals?.length ?? 0) > 0,
      query_errors: [
        published.error?.message,
        rules.error?.message,
        actions.error?.message,
        events.error?.message,
        competitorProps.error?.message,
        competitorRates.error?.message,
      ].filter(Boolean),
    };
  }

  if (scope === "housekeeping") {
    const keys = [...new Set(picked.flatMap((h) => [h.hotel_id, h.hotel_name]).filter(Boolean))];
    const { data: rooms } = await db
      .from("rooms")
      .select("id,room_number,hotel,status,is_checkout_room,is_dnd,towel_change_required,linen_change_required,pms_metadata")
      .eq("organization_slug", profile.organization_slug)
      .in("hotel", keys)
      .limit(1000);
    const roomIds = (rooms ?? []).map((r: any) => r.id);
    const { data: assignments } = roomIds.length
      ? await db.from("room_assignments")
        .select("room_id,assigned_to,status,assignment_type,started_at,completed_at,ready_to_clean,supervisor_approved")
        .eq("organization_slug", profile.organization_slug)
        .in("room_id", roomIds)
        .eq("assignment_date", today)
        .limit(1000)
      : { data: [] };
    context.housekeeping = { rooms: rooms ?? [], assignments: assignments ?? [] };
  }

  if (scope === "maintenance") {
    const keys = [...new Set(picked.flatMap((h) => [h.hotel_id, h.hotel_name]).filter(Boolean))];
    const { data } = await db.from("tickets")
      .select("ticket_number,title,status,priority,room_number,hotel,sla_due_date,created_at,on_hold,hold_reason")
      .eq("organization_slug", profile.organization_slug)
      .in("hotel", keys)
      .neq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(120);
    context.maintenance = data ?? [];
  }

  if (scope === "reception") {
    const ids = picked.map((h) => h.hotel_id);
    const { data } = await db.from("daily_overview_snapshots")
      .select("hotel_id,business_date,room_label,room_number,arrival_date,departure_date,status,pax,breakfast")
      .eq("organization_slug", profile.organization_slug)
      .in("hotel_id", ids)
      .or(`arrival_date.eq.${today},departure_date.eq.${today},business_date.eq.${today}`)
      .limit(1500);
    context.reception = data ?? [];
  }

  return context;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!supabaseUrl || !serviceKey || !openAiKey) return json({ error: "Assistant configuration is incomplete" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const token = authHeader.slice(7).trim();
  const { data: authData, error: authError } = await db.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "Invalid session" }, 401);

  const body = await req.json().catch(() => null);
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const latest = [...messages].reverse().find((m: any) => m?.role === "user");
  const question = extractText(latest);
  const threadId = typeof body?.thread_id === "string" ? body.thread_id : "";
  if (!question || !threadId) return json({ error: "A valid thread and question are required" }, 400);

  if (!isComplexQuestion(question)) {
    const upstream = await fetch(`${supabaseUrl}/functions/v1/assistant-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    const headers = new Headers(upstream.headers);
    Object.entries(CORS).forEach(([key, value]) => headers.set(key, value));
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  const [{ data: profile }, { data: thread }] = await Promise.all([
    db.from("profiles").select("id,role,assigned_hotel,organization_slug,preferred_language").eq("id", authData.user.id).is("deleted_at", null).maybeSingle(),
    db.from("assistant_threads").select("id,user_id,organization_slug").eq("id", threadId).eq("user_id", authData.user.id).maybeSingle(),
  ]);
  if (!profile) return json({ error: "Profile not found" }, 403);
  if (!thread) return json({ error: "Conversation not found" }, 404);

  const scope = requestedScope(question);
  const scopes = allowedScopes(String(profile.role ?? ""));
  if (scope && !scopes.has(scope)) {
    return manualStream(`I can’t access ${scope} information with your current role.`, { needsScope: scope });
  }

  const { data: org } = profile.organization_slug
    ? await db.from("organizations").select("id").eq("slug", profile.organization_slug).maybeSingle()
    : { data: null };
  let hotels: any[] = [];
  if (org?.id && ["admin", "manager", "top_management", "top_management_manager"].includes(String(profile.role))) {
    const { data } = await db.from("hotel_configurations")
      .select("hotel_id,hotel_name")
      .eq("organization_id", org.id)
      .eq("is_active", true)
      .order("hotel_name");
    hotels = data ?? [];
  }
  if (!hotels.length && profile.assigned_hotel) {
    hotels = [{ hotel_id: profile.assigned_hotel, hotel_name: profile.assigned_hotel }];
  }

  const { data: reservation, error: reserveError } = await db.rpc("reserve_assistant_premium_question", {
    _user_id: authData.user.id,
    _organization_slug: profile.organization_slug,
    _thread_id: threadId,
    _model: PREMIUM_MODEL,
  });
  if (reserveError) return json({ error: `Could not reserve deep-analysis capacity: ${reserveError.message}` }, 500);

  if (!reservation?.allowed) {
    const answer = "This needs a deeper analysis. You’ve used today’s 5 included deep-analysis questions. Add credits to continue — purchased credits stay in your account until you use them.";
    await db.from("assistant_messages").insert([
      { thread_id: threadId, user_id: authData.user.id, role: "user", content: question, refused: false },
      { thread_id: threadId, user_id: authData.user.id, role: "assistant", content: answer, refused: false },
    ]);
    await db.from("assistant_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId).eq("user_id", authData.user.id);
    return manualStream(answer, {
      premiumRequired: true,
      premiumUsage: reservation,
      premiumPackages: [
        { id: "premium_5", credits: 5, amount_eur: 5 },
        { id: "premium_10", credits: 10, amount_eur: 10 },
      ],
    });
  }

  const usageId = String(reservation.usage_id);
  let finalized = false;
  const finalize = async (success: boolean) => {
    if (finalized) return;
    finalized = true;
    const { error } = await db.rpc("finalize_assistant_premium_question", { _usage_id: usageId, _success: success });
    if (error) console.error("premium finalize failed", error);
  };

  try {
    const page = body?.page && typeof body.page === "object" ? body.page : null;
    const context = await buildContext(db, profile, hotels, question, page, scope);
    const { data: stored } = await db.from("assistant_messages")
      .select("role,content,created_at")
      .eq("thread_id", threadId)
      .eq("user_id", authData.user.id)
      .order("created_at", { ascending: true })
      .limit(30);
    const history = (stored ?? []).slice(-12).map((row: any) => ({
      role: row.role === "assistant" ? "assistant" : "user",
      content: String(row.content ?? "").slice(0, 5000),
    }));

    const { error: userSaveError } = await db.from("assistant_messages").insert({
      thread_id: threadId,
      user_id: authData.user.id,
      role: "user",
      content: question,
      refused: false,
    });
    if (userSaveError) {
      await finalize(false);
      return json({ error: "Could not save your question" }, 500);
    }

    const openai = createOpenAI({ apiKey: openAiKey });
    const result = streamText({
      model: openai.responses(PREMIUM_MODEL),
      system: `You are HotelCare Deep Analysis, the higher-intelligence problem-solving tier inside HotelCare.app. A deep-analysis allowance is being used, so the answer must feel like an experienced hotel revenue manager investigated the problem, not like a generic chatbot.

CURRENT HOTELCARE CONTEXT is authoritative for this turn and OVERRIDES earlier assistant messages. If an earlier answer claimed data was unavailable but current context contains it, ignore the old claim.

Use Europe/Budapest time exactly. For revenue language:
- “sales today”, “sold today”, “bookings today” normally means reservations/booking units CREATED today.
- “sold for today”, “occupancy today” means rooms sold for today’s STAY date.
- Never replace exact same-day sales with a rolling 48-hour pickup number.

For revenue questions, reason through FOUR commercial layers before answering:
1. BOOKING VOLUME — Is net booking count actually weak versus the preferred same-time baseline? Prefer the previous 4 same weekdays when available; use 7-day or 28-day baselines only as fallback.
2. BOOKING VALUE / MIX — If count and revenue disagree, explain whether average booking value, average room nights per booking, room-night value, cancellations, or lead-time mix explains the feeling of weak sales. Five bookings can be healthy volume but weak commercial value if they are short, low-value stays.
3. STAY-DATE URGENCY — Separate today's booking activity from tonight's occupancy. Identify at most two upcoming dates that genuinely need attention.
4. PRICE POSITION — Use fresh competitor data, occupancy, rooms left, demand events and automation behavior together. Never conclude “price is too high” from one signal alone.

Baseline quality rules:
- booking_pace_same_time.baselines.preferred tells you the preferred comparison set.
- If revenue_reference_method is median_due_to_high_value_outliers, compare today's revenue mainly with the median-based reference, not the distorted average.
- Do not present a 7-day average as decisive if same-weekday history exists.
- State clearly when booking VOLUME is healthy but VALUE/MIX is weak. That distinction is often the real diagnosis.

Mandatory context-use rules:
- Read context_readiness first.
- If same_time_pace_available is true, quote today's net bookings and the preferred same-time baseline; do not say the comparison is unavailable.
- If booking_mix_available is true and revenue differs materially from volume, quote average booking value and/or average room nights per booking versus baseline.
- If today_stay_metrics_available is true, use rooms sold/left, occupancy and ADR when relevant.
- If competitor_context_fresh is true, use competitor_position when discussing pricing. If competitor data is stale, do not base a price move on it.
- pricing_signals are deterministic safety hints. Use them as guardrails, not as orders.
- Do not list missing inputs as generic disclaimers unless the missing input prevents the conclusion.

Action quality rules:
- Every recommended action must be tied to a specific observed signal or threshold.
- Do not give generic advice such as “check again later” or “watch pickup” without saying WHAT would trigger a change.
- If a date is sold out or has <=3 rooms left, protect ADR; do not recommend discounting.
- If occupancy is <=55%, fresh competitor data shows our entry rate >5% above the set, and there is no high-impact event, a controlled step-down can be considered. Prefer a small move toward the supplied controlled target band rather than matching the cheapest competitor.
- If occupancy is weak but our rate is already within about 3% of the fresh competitor average, price is not the first lever; focus on conversion/visibility/channel availability rather than another cut.
- If a high-impact event exists, preserve event value unless pickup evidence clearly contradicts it.
- Never invent an OTA promotion, distribution problem, competitor, event, or rate that is not in context.

Response style for a manager on mobile:
- Start with **My read:** and give the commercial diagnosis in 1-2 sentences.
- Then **What the numbers say:** with 3-5 compact bullets. Show volume, value/mix, and only the most relevant stay-date/market facts.
- Then **Best action now:** with 2-4 numbered actions, each specific and prioritized.
- Add **Avoid:** only when there is a concrete bad move to warn against.
- Aim for 220-380 words unless the user asks for a full analysis. Be decisive, not verbose.

Never expose table names, database fields, internal ids, tools, model names, quotas, or implementation details. Never claim you changed a rate, room, ticket or setting unless a separate confirmed action tool actually did so.`,
      messages: [
        ...history,
        {
          role: "user",
          content: `${question}\n\nCURRENT HOTELCARE CONTEXT (authoritative for this turn):\n${JSON.stringify(context).slice(0, 120000)}`,
        },
      ] as any,
      abortSignal: req.signal,
      providerOptions: {
        openai: { store: false, reasoningEffort: "high", reasoningSummary: "auto" },
      },
    });

    return result.toUIMessageStreamResponse({
      headers: CORS,
      onFinish: async ({ responseMessage, isAborted }) => {
        if (isAborted) {
          await finalize(false);
          return;
        }
        const answer = extractText(responseMessage as any);
        if (!answer) {
          await finalize(false);
          return;
        }
        const { error: saveError } = await db.from("assistant_messages").insert({
          thread_id: threadId,
          user_id: authData.user.id,
          role: "assistant",
          content: answer,
          model: PREMIUM_MODEL,
          refused: false,
        });
        if (saveError) {
          console.error("premium answer save failed", saveError);
          await finalize(false);
          return;
        }
        await db.from("assistant_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId).eq("user_id", authData.user.id);
        await db.from("assistant_audit_log").insert({
          user_id: authData.user.id,
          organization_slug: profile.organization_slug,
          hotel_id: context?.properties?.length === 1 ? context.properties[0].id : profile.assigned_hotel,
          role: profile.role,
          question,
          refused: false,
          scopes_used: scope ? [`premium-${scope}`] : ["premium-analysis"],
          model: PREMIUM_MODEL,
        });
        await finalize(true);
      },
      onError: (error) => {
        void finalize(false);
        console.error("premium assistant stream failed", error);
        return "The deep analysis could not finish. Your allowance has been returned; please try again.";
      },
    });
  } catch (error) {
    await finalize(false);
    if (error instanceof DOMException && error.name === "AbortError") return json({ error: "Request cancelled" }, 499);
    console.error("assistant-chat-router premium error", error);
    return json({ error: error instanceof Error ? error.message : "Deep analysis failed" }, 500);
  }
});
