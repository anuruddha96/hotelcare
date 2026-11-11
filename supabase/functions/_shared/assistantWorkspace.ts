// Tools added by the HotelCare AI workspace: charts, the pricing review,
// competitor rates, Google reviews, restaurant reservations and image
// generation.
//
// Same rule as every other assistant tool: a tool is only REGISTERED for a
// role that may use the matching screen, and every query is limited to the
// caller's organization and authorized hotels. The model cannot reach data by
// asking for it, because the tool it would need does not exist in its turn.

import { jsonSchema, tool } from "npm:ai@7";
import type { AssistantHotel } from "./assistantHotels.ts";
import { envelope, type RevenueDataset } from "./revenueMetrics.ts";
import { buildPricingReview } from "./pricingReview.ts";
import { logAiUsage } from "./aiBudget.ts";

export type WorkspaceAttachment =
  | {
      kind: "chart";
      chartType: "line" | "bar" | "area" | "pie";
      title: string;
      unit: string | null;
      categories: string[];
      series: { name: string; values: (number | null)[] }[];
    }
  | { kind: "image"; path: string; prompt: string; size: string }
  | {
      kind: "review_reply";
      reviewId: string;
      organizationSlug: string;
      location: string;
      stars: number | null;
      reviewer: string | null;
      date: string;
      review: string;
      reply: string;
    }
  | {
      kind: "email_draft";
      draftId: string;
      from: string;
      to: string[];
      cc: string[];
      subject: string;
      body: string;
      external: string[];
      inReplyTo: string | null;
    };

/** Mirrors the Reputation screen (`src/pages/Reputation.tsx`). */
const REPUTATION_ROLES = ["admin", "top_management", "top_management_manager"];
/** Creative generation is a management tool, not a floor tool. */
const IMAGE_ROLES = ["admin", "top_management", "top_management_manager", "manager"];
const IMAGE_DAILY_LIMIT = 10;
const COMPETITOR_FRESH_HOURS = 48;

export function canReadReputation(role: string | null | undefined): boolean {
  return REPUTATION_ROLES.includes(role ?? "");
}
export function canGenerateImages(role: string | null | undefined): boolean {
  return IMAGE_ROLES.includes(role ?? "");
}

type Ctx = {
  service: any;
  profile: { id: string; role: string; organization_slug: string | null; assigned_hotel: string | null };
  scopes: Set<string>;
  hotels: AssistantHotel[];
  /** Narrows a hotel argument to authorized hotel ids; throws when not allowed. */
  resolve: (requested: string | null | undefined) => string[];
  revenueDatasets: (
    requested: string | null | undefined,
  ) => Promise<{ hotel: AssistantHotel; dataset: RevenueDataset | null }[]>;
  today: () => string;
  openAiKey: string;
  pageHotelId: string | null;
  /** Charts and images produced in this turn, saved with the answer. */
  attachments: WorkspaceAttachment[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(day: string, amount: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

function isoOr(value: unknown, fallback: string): string {
  return typeof value === "string" && ISO_DATE.test(value) ? value : fallback;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Validates what the model wants to draw. Exported for tests. */
export function cleanChart(raw: any): { ok: true; chart: Extract<WorkspaceAttachment, { kind: "chart" }> } | { ok: false; error: string } {
  const chartType = ["line", "bar", "area", "pie"].includes(raw?.type) ? raw.type : "bar";
  const categories = (Array.isArray(raw?.categories) ? raw.categories : []).slice(0, 62).map((c: unknown) => String(c ?? "").slice(0, 40));
  if (categories.length < 1) return { ok: false, error: "A chart needs at least one category on the x axis." };
  const series = (Array.isArray(raw?.series) ? raw.series : [])
    .slice(0, chartType === "pie" ? 1 : 6)
    .map((s: any) => ({
      name: String(s?.name ?? "Value").slice(0, 40),
      values: categories.map((_: string, index: number) => {
        const value = Array.isArray(s?.values) ? s.values[index] : null;
        if (value === null || value === undefined || value === "") return null;
        const n = Number(value);
        return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
      }),
    }))
    .filter((s: any) => s.values.some((v: number | null) => v !== null));
  if (!series.length) return { ok: false, error: "A chart needs at least one series with numbers." };
  return {
    ok: true,
    chart: {
      kind: "chart",
      chartType,
      title: String(raw?.title ?? "").slice(0, 120),
      unit: raw?.unit ? String(raw.unit).slice(0, 12) : null,
      categories,
      series,
    },
  };
}

export function buildWorkspaceTools(ctx: Ctx): Record<string, any> {
  const { service, profile, scopes, hotels } = ctx;
  const orgSlug = profile.organization_slug;
  const tools: Record<string, any> = {};

  // ----------------------------------------------------------------- charts
  tools.render_chart = tool({
    description:
      "Draw a chart under your answer. Use it whenever the user asks for a chart or graph, or when you compare 4 or more dates, hotels or categories. ONLY plot numbers returned by a data tool in this turn — never estimated or invented values; use null for a missing point. Every series of one chart must share the same unit: never mix euros and percentages in one chart, draw two charts instead. line: trends over dates. bar: comparisons. area: cumulative trends. pie: share of a whole (one series). After calling it, give the takeaway in one or two sentences; do not repeat every number.",
    inputSchema: jsonSchema<{ type: string; title: string; unit: string | null; categories: string[]; series: { name: string; values: (number | null)[] }[] }>({
      type: "object",
      properties: {
        type: { type: "string", enum: ["line", "bar", "area", "pie"] },
        title: { type: "string", description: "Short title including hotel and period" },
        unit: { type: ["string", "null"], description: "Unit shown on values, e.g. €, %, rooms, or null" },
        categories: { type: "array", items: { type: "string" }, description: "X axis labels in order, e.g. dates as 12 Nov" },
        series: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              values: { type: "array", items: { type: ["number", "null"] }, description: "One value per category, same order" },
            },
            required: ["name", "values"],
            additionalProperties: false,
          },
        },
      },
      required: ["type", "title", "unit", "categories", "series"],
      additionalProperties: false,
    }),
    execute: async (input) => {
      const cleaned = cleanChart(input);
      if (!cleaned.ok) return { ok: false, error: cleaned.error };
      if (ctx.attachments.filter((a) => a.kind === "chart").length >= 4) {
        return { ok: false, error: "At most four charts per answer." };
      }
      ctx.attachments.push(cleaned.chart);
      return { ok: true, ...cleaned.chart };
    },
  });

  // ---------------------------------------------------------------- revenue
  if (scopes.has("revenue")) {
    const loadMarket = async (hotelId: string, from: string, to: string) => {
      const [properties, rates] = await Promise.all([
        service
          .from("competitor_properties")
          .select("id,name,last_scan_at,last_scan_status")
          .eq("organization_slug", orgSlug)
          .eq("hotel_id", hotelId)
          .eq("active", true)
          .limit(60),
        service
          .from("competitor_rates")
          .select("competitor_id,stay_date,rate,currency,captured_at")
          .eq("organization_slug", orgSlug)
          .eq("hotel_id", hotelId)
          .gte("stay_date", from)
          .lte("stay_date", to)
          .order("captured_at", { ascending: false })
          .limit(5000),
      ]);
      if (properties.error) throw new Error(`Competitor lookup failed: ${properties.error.message}`);
      if (rates.error) throw new Error(`Competitor rate lookup failed: ${rates.error.message}`);
      const active = new Map<string, any>((properties.data ?? []).map((p: any) => [String(p.id), p]));
      // Newest observation per competitor and stay date.
      const latest = new Map<string, any>();
      for (const row of rates.data ?? []) {
        if (!active.has(String(row.competitor_id))) continue;
        const key = `${row.competitor_id}|${row.stay_date}`;
        if (!latest.has(key)) latest.set(key, row);
      }
      const lastScan = [...active.values()].map((p) => p.last_scan_at).filter(Boolean).sort().at(-1) ?? null;
      const ageHours = lastScan ? Math.max(0, (Date.now() - Date.parse(lastScan)) / 3_600_000) : null;
      return {
        properties: [...active.values()],
        rows: [...latest.values()],
        lastScan,
        ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
        fresh: ageHours !== null && ageHours <= COMPETITOR_FRESH_HOURS,
      };
    };

    const loadEvents = async (hotelId: string, from: string, to: string) => {
      const select = "title,category,event_date,end_date,expected_impact,surcharge_eur,approved,hotel_id";
      const base = () =>
        service
          .from("demand_events")
          .select(select)
          .eq("organization_slug", orgSlug)
          .lte("event_date", to)
          .gte("event_date", addDays(from, -21))
          .order("event_date")
          .limit(300);
      const [own, shared] = await Promise.all([base().eq("hotel_id", hotelId), base().is("hotel_id", null)]);
      if (own.error) throw new Error(`Event lookup failed: ${own.error.message}`);
      const rows = [...(own.data ?? []), ...(shared.error ? [] : shared.data ?? [])];
      return rows.filter((e: any) => String(e.end_date || e.event_date) >= from);
    };

    tools.get_competitor_rates = tool({
      description:
        "Competitor (comp set) prices per stay date for ONE hotel: lowest, median and highest competitor rate, how many competitors were priced, our own entry rate and our position against the median. Says how old the market scan is.",
      inputSchema: jsonSchema<{ hotelId: string | null; startDate: string | null; endDate: string | null }>({
        type: "object",
        properties: {
          hotelId: { type: ["string", "null"], description: "One of the user's hotel ids, or null when they have a single hotel" },
          startDate: { type: ["string", "null"], description: "YYYY-MM-DD or null for today" },
          endDate: { type: ["string", "null"], description: "YYYY-MM-DD or null for 14 days out" },
        },
        required: ["hotelId", "startDate", "endDate"],
        additionalProperties: false,
      }),
      execute: async ({ hotelId, startDate, endDate }) => {
        const picked = await ctx.revenueDatasets(hotelId ?? ctx.pageHotelId);
        if (picked.length !== 1) return { ok: false, error: "Name exactly one hotel for a competitor comparison." };
        const { hotel, dataset } = picked[0];
        const from = isoOr(startDate, ctx.today());
        const to = isoOr(endDate, addDays(from, 14));
        if (to < from || addDays(from, 92) < to) return { ok: false, error: "Use a date range of at most 92 days." };
        const market = await loadMarket(hotel.hotel_id, from, to);
        const names = new Map(market.properties.map((p: any) => [String(p.id), p.name]));
        const entry = new Map<string, number>();
        for (const rate of dataset?.payload.rates ?? []) {
          const price = Number(rate.price);
          if (!Number.isFinite(price) || price <= 0 || rate.stay_date < from || rate.stay_date > to) continue;
          const previous = entry.get(rate.stay_date);
          if (previous === undefined || price < previous) entry.set(rate.stay_date, price);
        }
        const byDate = new Map<string, { name: string; rate: number }[]>();
        for (const row of market.rows) {
          const rate = Number(row.rate);
          if (!Number.isFinite(rate) || rate <= 0) continue;
          const list = byDate.get(row.stay_date) ?? [];
          list.push({ name: String(names.get(String(row.competitor_id)) ?? "Competitor"), rate: Math.round(rate) });
          byDate.set(row.stay_date, list);
        }
        const dates = [...byDate.keys()].sort().map((date) => {
          const set = byDate.get(date)!;
          const values = set.map((s) => s.rate);
          const mid = median(values);
          const ours = entry.get(date) ?? null;
          return {
            stay_date: date,
            competitors_priced: set.length,
            lowest: Math.min(...values),
            median: mid === null ? null : Math.round(mid),
            highest: Math.max(...values),
            our_entry_rate: ours,
            our_position_vs_median_pct: mid && ours ? Math.round(((ours - mid) / mid) * 1000) / 10 : null,
            competitors: set.sort((a, b) => a.rate - b.rate).slice(0, 12),
          };
        });
        return envelope(
          {
            hotel_id: hotel.hotel_id,
            hotel_name: hotel.hotel_name,
            from,
            to,
            watched_competitors: market.properties.length,
            last_market_scan_at: market.lastScan,
            market_scan_age_hours: market.ageHours,
            usable_for_pricing: market.fresh,
            dates,
          },
          {
            source: "competitor_rates",
            lastSyncAt: market.lastScan,
            ...(market.properties.length === 0
              ? { confidence: "unverified" as const, note: "No competitors are set up for this hotel." }
              : !market.fresh
                ? { confidence: "partial" as const, note: `The last market scan is ${market.ageHours ?? "an unknown number of"} hours old; do not base a price move on it.` }
                : {}),
          },
        );
      },
    });

    tools.review_pricing = tool({
      description:
        "The pricing review. For ONE hotel and up to 45 nights it reads occupancy against the booking window, recent pickup, our entry rate, the competitor median and demand events, and returns a stance per date (raise / lower / hold / protect) with a bounded whole-euro step, plus ready-made proposals grouped into ranges of at most 7 nights. Use this for any request to review, check or optimise prices over a period, find which dates to change, or price around events. The euro steps it returns are the ONLY amounts you may propose.",
      inputSchema: jsonSchema<{ hotelId: string | null; startDate: string | null; days: number | null }>({
        type: "object",
        properties: {
          hotelId: { type: ["string", "null"], description: "One of the user's hotel ids, or null when they have a single hotel" },
          startDate: { type: ["string", "null"], description: "First stay date YYYY-MM-DD, or null for tomorrow" },
          days: { type: ["number", "null"], description: "Number of nights to review, default 30, max 45" },
        },
        required: ["hotelId", "startDate", "days"],
        additionalProperties: false,
      }),
      execute: async ({ hotelId, startDate, days }) => {
        const picked = await ctx.revenueDatasets(hotelId ?? ctx.pageHotelId);
        if (picked.length !== 1) {
          return {
            ok: false,
            error: `A pricing review covers one hotel at a time. Ask which one: ${hotels.map((h) => h.hotel_name).join(", ")}.`,
          };
        }
        const { hotel, dataset } = picked[0];
        if (!dataset) {
          return envelope(
            { hotel_name: hotel.hotel_name },
            { source: "revenue_published_payload", confidence: "unverified", note: "No completed Revenue dataset for this hotel, so prices cannot be reviewed." },
          );
        }
        const today = ctx.today();
        const from = isoOr(startDate, addDays(today, 1));
        if (from < today) return { ok: false, error: "The review can only cover today and future dates." };
        const nights = Math.min(Math.max(Math.round(Number(days ?? 30)) || 30, 1), 45);
        const to = addDays(from, nights - 1);

        const [market, events, rule] = await Promise.all([
          loadMarket(hotel.hotel_id, from, to),
          loadEvents(hotel.hotel_id, from, to),
          service
            .from("revenue_pickup_automation_rules")
            .select("minimum_adr,is_enabled,auto_publish")
            .eq("organization_slug", orgSlug)
            .eq("hotel_id", hotel.hotel_id)
            .limit(1),
        ]);
        const ruleRow = rule.data?.[0] ?? null;
        // 7-day pickup window: what was booked for each stay date in the last week.
        const metrics = dataset.metricsFor(from, to, 7);
        const review = buildPricingReview({
          today,
          days: metrics.map((m) => ({
            stay_date: m.stay_date,
            occupancyPct: m.occupancyPct,
            roomsLeft: m.roomsLeft,
            roomsAvailable: m.roomsAvailable,
            netPickup: m.netPickup,
            hasData: m.hasData,
          })),
          rates: (dataset.payload.rates ?? [])
            .filter((r) => r.stay_date >= from && r.stay_date <= to)
            .map((r) => ({ stay_date: r.stay_date, price: Number(r.price) })),
          competitorRates: market.rows.map((r: any) => ({ stay_date: r.stay_date, rate: Number(r.rate) })),
          competitorFresh: market.fresh,
          events,
          minimumRateEur: Number(ruleRow?.minimum_adr ?? 0) || null,
        });

        const notes: string[] = [];
        if (review.summary.competitor_data === "stale") notes.push(`Competitor rates are ${market.ageHours} hours old, so no decrease is suggested from them.`);
        if (review.summary.competitor_data === "none") notes.push("No competitor rates for this period, so no decrease is suggested.");
        if (review.summary.insufficient_data) notes.push(`${review.summary.insufficient_data} date(s) have no verified occupancy or rate.`);

        return envelope(
          {
            hotel_id: hotel.hotel_id,
            hotel_name: hotel.hotel_name,
            currency: dataset.currency,
            pickup_window_days: 7,
            minimum_rate_floor: Number(ruleRow?.minimum_adr ?? 0) || null,
            automation_enabled: Boolean(ruleRow?.is_enabled),
            market_scan_age_hours: market.ageHours,
            events_in_period: events.map((e: any) => ({
              title: e.title,
              from: e.event_date,
              to: e.end_date || e.event_date,
              impact: e.expected_impact,
              approved: e.approved,
            })),
            ...review,
            how_to_apply:
              "Each proposal maps to one propose_action call: kind adjust_revenue_prices, input {hotelId, fromDate, toDate, deltaEur}. The step applies to every published room type and occupancy price of those nights, so the room-type ladder is preserved.",
          },
          {
            source: "revenue_published_payload",
            lastSyncAt: dataset.lastSyncAt,
            ...(notes.length ? { confidence: "partial" as const, note: notes.join(" ") } : {}),
          },
        );
      },
    });
  }

  // ------------------------------------------------------------- reputation
  if (canReadReputation(profile.role) && orgSlug) {
    tools.get_reputation_overview = tool({
      description:
        "Google reviews for the organization: rating and review count per location for a period, how many are still unanswered, the unanswered low-star reviews that need a reply first, and a weekly rating trend. Use for reputation, reviews, guest feedback and rating questions.",
      inputSchema: jsonSchema<{ days: number | null }>({
        type: "object",
        properties: { days: { type: ["number", "null"], description: "Look-back period in days, default 30, max 365" } },
        required: ["days"],
        additionalProperties: false,
      }),
      execute: async ({ days }) => {
        const period = Math.min(Math.max(Math.round(Number(days ?? 30)) || 30, 1), 365);
        const since = new Date(Date.now() - period * 86_400_000).toISOString();
        const { data: org } = await service.from("organizations").select("id").eq("slug", orgSlug).maybeSingle();
        if (!org?.id) return { ok: false, error: "The organization could not be resolved." };
        const [locations, reviews] = await Promise.all([
          service
            .from("google_business_locations")
            .select("id,google_location_title,hotel_id,is_active,last_sync_at,reply_mode")
            .eq("organization_id", org.id)
            .limit(100),
          service
            .from("google_reviews")
            .select("id,google_location_id,star_rating,comment,review_create_time,reply_status,google_reply_comment,reviewer_display_name,ai_sentiment,ai_categories,ai_risk_level")
            .eq("organization_id", org.id)
            .gte("review_create_time", since)
            .order("review_create_time", { ascending: false })
            .limit(3000),
        ]);
        if (locations.error) throw new Error(`Location lookup failed: ${locations.error.message}`);
        if (reviews.error) throw new Error(`Review lookup failed: ${reviews.error.message}`);
        const title = new Map<string, string>((locations.data ?? []).map((l: any) => [String(l.id), l.google_location_title]));
        const rows = reviews.data ?? [];
        const unanswered = (r: any) => r.reply_status !== "published" && !r.google_reply_comment;
        const perLocation = new Map<string, any>();
        const weekly = new Map<string, { sum: number; count: number }>();
        const topics = new Map<string, number>();
        for (const r of rows) {
          const key = String(r.google_location_id);
          const entry = perLocation.get(key) ?? { location: title.get(key) ?? "Location", reviews: 0, ratingSum: 0, unanswered: 0, low_star: 0 };
          entry.reviews += 1;
          entry.ratingSum += Number(r.star_rating) || 0;
          if (unanswered(r)) entry.unanswered += 1;
          if (Number(r.star_rating) <= 3) entry.low_star += 1;
          perLocation.set(key, entry);
          const created = new Date(r.review_create_time);
          const monday = new Date(Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate() - ((created.getUTCDay() + 6) % 7)));
          const week = monday.toISOString().slice(0, 10);
          const bucket = weekly.get(week) ?? { sum: 0, count: 0 };
          bucket.sum += Number(r.star_rating) || 0;
          bucket.count += 1;
          weekly.set(week, bucket);
          if (Number(r.star_rating) <= 3) for (const topic of r.ai_categories ?? []) topics.set(topic, (topics.get(topic) ?? 0) + 1);
        }
        const lastSync = (locations.data ?? []).map((l: any) => l.last_sync_at).filter(Boolean).sort().at(-1) ?? null;
        return envelope(
          {
            period_days: period,
            total_reviews: rows.length,
            average_rating: rows.length ? Math.round((rows.reduce((n: number, r: any) => n + (Number(r.star_rating) || 0), 0) / rows.length) * 100) / 100 : null,
            unanswered: rows.filter(unanswered).length,
            locations: [...perLocation.values()]
              .map((l) => ({ location: l.location, reviews: l.reviews, average_rating: Math.round((l.ratingSum / l.reviews) * 100) / 100, unanswered: l.unanswered, low_star_reviews: l.low_star }))
              .sort((a, b) => b.reviews - a.reviews),
            reply_first: rows
              .filter((r: any) => unanswered(r) && Number(r.star_rating) <= 3)
              .slice(0, 10)
              .map((r: any) => ({
                review_id: r.id,
                location: title.get(String(r.google_location_id)) ?? "Location",
                stars: r.star_rating,
                date: String(r.review_create_time).slice(0, 10),
                reviewer: r.reviewer_display_name,
                summary: String(r.comment ?? "").replace(/\s+/g, " ").slice(0, 320),
                risk: r.ai_risk_level,
              })),
            low_star_topics: [...topics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([topic, count]) => ({ topic, count })),
            weekly_trend: [...weekly.entries()].sort().map(([week_starting, b]) => ({ week_starting, reviews: b.count, average_rating: Math.round((b.sum / b.count) * 100) / 100 })),
            how_to_reply: "Call draft_review_reply with a review_id to put a reply card in front of the user; they publish it with one tap.",
          },
          {
            source: "google_reviews",
            lastSyncAt: lastSync,
            ...(locations.data?.length ? {} : { confidence: "unverified" as const, note: "No Google Business location is connected yet." }),
          },
        );
      },
    });
  }

  if (canReadReputation(profile.role) && orgSlug) {
    tools.draft_review_reply = tool({
      description:
        "Prepare a reply to ONE Google review as a card the user can edit and publish to Google with one tap. Use the review_id from get_reputation_overview. Never claim the reply is published: it is only published when the user taps Publish.",
      inputSchema: jsonSchema<{ reviewId: string; reply: string }>({
        type: "object",
        properties: {
          reviewId: { type: "string", description: "review_id from get_reputation_overview" },
          reply: { type: "string", description: "The reply text, in the language of the review, signed as the hotel team" },
        },
        required: ["reviewId", "reply"],
        additionalProperties: false,
      }),
      execute: async ({ reviewId, reply }) => {
        const text = String(reply ?? "").trim();
        if (!/^[0-9a-f-]{36}$/i.test(String(reviewId))) return { ok: false, error: "Use a review_id returned by get_reputation_overview." };
        if (text.length < 10) return { ok: false, error: "Write a complete reply." };
        if (text.length > 4000) return { ok: false, error: "Keep the reply under 4000 characters." };
        if (ctx.attachments.filter((a) => a.kind === "review_reply").length >= 5) return { ok: false, error: "At most five reply cards per answer." };
        const { data: org } = await service.from("organizations").select("id").eq("slug", orgSlug).maybeSingle();
        if (!org?.id) return { ok: false, error: "The organization could not be resolved." };
        const { data: review } = await service
          .from("google_reviews")
          .select("id,star_rating,comment,review_create_time,reviewer_display_name,reply_status,google_reply_comment,google_location_id")
          .eq("id", reviewId)
          .eq("organization_id", org.id)
          .maybeSingle();
        if (!review) return { ok: false, error: "That review is not in this organization." };
        if (review.reply_status === "published" || review.google_reply_comment) {
          return { ok: false, error: "This review already has a published reply." };
        }
        const { data: location } = await service
          .from("google_business_locations")
          .select("google_location_title")
          .eq("id", review.google_location_id)
          .maybeSingle();
        const card: WorkspaceAttachment = {
          kind: "review_reply",
          reviewId: review.id,
          organizationSlug: orgSlug,
          location: location?.google_location_title ?? "Google review",
          stars: Number(review.star_rating) || null,
          reviewer: review.reviewer_display_name ?? null,
          date: String(review.review_create_time ?? "").slice(0, 10),
          review: String(review.comment ?? "").replace(/\s+/g, " ").slice(0, 600),
          reply: text,
        };
        ctx.attachments.push(card);
        return { ok: true, ...card, note: "Shown to the user as a card. Not published until they tap Publish." };
      },
    });
  }

  // ------------------------------------------------------------- restaurant
  if (scopes.has("reception")) {
    tools.get_restaurant_reservations = tool({
      description:
        "Restaurant and brunch table reservations for the user's hotels: reservations and covers (guests) per day and outlet, split by status, plus the bookings of a single day with time, party size and special requests. Use for restaurant, brunch, table booking and covers questions.",
      inputSchema: jsonSchema<{ hotelId: string | null; startDate: string | null; endDate: string | null }>({
        type: "object",
        properties: {
          hotelId: { type: ["string", "null"], description: "One of the user's hotel ids, or null for all of them" },
          startDate: { type: ["string", "null"], description: "YYYY-MM-DD or null for today" },
          endDate: { type: ["string", "null"], description: "YYYY-MM-DD or null for the same day" },
        },
        required: ["hotelId", "startDate", "endDate"],
        additionalProperties: false,
      }),
      execute: async ({ hotelId, startDate, endDate }) => {
        const ids = ctx.resolve(hotelId);
        const from = isoOr(startDate, ctx.today());
        const to = isoOr(endDate, from);
        if (to < from || addDays(from, 92) < to) return { ok: false, error: "Use a date range of at most 92 days." };
        // Website webhooks store the canonical hotel UUID, the app uses the
        // configuration id. Accept both, but only for the authorized hotels.
        const picked = hotels.filter((h) => ids.includes(h.hotel_id));
        const nameToHotel = new Map<string, AssistantHotel>();
        const idToHotel = new Map<string, AssistantHotel>(picked.map((h) => [h.hotel_id, h]));
        for (const h of picked) nameToHotel.set(String(h.hotel_name ?? "").trim().toLowerCase(), h);
        const { data: canonical } = await service.from("hotels").select("id,name").limit(500);
        for (const row of canonical ?? []) {
          const match = nameToHotel.get(String(row.name ?? "").trim().toLowerCase());
          if (match) idToHotel.set(String(row.id), match);
        }
        const { data, error } = await service
          .from("restaurant_reservations")
          .select("hotel_id,outlet_slug,service_date,starts_at,party_size,status,guest_name,occasion,special_requests")
          .in("hotel_id", [...idToHotel.keys()])
          .gte("service_date", from)
          .lte("service_date", to)
          .order("starts_at")
          .limit(4000);
        if (error) throw new Error(`Restaurant reservation lookup failed: ${error.message}`);
        const rows = data ?? [];
        const cancelled = (status: string) => /cancel|no.?show/i.test(String(status));
        const daily = new Map<string, any>();
        for (const r of rows) {
          const hotel = idToHotel.get(String(r.hotel_id));
          const key = `${r.service_date}|${hotel?.hotel_id}|${r.outlet_slug}`;
          const entry = daily.get(key) ?? { date: r.service_date, hotel: hotel?.hotel_name ?? "", outlet: r.outlet_slug, reservations: 0, covers: 0, cancelled_or_no_show: 0 };
          if (cancelled(r.status)) entry.cancelled_or_no_show += 1;
          else {
            entry.reservations += 1;
            entry.covers += Number(r.party_size) || 0;
          }
          daily.set(key, entry);
        }
        const live = rows.filter((r: any) => !cancelled(r.status));
        return {
          from,
          to,
          total_reservations: live.length,
          total_covers: live.reduce((n: number, r: any) => n + (Number(r.party_size) || 0), 0),
          by_day: [...daily.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))),
          bookings: from === to
            ? rows.slice(0, 80).map((r: any) => ({
                time: r.starts_at,
                outlet: r.outlet_slug,
                guest: r.guest_name,
                party_size: r.party_size,
                status: r.status,
                occasion: r.occasion,
                special_requests: r.special_requests,
              }))
            : undefined,
          note: rows.length ? undefined : "No restaurant reservations are stored for this period. That is not proof there are none: the reservation feed may not be connected for this hotel.",
        };
      },
    });
  }

  // ----------------------------------------------------------------- images
  if (canGenerateImages(profile.role)) {
    tools.generate_image = tool({
      description:
        "Create an image from a description, for hotel marketing and internal material: social posts, menu or event visuals, signage drafts, mood boards. Do not use it for charts (use render_chart), for real identifiable people, or for other companies' logos and brands.",
      inputSchema: jsonSchema<{ prompt: string; format: string }>({
        type: "object",
        properties: {
          prompt: { type: "string", description: "A complete visual brief: subject, setting, style, lighting, colours, and any text that must appear" },
          format: { type: "string", enum: ["square", "landscape", "portrait"] },
        },
        required: ["prompt", "format"],
        additionalProperties: false,
      }),
      execute: async ({ prompt, format }) => {
        const brief = String(prompt ?? "").trim().slice(0, 2000);
        if (brief.length < 8) return { ok: false, error: "Describe the image in a little more detail." };
        if (ctx.attachments.some((a) => a.kind === "image")) return { ok: false, error: "One image per answer." };
        const dayStart = `${ctx.today()}T00:00:00Z`;
        const { data: existing } = await service.storage
          .from("assistant-media")
          .list(profile.id, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
        const todayCount = (existing ?? []).filter((f: any) => String(f.created_at ?? "") >= dayStart).length;
        if (todayCount >= IMAGE_DAILY_LIMIT) {
          return { ok: false, error: `The daily limit of ${IMAGE_DAILY_LIMIT} generated images has been reached. It resets tomorrow.` };
        }
        const size = format === "landscape" ? "1536x1024" : format === "portrait" ? "1024x1536" : "1024x1024";
        const model = Deno.env.get("OPENAI_IMAGE_MODEL") || "gpt-image-1";
        const response = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.openAiKey}` },
          body: JSON.stringify({ model, prompt: brief, size, n: 1 }),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) {
          console.error("assistant image generation failed", response.status, result?.error?.message);
          return { ok: false, error: result?.error?.code === "moderation_blocked" || /safety|policy/i.test(String(result?.error?.message)) ? "That image request was declined by the content policy." : "The image could not be generated just now." };
        }
        const item = result?.data?.[0];
        let bytes: Uint8Array | null = null;
        if (typeof item?.b64_json === "string") {
          bytes = Uint8Array.from(atob(item.b64_json), (c) => c.charCodeAt(0));
        } else if (typeof item?.url === "string") {
          const download = await fetch(item.url);
          if (download.ok) bytes = new Uint8Array(await download.arrayBuffer());
        }
        if (!bytes) return { ok: false, error: "The image service returned no image." };
        const path = `${profile.id}/${crypto.randomUUID()}.png`;
        const upload = await service.storage.from("assistant-media").upload(path, bytes, { contentType: "image/png", upsert: false });
        if (upload.error) {
          console.error("assistant image upload failed", upload.error.message);
          return { ok: false, error: "The image was created but could not be saved." };
        }
        await logAiUsage(service, {
          organizationSlug: orgSlug,
          hotelId: profile.assigned_hotel,
          functionName: "assistant-image",
          model,
          inputTokens: Number(result?.usage?.input_tokens ?? 0),
          outputTokens: Number(result?.usage?.output_tokens ?? 0),
        });
        const attachment: WorkspaceAttachment = { kind: "image", path, prompt: brief.slice(0, 300), size };
        ctx.attachments.push(attachment);
        return { ok: true, ...attachment, remaining_today: IMAGE_DAILY_LIMIT - todayCount - 1 };
      },
    });
  }

  return tools;
}

/** Rules appended to the system prompt for the tools above. */
export function workspacePrompt(params: { hasRevenue: boolean; hasReputation: boolean; hasRestaurant: boolean; hasImages: boolean; canWriteRates: boolean }): string {
  const lines = [
    "",
    "CHARTS",
    "- When the user asks for a chart, graph or visual, or the answer compares four or more dates, hotels or categories, read the data first and then call render_chart with exactly those numbers. Never chart numbers you did not just read. Follow the chart with the takeaway in one or two sentences.",
    "- One unit per chart. Occupancy (%) and rates (€) are two charts, never one.",
  ];
  if (params.hasRevenue) {
    lines.push(
      "",
      "PRICING REVIEW — for requests like \"check the next 30 days and update the best rates\", \"which dates should I change\", \"price around the events\"",
      "Work through it in this order, as a revenue manager would, and do not stop after the first read:",
      "1. Identify the single hotel. If the user has several and none is selected, ask which one and stop.",
      "2. Call review_pricing for the period. It already combines events, occupancy against the booking window, 7-day pickup, our entry rate and the competitor median.",
      "3. If the review is partial (stale or missing competitor rates, missing occupancy), say so in one sentence. Never fill the gap with assumptions.",
      "4. Answer with: the high-impact event dates and what they mean; a compact table of ONLY the dates that need a change (date, occupancy, rooms left, our rate, competitor median, step, new rate, why); one line on what stays unchanged and why.",
      "5. For a period of 10 nights or more, also call render_chart with a line chart of our entry rate against the competitor median (both in euros) so the manager sees where the month is over- or under-priced.",
      params.canWriteRates
        ? "6. Then call propose_action once per proposal returned by review_pricing (kind adjust_revenue_prices, input {hotelId, fromDate, toDate, deltaEur}), at most 6 proposals, most valuable first. Each one becomes a confirmation card. Use the returned euro steps exactly; never invent, round or enlarge them. In the pricing review NEVER use execute_action: these are your recommendations, so the user confirms each one."
        : "6. This user may not change rates. Present the recommendation and say that an administrator or top management applies rate changes.",
      "7. The step is the same number of euros for every room type and occupancy of that night, which keeps the room-type ladder intact. Say that once.",
      "8. Never claim a price was changed. A confirmed card is queued through the Revenue safety checks and the calendar shows the PMS-confirmed value.",
      "- For a market question only (\"how are we priced against competitors\"), use get_competitor_rates.",
    );
  }
  if (params.hasReputation) {
    lines.push(
      "",
      "REPUTATION",
      "- Google review questions are answered from get_reputation_overview. Lead with rating, review count and unanswered count for the period, then the low-star reviews to reply to first. Quote review text only as a short paraphrase.",
      "- When the user asks to reply to reviews, call draft_review_reply once per review (at most 5). Write each reply in the review's language: thank the guest by name if given, address the specific points, apologise sincerely for real failures without admitting liability, say what is being done, invite them back. No discount promises, no guest personal data, under 120 words. The user publishes each card; never say a reply was published.",
    );
  }
  if (params.hasRestaurant) {
    lines.push("", "RESTAURANT", "- Restaurant, brunch and table-booking questions are answered from get_restaurant_reservations (reservations and covers). Hotel Care does not hold restaurant till revenue; say so if asked for sales in euros.");
  }
  if (params.hasImages) {
    lines.push("", "IMAGES", "- Use generate_image only when the user asks for an image, picture, visual or design draft. Write a complete brief yourself. One image per answer.");
  }
  return lines.join("\n");
}
