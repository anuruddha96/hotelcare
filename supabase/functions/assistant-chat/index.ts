import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createOpenAI } from "npm:@ai-sdk/openai@4";
import {
  convertToModelMessages,
  jsonSchema,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "npm:ai@7";
import { AUTOMATION_FIELDS, canChangeAutomation, validateChanges } from "../_shared/assistantAutomationFields.ts";
import { pickHotels, resolveAssistantHotels, type AssistantHotel } from "../_shared/assistantHotels.ts";
import { ACTION_LABEL, actionsForRole, validateAction } from "../_shared/assistantActions.ts";
import { envelope, loadRevenueDataset, type RevenueDataset } from "../_shared/revenueMetrics.ts";


type Profile = {
  id: string;
  role: string;
  assigned_hotel: string | null;
  organization_slug: string | null;
  preferred_language: string | null;
};

type Scope = "revenue" | "housekeeping" | "maintenance" | "reception" | "finance";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  hu: "Hungarian",
  es: "Spanish",
  vi: "Vietnamese",
  mn: "Mongolian",
  ru: "Russian",
  uk: "Ukrainian",
};

const HOW_TO = `
Hotel Care workflow reference:
- Housekeepers must sign in before starting a room. In Team View they open an assigned room, tap Start Cleaning, complete the checklist/photos, then Complete.
- Managers use Auto-Assign or Team View for rooms and public areas. The old General Tasks tab no longer exists.
- Maintenance tickets are created from the maintenance area, include the room/location, priority and required photos, then move Open → In progress → Completed.
- Reception/front office can use the public breakfast lookup and the nightly Previo upload surfaces available to their role.
- Revenue tools are available only to revenue-authorized roles. Rate changes and minimum-stay actions follow the Revenue calendar workflow.
- If a feature is not visible, explain that access is role-controlled; never suggest bypassing permissions.
`;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function allowedScopes(role: string): Set<Scope> {
  if (["admin", "manager", "top_management", "top_management_manager"].includes(role)) {
    return new Set(["revenue", "housekeeping", "maintenance", "reception", "finance"]);
  }
  if (["control_finance", "control_manager", "finance_manager"].includes(role)) return new Set(["finance"]);
  if (role === "back_office_manager") return new Set(["finance", "housekeeping", "maintenance", "reception"]);
  if (["housekeeping", "housekeeping_manager", "supervisor"].includes(role)) return new Set(["housekeeping"]);
  if (["maintenance", "maintenance_manager"].includes(role)) return new Set(["maintenance"]);
  if (["reception", "reception_manager", "front_office", "breakfast_staff"].includes(role)) return new Set(["reception"]);
  return new Set();
}

function extractText(message: UIMessage | undefined): string {
  const parts = message?.parts ?? [];
  return parts
    .filter((part): part is Extract<(typeof parts)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}

function normalizeMessages(value: unknown): UIMessage[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) return null;
  const messages = value.filter(
    (item): item is UIMessage =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as UIMessage).id === "string" &&
      ["user", "assistant", "system"].includes((item as UIMessage).role) &&
      Array.isArray((item as UIMessage).parts),
  );
  return messages.length === value.length ? messages : null;
}

function detectRequestedScope(question: string): Scope | null {
  const q = question.toLowerCase();
  if (/\b(adr|revpar|revenue|rate|price|pickup|occupancy|min.?stay)\b/.test(q)) return "revenue";
  if (/\b(clean|cleaning|housekeep|dirty room|inspected room|assignment)\b/.test(q)) return "housekeeping";
  if (/\b(maintenance|ticket|repair|broken|sla|overdue issue)\b/.test(q)) return "maintenance";
  if (/\b(arrival|departure|check.?in|check.?out|breakfast|guest)\b/.test(q)) return "reception";
  if (/\b(invoice|supplier|vendor|vat|cost centre|cost center|purchase|approval queue)\b/.test(q)) return "finance";
  return null;
}

function hotelArgSchema(extra: Record<string, unknown>, required: string[]) {
  return {
    type: "object",
    properties: {
      hotelId: { type: ["string", "null"], description: "One of the user's hotel ids, or null for all of them" },
      ...extra,
    },
    required: ["hotelId", ...required],
    additionalProperties: false,
  } as const;
}

type Capabilities = {
  destinations: { id: string; label: string; description: string; module: string; guide: string | null }[];
  guides: { slug: string; name: string; description: string; steps: string[] }[];
};

type PageContext = Record<string, unknown> | null;

// Per-user daily cap on web lookups: each search bills OpenAI, so this keeps
// the feature sustainable without blocking normal chat.
const WEB_SEARCH_DAILY_CAP = 15;

function buildTools(
  service: any,
  profile: Profile,
  scopes: Set<Scope>,
  hotels: AssistantHotel[],
  capabilities: Capabilities,
  openAiKey: string,
) {
  const orgSlug = profile.organization_slug;
  const hotelIds = hotels.map((h) => h.hotel_id);
  // Hotel days run on Budapest time, not UTC.
  const today = () =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", dateStyle: "short" }).format(new Date());

  const resolve = (requested: string | null | undefined) => {
    const picked = pickHotels(hotels, requested);
    if (!picked.ok) throw new Error(picked.error);
    return picked.hotels.map((h) => h.hotel_id);
  };

  // The published Revenue dataset is what the Revenue screen itself reads, so
  // every revenue answer is derived from it with the same calculations.
  // Cached per request: a multi-step answer loads each hotel only once.
  const datasetCache = new Map<string, Promise<RevenueDataset | null>>();
  const revenueDatasets = async (requested: string | null | undefined) => {
    const picked = pickHotels(hotels, requested);
    if (!picked.ok) throw new Error(picked.error);
    return await Promise.all(
      picked.hotels.map(async (hotel) => {
        if (!datasetCache.has(hotel.hotel_id)) {
          datasetCache.set(hotel.hotel_id, loadRevenueDataset(service, hotel.hotel_id, hotel.hotel_name));
        }
        return { hotel, dataset: await datasetCache.get(hotel.hotel_id)! };
      }),
    );
  };


  const tools: Record<string, any> = {
    get_context_now: tool({
      description: "Get the current date and time in the hotel's Budapest timezone.",
      inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {}, required: [], additionalProperties: false }),
      execute: async () => {
        const now = new Date();
        return {
          iso: now.toISOString(),
          budapest: new Intl.DateTimeFormat("en-CA", {
            timeZone: "Europe/Budapest",
            dateStyle: "full",
            timeStyle: "long",
          }).format(now),
        };
      },
    }),
    get_my_properties: tool({
      description: "List the hotels/venues this user is allowed to see. Always call this before comparing properties.",
      inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {}, required: [], additionalProperties: false }),
      execute: async () => ({ organization: orgSlug, hotels }),
    }),
    search_web: tool({
      description:
        "Search the public web for facts that are NOT stored in Hotel Care: opening hours of cafés, restaurants and venues, city events, weather, transport, and general world facts. Returns a short answer with the source names. Never use this for Hotel Care operational data (rooms, revenue, housekeeping, maintenance, reservations) — those always come from the dedicated Hotel Care tools.",
      inputSchema: jsonSchema<{ query: string }>({
        type: "object",
        properties: { query: { type: "string", description: "A precise, self-contained web search question" } },
        required: ["query"],
        additionalProperties: false,
      }),
      execute: async ({ query }) => {
        try {
          const dayStart = new Date();
          dayStart.setUTCHours(0, 0, 0, 0);
          const { count } = await service
            .from("assistant_audit_log")
            .select("id", { count: "exact", head: true })
            .eq("user_id", profile.id)
            .contains("scopes_used", ["tool-search_web"])
            .gte("created_at", dayStart.toISOString());
          if ((count ?? 0) >= WEB_SEARCH_DAILY_CAP) {
            return { error: "The daily web search limit was reached. Please try again tomorrow.", confidence: "unverified" };
          }
          const res = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${openAiKey}` },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              tools: [{ type: "web_search_preview", search_context_size: "low" }],
              input:
                "Answer this question using web search in one short paragraph, and name the source(s) you relied on " +
                "(for example the venue's official website or its Google listing). If the web has no reliable answer, say so plainly.\n\nQuestion: " +
                String(query).slice(0, 500),
            }),
          });
          if (!res.ok) {
            const detail = await res.text();
            console.error("search_web failed", res.status, detail.slice(0, 300));
            return { error: "Web search is temporarily unavailable.", confidence: "unverified" };
          }
          const data = await res.json();
          const text: string = typeof data?.output_text === "string" ? data.output_text.trim() : "";
          const sources: string[] = [];
          for (const item of data?.output ?? []) {
            if (item?.type !== "message") continue;
            for (const part of item?.content ?? []) {
              for (const ann of part?.annotations ?? []) {
                if (ann?.type === "url_citation" && ann?.url) sources.push(String(ann.url));
              }
            }
          }
          if (!text) return { error: "The web had no reliable answer for this.", confidence: "unverified" };
          return { answer: text, sources: [...new Set(sources)].slice(0, 4), confidence: "partial" };
        } catch (error) {
          console.error("search_web error", error);
          return { error: "Web search is temporarily unavailable.", confidence: "unverified" };
        }
      },
    }),
    get_app_howto: tool({
      description: "Read the Hotel Care workflow reference when the user asks how to use the app.",
      inputSchema: jsonSchema<{ topic: string }>({
        type: "object",
        properties: { topic: { type: "string" } },
        required: ["topic"],
        additionalProperties: false,
      }),
      execute: async ({ topic }) => ({ topic, guide: HOW_TO }),
    }),
    find_destination: tool({
      description:
        "Find which Hotel Care screen the user needs. Returns destination ids this user is allowed to open, with the walkthrough available for each. Call this before offering to take the user somewhere.",
      inputSchema: jsonSchema<{ query: string }>({
        type: "object",
        properties: { query: { type: "string", description: "What the user wants to do or see" } },
        required: ["query"],
        additionalProperties: false,
      }),
      execute: async ({ query }) => ({ query, destinations: capabilities.destinations }),
    }),
    get_training_guide: tool({
      description:
        "Read the step titles of a Hotel Care walkthrough so you can explain the workflow accurately, or decide whether to offer a 'Show me' walkthrough.",
      inputSchema: jsonSchema<{ slug: string | null }>({
        type: "object",
        properties: { slug: { type: ["string", "null"], description: "Guide slug, or null to list all available guides" } },
        required: ["slug"],
        additionalProperties: false,
      }),
      execute: async ({ slug }) => {
        if (!slug) return { guides: capabilities.guides.map((g) => ({ slug: g.slug, name: g.name, description: g.description })) };
        const guide = capabilities.guides.find((g) => g.slug === slug);
        return guide ? { guide } : { error: "That walkthrough is not available for this user", guides: capabilities.guides.map((g) => g.slug) };
      },
    }),
    suggest_actions: tool({
      description:
        "Offer the user buttons under your answer: open a screen, start a walkthrough, or report a problem to the Hotel Care team. Use destination ids from find_destination and guide slugs from get_training_guide. Call this at most once per answer, with at most three actions, and still explain the answer in your message.",
      inputSchema: jsonSchema<{ actions: unknown[] }>({
        type: "object",
        properties: {
          actions: {
            type: "array",
            description:
              "Up to 3 actions. navigate: {type,label,destination}. guide: {type,label,guide,destination}. report_issue: {type,label,title,summary,category,severity}.",
            items: { type: "object", additionalProperties: true },
          },
        },
        required: ["actions"],
        additionalProperties: false,
      }),
      execute: async ({ actions }) => {
        const allowed = new Set(capabilities.destinations.map((d) => d.id));
        const guides = new Set(capabilities.guides.map((g) => g.slug));
        const cleaned = (Array.isArray(actions) ? actions : [])
          .slice(0, 3)
          .map((raw: any) => {
            if (raw?.type === "navigate" && allowed.has(raw.destination)) {
              return { type: "navigate", label: String(raw.label ?? "").slice(0, 40), destination: raw.destination };
            }
            if (raw?.type === "guide" && guides.has(raw.guide)) {
              return {
                type: "guide",
                label: String(raw.label ?? "Show me").slice(0, 40),
                guide: raw.guide,
                destination: allowed.has(raw.destination) ? raw.destination : undefined,
              };
            }
            if (raw?.type === "report_issue") {
              return {
                type: "report_issue",
                label: String(raw.label ?? "Report this").slice(0, 40),
                title: String(raw.title ?? "Problem reported from the assistant").slice(0, 200),
                summary: String(raw.summary ?? "").slice(0, 2000),
                category: String(raw.category ?? "other").slice(0, 40),
                severity: ["low", "normal", "high", "urgent"].includes(raw.severity) ? raw.severity : "normal",
              };
            }
            return null;
          })
          .filter(Boolean);
        return { kind: "assistant_actions", actions: cleaned };
      },
    }),
  };


  if (scopes.has("revenue")) {
    tools.get_revenue_metrics = tool({
      description:
        "Revenue metrics (occupancy, ADR, revenue, rooms sold/available) per stay date for one or all of the user's hotels.",
      inputSchema: jsonSchema<{ hotelId: string | null; startDate: string | null; endDate: string | null }>(
        hotelArgSchema(
          {
            startDate: { type: ["string", "null"], description: "YYYY-MM-DD or null for today" },
            endDate: { type: ["string", "null"], description: "YYYY-MM-DD or null for the same day" },
          },
          ["startDate", "endDate"],
        ),
      ),
      execute: async ({ hotelId, startDate, endDate }) => {
        const from = startDate ?? today();
        const to = endDate ?? from;
        const picked = await revenueDatasets(hotelId);
        const out: any[] = [];
        const missing: string[] = [];
        let lastSync: string | null = null;
        for (const { hotel, dataset } of picked) {
          if (!dataset) {
            missing.push(hotel.hotel_name);
            continue;
          }
          if (!lastSync || (dataset.lastSyncAt ?? "") > lastSync) lastSync = dataset.lastSyncAt;
          const days = dataset.metricsFor(from, to).map((m) => ({
            stay_date: m.stay_date,
            rooms_sold: m.roomsSold,
            rooms_available: m.roomsAvailable,
            rooms_left: m.roomsLeft,
            occupancy_pct: m.occupancyPct,
            adr: m.adrEur,
            revenue: m.revenueEur,
            revpar: m.revparEur,
            net_pickup: m.netPickup,
            has_data: m.hasData,
          }));
          out.push({ hotel_id: hotel.hotel_id, hotel_name: hotel.hotel_name, currency: dataset.currency, days });
        }
        if (out.length === 0) {
          return envelope(
            { from, to, hotels: [], missing },
            { source: "revenue_published_payload", confidence: "unverified", note: "No completed Revenue dataset, so these figures cannot be verified." },
          );
        }
        return envelope(
          { from, to, hotels: out, missing },
          {
            source: "revenue_published_payload",
            lastSyncAt: lastSync,
            ...(missing.length ? { confidence: "partial" as const, note: `No completed dataset for: ${missing.join(", ")}.` } : {}),
          },
        );
      },
    });

    tools.get_pickup_and_pace = tool({
      description:
        "Booking pace: rooms sold, rooms left and net pickup by stay date from the published Revenue dataset, plus the automation engine's recorded pickup actions.",
      inputSchema: jsonSchema<{ hotelId: string | null; days: number | null }>(
        hotelArgSchema({ days: { type: ["number", "null"], description: "Horizon in days from today, default 60, max 365" } }, ["days"]),
      ),
      execute: async ({ hotelId, days }) => {
        const horizon = Math.min(Math.max(Number(days ?? 60), 1), 365);
        const from = today();
        const to = new Date(Date.now() + horizon * 86_400_000).toISOString().slice(0, 10);
        const picked = await revenueDatasets(hotelId);
        const ids = picked.map((p) => p.hotel.hotel_id);
        const actions = await service
          .from("revenue_pickup_actions")
          .select("hotel_id,stay_date,trigger_kind,trigger_detail,delta_eur,old_price,new_price,occurred_at")
          .eq("organization_slug", orgSlug)
          .in("hotel_id", ids)
          .gte("stay_date", from)
          .lte("stay_date", to)
          .order("occurred_at", { ascending: false })
          .limit(300);
        const out: any[] = [];
        const missing: string[] = [];
        let lastSync: string | null = null;
        for (const { hotel, dataset } of picked) {
          if (!dataset) {
            missing.push(hotel.hotel_name);
            continue;
          }
          if (!lastSync || (dataset.lastSyncAt ?? "") > lastSync) lastSync = dataset.lastSyncAt;
          const pace = dataset.metricsFor(from, to).map((m) => ({
            stay_date: m.stay_date,
            rooms_sold: m.roomsSold,
            rooms_available: m.roomsAvailable,
            rooms_left: m.roomsLeft,
            occupancy_pct: m.occupancyPct,
            adr: m.adrEur,
            net_pickup: m.netPickup,
            pickup_gained: m.pickupGained,
            pickup_lost: m.pickupLost,
            has_data: m.hasData,
          }));
          out.push({ hotel_id: hotel.hotel_id, hotel_name: hotel.hotel_name, currency: dataset.currency, pace });
        }
        if (out.length === 0) {
          return envelope(
            { from, to, hotels: [], missing },
            { source: "revenue_published_payload", confidence: "unverified", note: "No completed Revenue dataset, so pace cannot be verified." },
          );
        }
        return envelope(
          { from, to, hotels: out, missing, recentPickupActions: actions.data ?? [] },
          {
            source: "revenue_published_payload",
            lastSyncAt: lastSync,
            ...(missing.length ? { confidence: "partial" as const, note: `No completed dataset for: ${missing.join(", ")}.` } : {}),
          },
        );
      },

    });

    tools.get_rate_calendar = tool({
      description:
        "Current prices, min-stay and restrictions per stay date, room type and occupancy as last captured from the PMS.",
      inputSchema: jsonSchema<{ hotelId: string | null; startDate: string | null; endDate: string | null }>(
        hotelArgSchema(
          {
            startDate: { type: ["string", "null"], description: "YYYY-MM-DD or null for today" },
            endDate: { type: ["string", "null"], description: "YYYY-MM-DD or null for 30 days out" },
          },
          ["startDate", "endDate"],
        ),
      ),
      execute: async ({ hotelId, startDate, endDate }) => {
        const from = startDate ?? today();
        const to = endDate ?? new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
        const picked = await revenueDatasets(hotelId);
        const out: any[] = [];
        const missing: string[] = [];
        let lastSync: string | null = null;
        for (const { hotel, dataset } of picked) {
          if (!dataset) {
            missing.push(hotel.hotel_name);
            continue;
          }
          if (!lastSync || (dataset.lastSyncAt ?? "") > lastSync) lastSync = dataset.lastSyncAt;
          const rates = (dataset.payload.rates ?? [])
            .filter((r) => r.stay_date >= from && r.stay_date <= to)
            .map((r) => ({
              stay_date: r.stay_date,
              room_type_name: r.room_type_name,
              occupancy: r.occupancy,
              price: r.price,
              currency: r.currency || dataset.currency,
              captured_at: r.captured_at ?? null,
            }));
          out.push({ hotel_id: hotel.hotel_id, hotel_name: hotel.hotel_name, currency: dataset.currency, rates });
        }
        if (out.length === 0) {
          return envelope(
            { from, to, hotels: [], missing },
            { source: "revenue_published_payload", confidence: "unverified", note: "No completed Revenue dataset, so current rates cannot be verified." },
          );
        }
        return envelope(
          { from, to, hotels: out, missing },
          {
            source: "revenue_published_payload",
            lastSyncAt: lastSync,
            ...(missing.length ? { confidence: "partial" as const, note: `No completed dataset for: ${missing.join(", ")}.` } : {}),
          },
        );
      },

    });

    tools.get_automation_rules = tool({
      description:
        "Read the current revenue pickup automation configuration for the user's hotels, including the last run status and error.",
      inputSchema: jsonSchema<{ hotelId: string | null }>(hotelArgSchema({}, [])),
      execute: async ({ hotelId }) => {
        const ids = resolve(hotelId);
        const { data, error } = await service
          .from("revenue_pickup_automation_rules")
          .select("*")
          .eq("organization_slug", orgSlug)
          .in("hotel_id", ids)
          .limit(50);
        if (error) throw new Error(`Automation rule lookup failed: ${error.message}`);
        return {
          changeableFields: Object.entries(AUTOMATION_FIELDS).map(([field, spec]) => ({
            field,
            label: spec.label,
            ...(spec.kind === "number" ? { min: spec.min, max: spec.max } : { type: "boolean" }),
          })),
          rules: data ?? [],
        };
      },
    });

    tools.get_automation_activity = tool({
      description:
        "Recent automation decisions: what the engine changed, for which stay date and room type, why, and whether the push succeeded.",
      inputSchema: jsonSchema<{ hotelId: string | null; limit: number | null }>(
        hotelArgSchema({ limit: { type: ["number", "null"], description: "Rows to return, default 50, max 200" } }, ["limit"]),
      ),
      execute: async ({ hotelId, limit }) => {
        const ids = resolve(hotelId);
        const take = Math.min(Math.max(Number(limit ?? 50), 1), 200);
        const { data, error } = await service
          .from("revenue_pickup_automation_actions")
          .select(
            "hotel_id,stay_date,room_type_name,occupancy,old_price,new_price,increase_amount,decision_type,decision_reason,reason_detail,net_pickup,status,push_error,created_at",
          )
          .eq("organization_slug", orgSlug)
          .in("hotel_id", ids)
          .order("created_at", { ascending: false })
          .limit(take);
        if (error) throw new Error(`Automation activity lookup failed: ${error.message}`);
        return { actions: data ?? [] };
      },
    });

    tools.get_demand_context = tool({
      description: "Events and demand ratings for a date range, to justify surcharges or markdowns.",
      inputSchema: jsonSchema<{ hotelId: string | null; startDate: string | null; endDate: string | null }>(
        hotelArgSchema(
          {
            startDate: { type: ["string", "null"], description: "YYYY-MM-DD or null for today" },
            endDate: { type: ["string", "null"], description: "YYYY-MM-DD or null for 90 days out" },
          },
          ["startDate", "endDate"],
        ),
      ),
      execute: async ({ hotelId, startDate, endDate }) => {
        const ids = resolve(hotelId);
        const from = startDate ?? today();
        const to = endDate ?? new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
        const [events, ratings] = await Promise.all([
          service
            .from("demand_events")
            .select("hotel_id,title,category,city,event_date,end_date,expected_impact,surcharge_eur,confidence,approved")
            .eq("organization_slug", orgSlug)
            .in("hotel_id", ids)
            .gte("event_date", from)
            .lte("event_date", to)
            .order("event_date")
            .limit(400),
          service
            .from("revenue_demand_ratings")
            .select("hotel_id,stay_date,rating,reason,event_name")
            .eq("organization_slug", orgSlug)
            .in("hotel_id", ids)
            .gte("stay_date", from)
            .lte("stay_date", to)
            .order("stay_date")
            .limit(400),
        ]);
        if (events.error) throw new Error(`Event lookup failed: ${events.error.message}`);
        if (ratings.error) throw new Error(`Demand rating lookup failed: ${ratings.error.message}`);
        return { from, to, events: events.data ?? [], ratings: ratings.data ?? [] };
      },
    });

    if (canChangeAutomation(profile.role)) {
      tools.propose_automation_change = tool({
        description:
          "Propose a change to a hotel's revenue automation configuration. This DOES NOT change anything: it returns a before/after diff the user must approve with the Apply button. Call it after you have read the current rules and the supporting data, and explain your reasoning in the message.",
        inputSchema: jsonSchema<{ hotelId: string; changes: Record<string, unknown>; reason: string }>({
          type: "object",
          properties: {
            hotelId: { type: "string", description: "The hotel id the change applies to" },
            reason: { type: "string", description: "Why this change helps occupancy or ADR, in one or two sentences" },
            changes: {
              type: "object",
              description: "Map of allowed rule field -> new value. Read get_automation_rules for the allowed fields.",
              additionalProperties: true,
            },
          },
          required: ["hotelId", "changes", "reason"],
          additionalProperties: false,
        }),
        execute: async ({ hotelId, changes, reason }) => {
          const ids = resolve(hotelId);
          if (ids.length !== 1) throw new Error("Name exactly one hotel for an automation change");
          const validated = validateChanges(changes);
          if (!validated.ok) throw new Error(validated.error);
          const { data: rule, error } = await service
            .from("revenue_pickup_automation_rules")
            .select("*")
            .eq("organization_slug", orgSlug)
            .eq("hotel_id", ids[0])
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (error) throw new Error(`Automation rule lookup failed: ${error.message}`);
          if (!rule) throw new Error(`No automation configuration exists yet for ${ids[0]}`);
          const diff = validated.changes
            .map((change) => ({
              field: change.field,
              label: change.label,
              from: rule[change.field] ?? null,
              to: change.value,
            }))
            .filter((row) => String(row.from) !== String(row.to));
          if (!diff.length) throw new Error("Those values are already configured — nothing to change");
          return {
            kind: "automation_change_proposal",
            ruleId: rule.id,
            hotelId: ids[0],
            hotelName: hotels.find((h) => h.hotel_id === ids[0])?.hotel_name ?? ids[0],
            currency: rule.currency ?? "EUR",
            reason,
            diff,
            requiresApproval: true,
          };
        },
      });
    }
  }

  if (scopes.has("revenue") || scopes.has("reception")) {
    tools.get_occupancy = tool({
      description:
        "Occupancy for a date or date range: rooms sold, rooms available and occupancy percentage. Use this whenever occupancy is asked about.",
      inputSchema: jsonSchema<{ hotelId: string | null; startDate: string | null; endDate: string | null }>(
        hotelArgSchema(
          {
            startDate: { type: ["string", "null"], description: "YYYY-MM-DD or null for today" },
            endDate: { type: ["string", "null"], description: "YYYY-MM-DD or null for the same day" },
          },
          ["startDate", "endDate"],
        ),
      ),
      execute: async ({ hotelId, startDate, endDate }) => {
        const from = startDate ?? today();
        const to = endDate ?? from;
        const picked = await revenueDatasets(hotelId);
        const out: any[] = [];
        const missing: string[] = [];
        let lastSync: string | null = null;
        for (const { hotel, dataset } of picked) {
          if (!dataset) {
            missing.push(hotel.hotel_name);
            continue;
          }
          if (!lastSync || (dataset.lastSyncAt ?? "") > lastSync) lastSync = dataset.lastSyncAt;
          const days = dataset.metricsFor(from, to).map((m) => ({
            stay_date: m.stay_date,
            rooms_sold: m.roomsSold,
            rooms_available: m.roomsAvailable,
            rooms_left: m.roomsLeft,
            occupancy_pct: m.occupancyPct,
            has_data: m.hasData,
          }));
          const sold = days.reduce((s, d) => s + d.rooms_sold, 0);
          const avail = days.reduce((s, d) => s + d.rooms_available, 0);
          out.push({
            hotel_id: hotel.hotel_id,
            hotel_name: hotel.hotel_name,
            rooms_available: dataset.roomsAvailable,
            days,
            totals: { rooms_sold: sold, rooms_available: avail, occupancy_pct: avail ? Math.round((sold / avail) * 1000) / 10 : null },
          });
        }
        if (out.length === 0) {
          return envelope(
            { from, to, hotels: [], missing },
            {
              source: "revenue_published_payload",
              confidence: "unverified",
              note: "No completed Revenue dataset is available for these properties, so occupancy cannot be verified right now.",
            },
          );
        }
        return envelope(
          { from, to, hotels: out, missing },
          {
            source: "revenue_published_payload",
            lastSyncAt: lastSync,
            ...(missing.length ? { confidence: "partial" as const, note: `No completed dataset for: ${missing.join(", ")}.` } : {}),
          },
        );
      },

    });
  }

  // Shared housekeeping snapshot: the same picture the operations board shows,
  // so the model never has to guess from bare status counts.
  const housekeepingSnapshot = async (ids: string[], date: string) => {
    const names = hotels.filter((h) => ids.includes(h.hotel_id)).map((h) => h.hotel_name);
    const hotelKeys = [...new Set([...ids, ...names])];
    const rooms = await service
      .from("rooms")
      .select(
        "id,room_number,room_name,hotel,floor_number,status,is_checkout_room,is_dnd,towel_change_required,linen_change_required,notes,guest_nights_stayed,last_cleaned_at,checkout_time,pms_metadata",
      )
      .eq("organization_slug", orgSlug)
      .in("hotel", hotelKeys)
      .limit(2000);
    if (rooms.error) throw new Error(`Room lookup failed: ${rooms.error.message}`);
    const roomRows = rooms.data ?? [];
    const roomIds = roomRows.map((room: any) => room.id);
    const assignments = roomIds.length
      ? await service
          .from("room_assignments")
          .select(
            "id,room_id,assigned_to,status,assignment_type,priority,started_at,completed_at,is_dnd,ready_to_clean,supervisor_approved,notes",
          )
          .eq("organization_slug", orgSlug)
          .in("room_id", roomIds)
          .eq("assignment_date", date)
          .limit(2000)
      : { data: [], error: null };
    if (assignments.error) throw new Error(`Assignment lookup failed: ${assignments.error.message}`);
    const assignmentRows = assignments.data ?? [];

    const staffIds = [...new Set(assignmentRows.map((row: any) => row.assigned_to).filter(Boolean))];
    const staff = staffIds.length
      ? await service.from("profiles").select("id,full_name,nickname,role").in("id", staffIds).limit(300)
      : { data: [] };
    const staffName = new Map(
      (staff.data ?? []).map((person: any) => [person.id, person.full_name || person.nickname || "Unnamed staff"]),
    );

    const openNotes = roomIds.length
      ? await service
          .from("housekeeping_notes")
          .select("room_id,note_type,content")
          .eq("organization_slug", orgSlug)
          .in("room_id", roomIds)
          .eq("is_resolved", false)
          .limit(500)
      : { data: [] };
    const notesByRoom = new Map<string, any[]>();
    for (const note of openNotes.data ?? []) {
      const list = notesByRoom.get(note.room_id) ?? [];
      list.push({ type: note.note_type, note: String(note.content ?? "").slice(0, 160) });
      notesByRoom.set(note.room_id, list);
    }

    const byRoom = new Map<string, any>();
    for (const row of assignmentRows) {
      // Keep the most advanced assignment per room (completed > in progress > assigned).
      const rank = (s: string) => (s === "completed" ? 3 : s === "in_progress" ? 2 : 1);
      const current = byRoom.get(row.room_id);
      if (!current || rank(row.status) >= rank(current.status)) byRoom.set(row.room_id, row);
    }

    const pmsRtcToday = (meta: any) => {
      if (!meta) return false;
      if (!(meta.checkedOutToday === true || meta.readyToClean === true)) return false;
      const stamp = String(meta.readyToCleanDate ?? meta.checkedOutAt ?? "").slice(0, 10);
      return stamp === date;
    };

    const roomView = roomRows.map((room: any) => {
      const meta = (room.pms_metadata ?? {}) as any;
      const assignment = byRoom.get(room.id);
      const isCheckout = room.is_checkout_room === true || meta.scheduledDepartureToday === true;
      return {
        room: room.room_number,
        hotel: room.hotel,
        floor: room.floor_number ?? null,
        status: room.status,
        type: isCheckout ? "checkout" : "daily",
        assignedTo: assignment?.assigned_to ? staffName.get(assignment.assigned_to) ?? "Unknown staff" : null,
        assignmentStatus: assignment?.status ?? null,
        startedAt: assignment?.started_at ?? null,
        completedAt: assignment?.completed_at ?? null,
        approved: assignment?.supervisor_approved === true,
        dnd: room.is_dnd === true || assignment?.is_dnd === true,
        noService: meta.noService === true || meta.no_service === true,
        readyToClean: pmsRtcToday(meta) || assignment?.ready_to_clean === true,
        departsTomorrow: meta.departsTomorrow === true || meta.scheduledDepartureTomorrow === true,
        towelChange: room.towel_change_required === true,
        linenChange: room.linen_change_required === true,
        nightsStayed: room.guest_nights_stayed ?? null,
        notes: notesByRoom.get(room.id) ?? [],
        lastCleanedAt: room.last_cleaned_at ?? null,
      };
    });

    const statusCounts: Record<string, number> = {};
    for (const room of roomRows) statusCounts[room.status] = (statusCounts[room.status] ?? 0) + 1;

    const byPerson = new Map<string, any>();
    for (const row of assignmentRows) {
      const key = row.assigned_to ?? "unassigned";
      const name = row.assigned_to ? staffName.get(row.assigned_to) ?? "Unknown staff" : "Unassigned";
      const entry = byPerson.get(key) ?? { staff: name, assigned: 0, completed: 0, inProgress: 0, notStarted: 0, rooms: [] };
      entry.assigned += 1;
      if (row.status === "completed") entry.completed += 1;
      else if (row.status === "in_progress") entry.inProgress += 1;
      else entry.notStarted += 1;
      const roomNumber = roomRows.find((r: any) => r.id === row.room_id)?.room_number;
      if (roomNumber) entry.rooms.push(roomNumber);
      byPerson.set(key, entry);
    }
    const team = [...byPerson.values()].map((entry) => ({
      ...entry,
      progressPct: entry.assigned ? Math.round((entry.completed / entry.assigned) * 100) : 0,
    }));

    const dirty = roomView.filter((r) => r.status === "dirty");
    const checkout = roomView.filter((r) => r.type === "checkout");
    const daily = roomView.filter((r) => r.type === "daily");
    const totals = {
      rooms: roomView.length,
      dirty: dirty.length,
      clean: roomView.filter((r) => r.status === "clean").length,
      inProgress: roomView.filter((r) => r.assignmentStatus === "in_progress").length,
      completedToday: roomView.filter((r) => r.assignmentStatus === "completed").length,
      notStarted: roomView.filter((r) => r.assignmentStatus === "assigned").length,
      unassignedDirty: dirty.filter((r) => !r.assignedTo).length,
      dnd: roomView.filter((r) => r.dnd).length,
      noService: roomView.filter((r) => r.noService).length,
      checkoutRooms: checkout.length,
      dailyRooms: daily.length,
    };

    return {
      date,
      hotels: hotels.filter((h) => ids.includes(h.hotel_id)).map((h) => ({ id: h.hotel_id, name: h.hotel_name })),
      totals,
      progressPct: assignmentRows.length
        ? Math.round((assignmentRows.filter((a: any) => a.status === "completed").length / assignmentRows.length) * 100)
        : 0,
      team,
      checkoutRooms: checkout,
      dailyRooms: daily,
      unassignedDirtyRooms: dirty.filter((r) => !r.assignedTo).map((r) => r.room),
      attentionRooms: roomView.filter((r) => r.dnd || r.noService || (r.notes?.length ?? 0) > 0),
      dataFreshness:
        assignmentRows.length === 0
          ? "No cleaning assignments exist for this date yet — rooms may not have been assigned."
          : null,
    };
  };

  if (scopes.has("housekeeping")) {
    tools.get_housekeeping_status = tool({
      description:
        "The full housekeeping picture for a date: totals, checkout vs daily rooms, every room with its status, cleaner, DND / no-service / towel / linen / note flags, per-housekeeper progress, and the unassigned dirty rooms. Use this for any housekeeping question and answer with these exact numbers, room numbers and names.",
      inputSchema: jsonSchema<{ hotelId: string | null; date: string | null }>(
        hotelArgSchema({ date: { type: ["string", "null"], description: "YYYY-MM-DD or null for today" } }, ["date"]),
      ),
      execute: async ({ hotelId, date }) => housekeepingSnapshot(resolve(hotelId), date ?? today()),
    });
  }


  const maintenanceTickets = async (ids: string[], status: string | null) => {
    const names = hotels.filter((h) => ids.includes(h.hotel_id)).map((h) => h.hotel_name);
    let query = service
      .from("tickets")
      .select(
        "id,ticket_number,title,description,status,priority,room_number,hotel,department,category,sla_due_date,created_at,closed_at,assigned_to,on_hold,hold_reason,pending_supervisor_approval",
      )
      .eq("organization_slug", orgSlug)
      .in("hotel", [...new Set([...ids, ...names])])
      .order("created_at", { ascending: false })
      .limit(200);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw new Error(`Maintenance lookup failed: ${error.message}`);
    const rows = data ?? [];
    const assignees = [...new Set(rows.map((t: any) => t.assigned_to).filter(Boolean))];
    const staff = assignees.length
      ? await service.from("profiles").select("id,full_name,nickname").in("id", assignees).limit(200)
      : { data: [] };
    const nameOf = new Map((staff.data ?? []).map((p: any) => [p.id, p.full_name || p.nickname || "Unnamed staff"]));
    const now = Date.now();
    const tickets = rows.map((t: any) => {
      const due = t.sla_due_date ? new Date(t.sla_due_date).getTime() : null;
      const open = t.status !== "completed";
      return {
        ...t,
        assigned_to: t.assigned_to ? nameOf.get(t.assigned_to) ?? "Unknown staff" : null,
        ageHours: t.created_at ? Math.round((now - new Date(t.created_at).getTime()) / 3_600_000) : null,
        slaBreached: Boolean(open && due && due < now),
        slaAtRisk: Boolean(open && due && due >= now && due - now < 4 * 3_600_000),
      };
    });
    return {
      tickets,
      counts: {
        total: tickets.length,
        open: tickets.filter((t: any) => t.status === "open").length,
        inProgress: tickets.filter((t: any) => t.status === "in_progress").length,
        completed: tickets.filter((t: any) => t.status === "completed").length,
        slaBreached: tickets.filter((t: any) => t.slaBreached).length,
        slaAtRisk: tickets.filter((t: any) => t.slaAtRisk).length,
        onHold: tickets.filter((t: any) => t.on_hold).length,
      },
    };
  };

  if (scopes.has("maintenance")) {
    tools.get_maintenance_tickets = tool({
      description:
        "Maintenance tickets for the user's authorized hotels, with assignee names, ticket age, SLA breached / at-risk flags and on-hold state. Answer with the ticket numbers, rooms and counts it returns.",
      inputSchema: jsonSchema<{ hotelId: string | null; status: string | null }>(
        hotelArgSchema({ status: { type: ["string", "null"], description: "open, in_progress, completed, or null" } }, ["status"]),
      ),
      execute: async ({ hotelId, status }) => maintenanceTickets(resolve(hotelId), status),
    });
  }


  const receptionOverview = async (ids: string[], date: string | null) => {
    {
      {
        const target = date ?? today();

        // The PMS daily overview repeats a stay once per business date, so the
        // same arrival shows up under several rows. Dedupe by stay.
        const snapshotQuery = service
          .from("daily_overview_snapshots")
          .select("hotel_id,business_date,room_label,room_number,arrival_date,departure_date,status,pax,breakfast")
          .eq("organization_slug", orgSlug)
          .in("hotel_id", ids)
          .or(`arrival_date.eq.${target},departure_date.eq.${target},business_date.eq.${target}`)
          .limit(4000);
        const breakfastQuery = service
          .from("breakfast_roster")
          .select("id,hotel_id,stay_date,breakfast_count")
          .eq("organization_slug", orgSlug)
          .in("hotel_id", ids)
          .eq("stay_date", target)
          .limit(2000);
        const reservationsQuery = service
          .from("reservations")
          .select("id,hotel_id,check_in_date,check_out_date,status")
          .eq("organization_slug", orgSlug)
          .in("hotel_id", ids)
          .or(`check_in_date.eq.${target},check_out_date.eq.${target}`)
          .limit(2000);
        const [snapshots, breakfast, reservations] = await Promise.all([
          snapshotQuery,
          breakfastQuery,
          reservationsQuery,
        ]);
        if (snapshots.error) throw new Error(`PMS overview lookup failed: ${snapshots.error.message}`);
        if (breakfast.error) throw new Error(`Breakfast lookup failed: ${breakfast.error.message}`);

        const seen = new Set<string>();
        const stays: any[] = [];
        for (const row of snapshots.data ?? []) {
          const key = [row.hotel_id, row.room_label ?? row.room_number, row.arrival_date, row.departure_date].join("|");
          if (seen.has(key)) continue;
          seen.add(key);
          stays.push(row);
        }
        const arrivals = stays.filter((s) => s.arrival_date === target);
        const departures = stays.filter((s) => s.departure_date === target);
        const inHouse = stays.filter(
          (s) => s.arrival_date && s.departure_date && s.arrival_date <= target && s.departure_date > target,
        );
        const brief = (rows: any[]) =>
          rows
            .map((s) => ({
              room: s.room_label ?? s.room_number ?? null,
              pax: Number(s.pax) || 0,
              arrival: s.arrival_date,
              departure: s.departure_date,
              status: s.status ?? null,
            }))
            .sort((a, b) => String(a.room).localeCompare(String(b.room)));
        const pax = (rows: any[]) => rows.reduce((sum, s) => sum + (Number(s.pax) || 0), 0);

        const reservationRows = reservations.error ? [] : (reservations.data ?? []);
        return {
          date: target,
          hotels: ids,
          source: stays.length > 0 ? "previo_daily_overview" : "reservations_table",
          arrivals: stays.length > 0 ? arrivals.length : reservationRows.filter((r: any) => r.check_in_date === target).length,
          arrivalGuests: pax(arrivals),
          departures:
            stays.length > 0 ? departures.length : reservationRows.filter((r: any) => r.check_out_date === target).length,
          departureGuests: pax(departures),
          inHouseRooms: inHouse.length,
          inHouseGuests: pax(inHouse),
          arrivalRooms: brief(arrivals).slice(0, 60),
          departureRooms: brief(departures).slice(0, 60),
          breakfastCount: (breakfast.data ?? []).reduce(
            (sum: number, row: any) => sum + (Number(row.breakfast_count) || 0),
            0,
          ),
          note:
            stays.length === 0
              ? "No PMS daily-overview rows for this date — the nightly Previo sync may not have run yet, so counts may be incomplete."
              : null,
        };
      }
    }
  };

  if (scopes.has("reception")) {
    tools.get_reception_overview = tool({
      description:
        "Arrivals, departures, in-house rooms and breakfast counts for a date from the live PMS (Previo) daily overview, inside the user's authorized hotels only. Room-level rows, no guest personal details.",
      inputSchema: jsonSchema<{ hotelId: string | null; date: string | null }>(
        hotelArgSchema({ date: { type: ["string", "null"], description: "YYYY-MM-DD or null for today" } }, ["date"]),
      ),
      execute: async ({ hotelId, date }) => receptionOverview(resolve(hotelId), date),
    });
  }

  if (scopes.has("housekeeping")) {
    tools.get_housekeeping_briefing = tool({
      description:
        "One supervisor-grade briefing for a date: the full housekeeping board, live PMS arrivals/departures/in-house, and open maintenance tickets. Use this for broad questions like 'how is housekeeping doing today' or 'what's the situation today'.",
      inputSchema: jsonSchema<{ hotelId: string | null; date: string | null }>(
        hotelArgSchema({ date: { type: ["string", "null"], description: "YYYY-MM-DD or null for today" } }, ["date"]),
      ),
      execute: async ({ hotelId, date }) => {
        const ids = resolve(hotelId);
        const target = date ?? today();
        const [housekeeping, reception, maintenance] = await Promise.all([
          housekeepingSnapshot(ids, target).catch((e) => ({ error: String(e?.message ?? e) })),
          receptionOverview(ids, target).catch((e) => ({ error: String(e?.message ?? e) })),
          maintenanceTickets(ids, null).catch((e) => ({ error: String(e?.message ?? e) })),
        ]);
        return { date: target, housekeeping, reception, maintenance };
      },
    });
  }


  if (scopes.has("housekeeping")) {
    tools.get_housekeeping_team = tool({
      description:
        "List the housekeepers and supervisors at a property, with their exact staff id, so a room can be assigned to a named person. Never share phone numbers or emails.",
      inputSchema: jsonSchema<{ hotelId: string | null }>(hotelArgSchema({}, [])),
      execute: async ({ hotelId }) => {
        const ids = resolve(hotelId);
        const names = hotels.filter((h) => ids.includes(h.hotel_id)).map((h) => h.hotel_name);
        const { data, error } = await service
          .from("profiles")
          .select("id,full_name,nickname,role,assigned_hotel")
          .eq("organization_slug", orgSlug)
          .in("assigned_hotel", [...new Set([...ids, ...names])])
          .in("role", ["housekeeping", "housekeeping_manager", "supervisor"])
          .is("deleted_at", null)
          .order("full_name")
          .limit(300);
        if (error) throw new Error(`Team lookup failed: ${error.message}`);
        return { staff: data ?? [] };
      },
    });

    tools.get_lost_and_found = tool({
      description: "Read recent lost-and-found items for the user's authorized properties.",
      inputSchema: jsonSchema<{ hotelId: string | null; status: string | null }>(
        hotelArgSchema({ status: { type: ["string", "null"], description: "pending, claimed, or null for all" } }, ["status"]),
      ),
      execute: async ({ hotelId, status }) => {
        const ids = resolve(hotelId);
        const names = hotels.filter((h) => ids.includes(h.hotel_id)).map((h) => h.hotel_name);
        const rooms = await service
          .from("rooms")
          .select("id,room_number")
          .eq("organization_slug", orgSlug)
          .in("hotel", [...new Set([...ids, ...names])])
          .limit(2000);
        if (rooms.error) throw new Error(`Room lookup failed: ${rooms.error.message}`);
        const roomIds = (rooms.data ?? []).map((room: any) => room.id);
        if (!roomIds.length) return { items: [] };
        let query = service
          .from("lost_and_found")
          .select("id,room_id,item_description,status,found_date,notes")
          .eq("organization_slug", orgSlug)
          .in("room_id", roomIds)
          .order("found_date", { ascending: false })
          .limit(100);
        if (status) query = query.eq("status", status);
        const { data, error } = await query;
        if (error) throw new Error(`Lost and found lookup failed: ${error.message}`);
        const roomNumbers = new Map((rooms.data ?? []).map((room: any) => [room.id, room.room_number]));
        return { items: (data ?? []).map((row: any) => ({ ...row, room_number: roomNumbers.get(row.room_id) ?? null })) };
      },
    });

    tools.get_staff_on_duty = tool({
      description:
        "Who is signed in for work on a date at the user's authorized properties, with names, roles, sign-in/out times and who has not signed in yet. Staff must be signed in before they can start a room.",
      inputSchema: jsonSchema<{ hotelId: string | null; date: string | null }>(
        hotelArgSchema({ date: { type: ["string", "null"], description: "YYYY-MM-DD or null for today" } }, ["date"]),
      ),
      execute: async ({ hotelId, date }) => {
        const ids = resolve(hotelId);
        const names = hotels.filter((h) => ids.includes(h.hotel_id)).map((h) => h.hotel_name);
        const target = date ?? today();
        // staff_attendance has no hotel column — scope it through the profiles
        // of the authorized properties instead.
        const staff = await service
          .from("profiles")
          .select("id,full_name,nickname,role,assigned_hotel")
          .eq("organization_slug", orgSlug)
          .in("assigned_hotel", [...new Set([...ids, ...names])])
          .is("deleted_at", null)
          .limit(500);
        if (staff.error) throw new Error(`Staff lookup failed: ${staff.error.message}`);
        const staffRows = staff.data ?? [];
        const staffIds = staffRows.map((p: any) => p.id);
        const attendance = staffIds.length
          ? await service
              .from("staff_attendance")
              .select("user_id,work_date,check_in_time,check_out_time,status,break_type,break_started_at")
              .eq("organization_slug", orgSlug)
              .in("user_id", staffIds)
              .eq("work_date", target)
              .limit(1000)
          : { data: [], error: null };
        if (attendance.error) throw new Error(`Attendance lookup failed: ${attendance.error.message}`);
        const byUser = new Map((attendance.data ?? []).map((row: any) => [row.user_id, row]));
        const people = staffRows.map((person: any) => {
          const record = byUser.get(person.id);
          return {
            staff: person.full_name || person.nickname || "Unnamed staff",
            role: person.role,
            hotel: person.assigned_hotel,
            signedIn: Boolean(record && !record.check_out_time),
            checkInTime: record?.check_in_time ?? null,
            checkOutTime: record?.check_out_time ?? null,
            attendanceStatus: record?.status ?? "not_signed_in",
            onBreak: Boolean(record?.break_started_at && !record?.check_out_time && record?.break_type),
          };
        });
        return {
          date: target,
          onDuty: people.filter((p) => p.signedIn),
          finishedShift: people.filter((p) => !p.signedIn && p.checkInTime),
          notSignedIn: people.filter((p) => !p.checkInTime).map((p) => ({ staff: p.staff, role: p.role })),
          counts: {
            onDuty: people.filter((p) => p.signedIn).length,
            onBreak: people.filter((p) => p.onBreak).length,
            notSignedIn: people.filter((p) => !p.checkInTime).length,
          },
        };
      },
    });

  }

  const availableActions = actionsForRole(profile.role).filter((kind) =>
    kind === "assign_room_cleaning" ? scopes.has("housekeeping") : scopes.has("maintenance") || scopes.has("housekeeping"),
  );

  if (availableActions.length) {
    tools.propose_action = tool({
      description:
        `Propose an operational change for the user to confirm. This DOES NOT change anything: it returns a confirmation card and the user taps Confirm. Available actions: ${availableActions
          .map((kind) => `${kind} — ${ACTION_LABEL[kind]}`)
          .join("; ")}. Always read the relevant data first (rooms, team, tickets) and never claim the change is done.`,
      inputSchema: jsonSchema<{ kind: string; input: Record<string, unknown>; reason: string }>({
        type: "object",
        properties: {
          kind: { type: "string", enum: availableActions as unknown as string[] },
          reason: { type: "string", description: "One sentence: why this is the right thing to do" },
          input: {
            type: "object",
            description:
              "create_ticket: {hotelId, roomNumber, title, description, priority, department}. assign_room_cleaning: {hotelId, roomNumber, staffId, staffName, date, assignmentType}. update_ticket_status: {hotelId, ticketId, status, note}.",
            additionalProperties: true,
          },
        },
        required: ["kind", "input", "reason"],
        additionalProperties: false,
      }),
      execute: async ({ kind, input, reason }) => {
        if (!availableActions.includes(kind as any)) throw new Error("That action is not available for your role");
        const requested = (input ?? {}) as Record<string, unknown>;
        const ids = resolve(typeof requested.hotelId === "string" ? requested.hotelId : null);
        if (ids.length !== 1) throw new Error("Name exactly one property for this action");
        const validated = validateAction(kind, { ...requested, hotelId: ids[0] });
        if (!validated.ok) throw new Error(validated.error);
        return {
          kind: "action_proposal",
          action: validated.action.kind,
          title: ACTION_LABEL[validated.action.kind],
          hotelId: ids[0],
          hotelName: hotels.find((h) => h.hotel_id === ids[0])?.hotel_name ?? ids[0],
          reason,
          fields: validated.action.fields,
          input: validated.action.input,
          requiresApproval: true,
        };
      },
    });
  }


  // Everyone: what is on my own plate right now.
  tools.get_my_day = tool({
    description:
      "Read what this signed-in user personally has today: their own room assignments, the tickets assigned to them, and whether they are currently signed in for the shift. Use it for 'what should I do', 'my rooms', 'am I signed in'.",
    inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {}, required: [], additionalProperties: false }),
    execute: async () => {
      const [assignments, myTickets, attendance] = await Promise.all([
        service
          .from("room_assignments")
          .select("id,room_id,status,assignment_type,priority,started_at,completed_at")
          .eq("assigned_to", profile.id)
          .eq("assignment_date", today())
          .limit(200),
        service
          .from("tickets")
          .select("id,ticket_number,title,status,priority,room_number,sla_due_date")
          .eq("assigned_to", profile.id)
          .neq("status", "completed")
          .order("created_at", { ascending: false })
          .limit(100),
        service
          .from("staff_attendance")
          .select("id,check_in_time,check_out_time,status,work_date")
          .eq("user_id", profile.id)
          .eq("work_date", today())
          .maybeSingle(),
      ]);
      const roomIds = (assignments.data ?? []).map((row: any) => row.room_id);
      const rooms = roomIds.length
        ? await service.from("rooms").select("id,room_number,floor_number,status").in("id", roomIds).limit(200)
        : { data: [] };
      const numbers = new Map((rooms.data ?? []).map((room: any) => [room.id, room]));
      return {
        signedIn: Boolean(attendance.data && !attendance.data.check_out_time),
        attendance: attendance.data ?? null,
        myRooms: (assignments.data ?? []).map((row: any) => ({
          ...row,
          room_number: numbers.get(row.room_id)?.room_number ?? null,
          floor: numbers.get(row.room_id)?.floor_number ?? null,
          room_status: numbers.get(row.room_id)?.status ?? null,
        })),

        myTickets: myTickets.data ?? [],
      };
    },
  });

  if (scopes.has("housekeeping") || scopes.has("maintenance")) {
    tools.get_room_detail = tool({
      description:
        "Everything known about one room right now: status, today's assignment and who has it, open tickets and unresolved housekeeping notes. Call this before answering a question about a specific room number.",
      inputSchema: jsonSchema<{ hotelId: string | null; roomNumber: string }>(
        hotelArgSchema({ roomNumber: { type: "string", description: "The room number as staff say it, e.g. 303" } }, ["roomNumber"]),
      ),
      execute: async ({ hotelId, roomNumber }) => {
        const ids = resolve(hotelId);
        const names = hotels.filter((h) => ids.includes(h.hotel_id)).map((h) => h.hotel_name);
        const { data: rooms, error } = await service
          .from("rooms")
          .select(
            "id,room_number,floor_number,status,hotel,room_name,is_checkout_room,guest_nights_stayed,is_dnd,towel_change_required,linen_change_required,last_cleaned_at,notes,pms_metadata",
          )
          .eq("organization_slug", orgSlug)
          .in("hotel", [...new Set([...ids, ...names])])
          .eq("room_number", String(roomNumber).trim())
          .limit(5);
        if (error) throw new Error(`Room lookup failed: ${error.message}`);
        const room = (rooms ?? [])[0];
        if (!room) return { error: `No room ${roomNumber} in your properties.` };
        const [assignment, roomTickets, notes] = await Promise.all([
          service
            .from("room_assignments")
            .select("id,assigned_to,status,assignment_type,started_at,completed_at,is_dnd,notes")
            .eq("room_id", room.id)
            .eq("assignment_date", today())
            .limit(5),
          // tickets has no room_id — it is keyed by room_number + hotel.
          service
            .from("tickets")
            .select("id,ticket_number,title,status,priority,created_at,sla_due_date,assigned_to,on_hold")
            .eq("organization_slug", orgSlug)
            .eq("hotel", room.hotel)
            .eq("room_number", room.room_number)
            .neq("status", "completed")
            .limit(30),

          service
            .from("housekeeping_notes")
            .select("id,note_type,content,is_resolved,created_at")
            .eq("room_id", room.id)
            .eq("is_resolved", false)
            .order("created_at", { ascending: false })
            .limit(20),
        ]);
        const people = [
          ...new Set([
            ...(assignment.data ?? []).map((a: any) => a.assigned_to),
            ...(roomTickets.data ?? []).map((t: any) => t.assigned_to),
          ].filter(Boolean)),
        ];
        const staff = people.length
          ? await service.from("profiles").select("id,full_name,nickname").in("id", people).limit(100)
          : { data: [] };
        const nameOf = new Map((staff.data ?? []).map((p: any) => [p.id, p.full_name || p.nickname || "Unnamed staff"]));
        return {
          room: { ...room, floor: room.floor_number ?? null },
          todaysAssignments: (assignment.data ?? []).map((a: any) => ({
            ...a,
            assigned_to: a.assigned_to ? nameOf.get(a.assigned_to) ?? "Unknown staff" : null,
          })),
          openTickets: (roomTickets.data ?? []).map((t: any) => ({
            ...t,
            assigned_to: t.assigned_to ? nameOf.get(t.assigned_to) ?? "Unknown staff" : null,
          })),
          openNotes: notes.data ?? [],
        };

      },
    });
  }

  if (scopes.has("finance")) {
    tools.get_purchase_invoices = tool({
      description:
        "Read purchase invoices for the user's authorized properties: what is waiting for review or approval, totals by status, and the oldest items. Never returns bank details.",
      inputSchema: jsonSchema<{ hotelId: string | null; status: string | null; startDate: string | null; endDate: string | null }>(
        hotelArgSchema(
          {
            status: {
              type: ["string", "null"],
              description: "Approval status filter: pending, approved, rejected, or null for all",
            },
            startDate: { type: ["string", "null"], description: "Invoice date from, YYYY-MM-DD or null" },
            endDate: { type: ["string", "null"], description: "Invoice date to, YYYY-MM-DD or null" },
          },
          ["status", "startDate", "endDate"],
        ),
      ),
      execute: async ({ hotelId, status, startDate, endDate }) => {
        const ids = resolve(hotelId);
        let query = service
          .from("purchase_invoices")
          .select(
            "id,hotel_id,merchant_name,invoice_number,invoice_date,due_date,currency,total_amount,net_amount,total_vat_amount,review_status,approval_status,needs_review,expense_category",
          )
          .eq("organization_slug", orgSlug)
          .in("hotel_id", ids)
          .order("invoice_date", { ascending: false })
          .limit(300);
        if (status) query = query.eq("approval_status", status);
        if (startDate) query = query.gte("invoice_date", startDate);
        if (endDate) query = query.lte("invoice_date", endDate);
        const { data, error } = await query;
        if (error) throw new Error(`Invoice lookup failed: ${error.message}`);
        const rows = data ?? [];
        const byStatus: Record<string, { count: number; total: number }> = {};
        for (const row of rows) {
          const key = row.approval_status ?? "unknown";
          byStatus[key] = byStatus[key] ?? { count: 0, total: 0 };
          byStatus[key].count += 1;
          byStatus[key].total += Number(row.total_amount ?? 0);
        }
        return {
          invoices: rows.slice(0, 60),
          totalsByApprovalStatus: byStatus,
          waitingForReview: rows.filter((row: any) => row.needs_review).length,
        };
      },
    });
  }

  void hotelIds;
  return tools;
}

/**
 * Short topic title (3-6 words) for the history list, in the user's own
 * language. Falls back silently: a title is never worth failing a chat over.
 */
async function generateThreadTitle(params: {
  apiKey: string;
  question: string;
  answer: string;
  language: string;
}): Promise<string | null> {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 24,
        messages: [
          {
            role: "system",
            content:
              `Write a title for a hotel-operations chat: 3-6 words, in ${params.language}, describing the topic. ` +
              "No quotes, no final punctuation, no words like 'chat' or 'conversation'. Title case is not required.",
          },
          {
            role: "user",
            content: `Question: ${params.question.slice(0, 600)}\n\nAnswer: ${params.answer.slice(0, 600)}`,
          },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    const raw = String(data?.choices?.[0]?.message?.content ?? "")
      .replace(/["“”'`]/g, "")
      .replace(/\s+/g, " ")
      .replace(/[.]+$/, "")
      .trim();
    return raw ? raw.slice(0, 60) : null;
  } catch (error) {
    console.error("assistant title generation failed", error);
    return null;
  }
}




Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey || !openAiKey) {
      return json({ error: "Assistant configuration is incomplete" }, 500);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const token = authHeader.slice(7);
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Invalid session" }, 401);

    const body = await req.json().catch(() => null);
    const threadId = typeof body?.thread_id === "string" ? body.thread_id : "";
    const messages = normalizeMessages(body?.messages);
    if (!threadId || !messages) return json({ error: "A valid thread and message history are required" }, 400);
    const latest = [...messages].reverse().find((message) => message.role === "user");
    const question = extractText(latest);
    if (!question || question.length > 10_000) return json({ error: "Question is empty or too long" }, 400);

    const [{ data: profile, error: profileError }, { data: thread, error: threadError }] = await Promise.all([
      service
        .from("profiles")
        .select("id,role,assigned_hotel,organization_slug,preferred_language")
        .eq("id", userData.user.id)
        .is("deleted_at", null)
        .single(),
      service
        .from("assistant_threads")
        .select("id,user_id,organization_slug,hotel_id,title,title_locked")
        .eq("id", threadId)
        .eq("user_id", userData.user.id)
        .single(),
    ]);
    if (profileError || !profile) return json({ error: "Profile not found" }, 403);
    if (threadError || !thread) return json({ error: "Conversation not found" }, 404);
    // Ownership is already enforced by the user_id filter above. Only the
    // organization is checked here: a thread may have been started while the
    // user was on another property of the same organization (hotel switching
    // is per tab), and that must not block the conversation. What may be READ
    // is still scoped per request by the profile's role/organization/hotels.
    if (thread.organization_slug && thread.organization_slug !== profile.organization_slug) {
      return json({ error: "Conversation is outside your current organization" }, 403);
    }

    // Fair-use guard: bounded number of assistant turns per user per 5 minutes.
    const windowStart = new Date(Date.now() - 5 * 60_000).toISOString();
    const { count: recentCount } = await service
      .from("assistant_audit_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userData.user.id)
      .gte("created_at", windowStart);
    if ((recentCount ?? 0) >= 40) {
      return json({ error: "You have asked a lot of questions in a short time. Please try again in a few minutes." }, 429);
    }

    const { data: storedRows, error: storedError } = await service
      .from("assistant_messages")
      .select("id,role,content,created_at")
      .eq("thread_id", threadId)
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: true })
      .limit(200);
    if (storedError) return json({ error: `Could not load conversation history: ${storedError.message}` }, 500);
    // The full thread stays stored and visible in the app; the model only ever
    // sees a bounded recent window, so old turns cannot add noise or be reused
    // as if they were current operational facts.
    const MODEL_HISTORY_TURNS = 40;
    const storedMessages: UIMessage[] = (storedRows ?? []).slice(-MODEL_HISTORY_TURNS).map((row: any) => ({
      id: row.id,
      role: row.role,
      parts: [{ type: "text", text: row.content }],
    }));

    const modelMessages = [
      ...storedMessages,
      { id: latest?.id ?? crypto.randomUUID(), role: "user" as const, parts: [{ type: "text" as const, text: question }] },
    ];

    const scopes = allowedScopes(profile.role);
    const requestedScope = detectRequestedScope(question);
    const deniedScope = requestedScope && !scopes.has(requestedScope) ? requestedScope : null;
    const languageCode = typeof body?.language === "string" ? body.language : profile.preferred_language ?? "en";
    const language = LANGUAGE_NAMES[languageCode] ?? LANGUAGE_NAMES.en;

    // Where the user is standing. This is a UX hint only — it never widens
    // what may be read; scopes and properties come from the profile above.
    const page: PageContext =
      body?.page && typeof body.page === "object" ? (body.page as Record<string, unknown>) : null;
    const rawCapabilities = body?.capabilities ?? {};
    const capabilities: Capabilities = {
      destinations: Array.isArray(rawCapabilities.destinations) ? rawCapabilities.destinations.slice(0, 60) : [],
      guides: Array.isArray(rawCapabilities.guides) ? rawCapabilities.guides.slice(0, 40) : [],
    };


    const { error: userInsertError } = await service.from("assistant_messages").insert({
      thread_id: threadId,
      user_id: userData.user.id,
      role: "user",
      content: question,
      refused: false,
    });
    if (userInsertError) return json({ error: `Could not save your message: ${userInsertError.message}` }, 500);

    // Interim title so the history list is never a bare "New chat"; it is
    // replaced by a short AI topic title once the answer is finished.
    const needsTopicTitle = thread.title === "New chat" && !thread.title_locked;
    if (needsTopicTitle) {
      const title = question.replace(/\s+/g, " ").trim().slice(0, 60) || "New chat";
      const { error: titleError } = await service
        .from("assistant_threads")
        .update({ title, updated_at: new Date().toISOString() })
        .eq("id", threadId)
        .eq("user_id", userData.user.id);
      if (titleError) console.error("assistant title update failed", titleError);
    }


    if (deniedScope) {
      const answer = `I can’t access ${deniedScope} information with your current role. You can request temporary access from an authorized manager.`;
      const { error: deniedInsertError } = await service.from("assistant_messages").insert({
        thread_id: threadId,
        user_id: userData.user.id,
        role: "assistant",
        content: answer,
        refused: true,
      });
      if (deniedInsertError) return json({ error: `Could not save the assistant reply: ${deniedInsertError.message}` }, 500);
      return new Response(
        `data: ${JSON.stringify({ type: "start", messageId: crypto.randomUUID(), messageMetadata: { needsScope: deniedScope } })}\n\n` +
          `data: ${JSON.stringify({ type: "text-start", id: "refusal" })}\n\n` +
          `data: ${JSON.stringify({ type: "text-delta", id: "refusal", delta: answer })}\n\n` +
          `data: ${JSON.stringify({ type: "text-end", id: "refusal" })}\n\n` +
          `data: ${JSON.stringify({ type: "finish", finishReason: "stop", messageMetadata: { needsScope: deniedScope } })}\n\n` +
          "data: [DONE]\n\n",
        { headers: { ...corsHeaders, "Content-Type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" } },
      );
    }

    const openai = createOpenAI({ apiKey: openAiKey });
    // High-reasoning default so answers about live hotel data are accurate.
    const modelId = Deno.env.get("OPENAI_MODEL") || "gpt-5.6";
    const hotels = await resolveAssistantHotels(service, profile as Profile);
    const revenueBrain = scopes.has("revenue")
      ? `
You also act as an experienced city-hotel revenue manager: sell early, build occupancy for every date, protect ADR, never discount blindly.
Simple factual revenue questions (occupancy, ADR, price, rooms left on a date) get ONE read and a direct one- or two-sentence answer. Do not turn them into an analysis.
Only for advice questions ("should I raise prices for 18 Sep?") gather the supporting evidence — occupancy and rooms left, booking window, recent pickup, current rates and the room-type/occupancy ladder, demand or events, recent automation activity — then answer in three short parts: recommendation, reason with numbers, suggested action.
All revenue numbers come from the published Revenue dataset, which is the same dataset the Revenue screen shows. Quote it as returned; never recompute occupancy or ADR yourself from other tables.
When a rule change would help, call propose_automation_change. It only creates a proposal the user taps Apply on, so never claim you changed anything.
Respect and mention the app's guardrails when relevant: whole-number prices, room-type/occupancy ladder safety, sold-out and high-occupancy guards, minimum ADR, far-out floors and top-ups, manual-price hold.
Always say which hotel, date range and currency your numbers refer to.`
      : "";
    const result = streamText({
      model: openai.responses(modelId),
      system: `You are the Hotel Care Assistant, an expert hotel operations and revenue copilot inside the Hotel Care app.
Reply in ${language}; if the latest user message is clearly in another language, reply in that language instead.
The authenticated user's role is ${profile.role}. Their organization is ${profile.organization_slug ?? "none"}.
Properties you may read: ${hotels.map((h) => `${h.hotel_name} (${h.hotel_id})`).join("; ") || "none"}. Never mention or read any other organization or property.

ANSWER STYLE
- Lead with the answer. Be concise: normally 1-4 short paragraphs OR 3-6 bullets. Expand only when the user asks for detail, explanation, analysis, comparison or reasoning.
- Use exact numbers, room numbers, names, hotel and dates. Never replace numbers with generic commentary such as "the team is progressing well".
- Plain conversational text by default. Use a table only for several hotels, several dates, room-type comparison or KPI comparison. One value is one sentence, never a table.
- Never mention tools, tool names, functions, JSON, ids, tables or any internal field; write as a colleague would.

GROUNDING — never guess Hotel Care data
- Any factual question about revenue, occupancy, ADR, RevPAR, price, pickup, pace, availability, automation, housekeeping, room status, assignments, maintenance, tickets, attendance, reception, arrivals, departures, breakfast, reservations, invoices or PMS state MUST be answered from a tool call made in THIS turn.
- Earlier conversation is context for understanding references, never evidence. If an earlier answer said room 303 was dirty, re-read the room now before answering about it.
- If the required lookup fails or returns no dataset, say: "I couldn't verify the latest Hotel Care data just now." Never invent a plausible figure, and never turn missing data into a zero.
- Tool results carry a confidence: verified (answer normally), partial (answer what is known and name what is missing), unverified (do not state the fact as true).
- Tool results also carry the dataset time. Mention it when the data is old, incomplete, a sync has not completed, or the user questions accuracy — for example "Occupancy is 73% based on the Revenue dataset last updated at 14:08."
- If the user says a number is wrong or asks you to check again: do not defend or repeat the previous answer. Identify the exact hotel, date and entity, re-run the authoritative lookup, and state the current figure plainly. Do not invent a reason for the discrepancy.

HOTEL AND DATE
- Use the hotel of the screen the user is on unless they clearly name another property. Page context helps you interpret "this hotel" but never widens what you may read.
- If the question could mean several properties and no hotel is selected, ask ONE short clarification naming the options, then stop.
- "today", "tomorrow", "this weekend", "next Friday" are resolved in Europe/Budapest time.

OPERATIONAL READS
- Own shift, rooms or tickets ("what do I do now", "my rooms", "am I signed in") → get_my_day first.
- Arrivals, departures, in-house rooms, breakfast → get_reception_overview, and answer with its room-level detail. Never say "no arrivals" unless it actually returned zero for that date and hotel; if PMS rows are missing, say the data has not synced yet.
- Housekeeping → get_housekeeping_status, or get_housekeeping_briefing for a broad "how are we doing today". Lead with done / in progress / not started plus the progress percentage, then each housekeeper by name with their completed-of-assigned count, then the exceptions with room numbers: DND, no-service, unassigned dirty rooms, unresolved notes, linen due, SLA-breached tickets.
- Do not call the same tool twice unless the user disputes the data, you are comparing periods, or the first attempt failed. Most questions need one to four reads.

GUIDANCE AND ACTIONS
- Navigation: answer in one line as a path, e.g. "Open Revenue Management → Rate Calendar → Min Stay", using find_destination, then offer a button with suggest_actions (up to three: open a screen, start a walkthrough, or report a problem). Use get_training_guide when the user asks how to do something step by step.
- Operational changes (raise a ticket, assign a room, move a ticket's status): read the current state, then call propose_action. It only creates a confirmation card the user taps Confirm on — never say the change is done.
- Unavailable tools are unavailable because of authorization. Say access is required, without speculating about the data. Never reveal another organization, hotel, venue, guest identity, credential or staff pay.
- For general (non Hotel Care) knowledge, answer normally. For Hotel Care usage questions, use the workflow reference tool.
Where the user is right now: ${page ? JSON.stringify(page) : "unknown"}.${revenueBrain}`,
      messages: await convertToModelMessages(modelMessages),
      tools: buildTools(service, profile as Profile, scopes, hotels, capabilities, openAiKey),

      // Most questions need 1-4 reads; this bound keeps answers fast and
      // predictable while still allowing a multi-source revenue recommendation.
      stopWhen: stepCountIs(12),

      abortSignal: req.signal,
      providerOptions: {
        openai: {
          store: false,
          reasoningEffort: "high",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
        },
      },
    });

    return result.toUIMessageStreamResponse({
      originalMessages: modelMessages,
      sendReasoning: true,
      headers: corsHeaders,
      onFinish: async ({ responseMessage, isAborted }) => {
        if (isAborted) return;
        const answer = extractText(responseMessage);
        if (!answer) return;
        const { error: assistantInsertError } = await service.from("assistant_messages").insert({
          thread_id: threadId,
          user_id: userData.user.id,
          role: "assistant",
          content: answer,
          refused: false,
        });
        if (assistantInsertError) {
          console.error("assistant reply persistence failed", assistantInsertError);
          return;
        }
        const topicTitle = needsTopicTitle
          ? await generateThreadTitle({ apiKey: openAiKey, question, answer, language })
          : null;
        await service
          .from("assistant_threads")
          .update({
            updated_at: new Date().toISOString(),
            ...(topicTitle ? { title: topicTitle } : {}),
          })
          .eq("id", threadId)
          .eq("user_id", userData.user.id);

        const usedTools = responseMessage.parts
          .filter((part) => part.type.startsWith("tool-") || part.type === "dynamic-tool")
          .map((part) => part.type);
        const { error: auditError } = await service.from("assistant_audit_log").insert({
          user_id: userData.user.id,
          organization_slug: profile.organization_slug,
          hotel_id: profile.assigned_hotel,
          role: profile.role,
          question,
          refused: false,
          scopes_used: usedTools,
          model: modelId,
        });
        if (auditError) console.error("assistant audit failed", auditError);
      },
      onError: (error) => {
        console.error("assistant stream failed", error);
        return error instanceof Error ? error.message : "The assistant could not complete the response";
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return json({ error: "Request cancelled" }, 499);
    console.error("assistant-chat error", error);
    return json({ error: error instanceof Error ? error.message : "Assistant request failed" }, 500);
  }
});