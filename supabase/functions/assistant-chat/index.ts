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

function buildTools(
  service: any,
  profile: Profile,
  scopes: Set<Scope>,
  hotels: AssistantHotel[],
  capabilities: Capabilities,
) {
  const orgSlug = profile.organization_slug;
  const hotelIds = hotels.map((h) => h.hotel_id);
  const today = () => new Date().toISOString().slice(0, 10);
  const resolve = (requested: string | null | undefined) => {
    const picked = pickHotels(hotels, requested);
    if (!picked.ok) throw new Error(picked.error);
    return picked.hotels.map((h) => h.hotel_id);
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
        const ids = resolve(hotelId);
        const from = startDate ?? today();
        const to = endDate ?? from;
        const { data, error } = await service
          .from("revenue_daily_snapshots")
          .select("hotel_id,stay_date,captured_date,occupancy_pct,adr_eur,revenue_eur,rooms_sold,rooms_available")
          .gte("stay_date", from)
          .lte("stay_date", to)
          .eq("organization_slug", orgSlug)
          .in("hotel_id", ids)
          .order("stay_date")
          .order("captured_date", { ascending: false })
          .limit(4000);
        if (error) throw new Error(`Revenue lookup failed: ${error.message}`);
        // Newest capture per hotel + stay date.
        const latest = new Map<string, any>();
        for (const row of data ?? []) {
          const key = `${row.hotel_id}|${row.stay_date}`;
          if (!latest.has(key)) latest.set(key, row);
        }
        return { from, to, hotels: ids, rows: [...latest.values()] };
      },
    });

    tools.get_pickup_and_pace = tool({
      description:
        "Booking pace: rooms sold vs available by stay date plus the automation engine's recorded pickup actions, so you can judge whether a date is pacing ahead or behind.",
      inputSchema: jsonSchema<{ hotelId: string | null; days: number | null }>(
        hotelArgSchema({ days: { type: ["number", "null"], description: "Horizon in days from today, default 60, max 365" } }, ["days"]),
      ),
      execute: async ({ hotelId, days }) => {
        const ids = resolve(hotelId);
        const horizon = Math.min(Math.max(Number(days ?? 60), 1), 365);
        const from = today();
        const to = new Date(Date.now() + horizon * 86_400_000).toISOString().slice(0, 10);
        const [snapshots, actions] = await Promise.all([
          service
            .from("revenue_daily_snapshots")
            .select("hotel_id,stay_date,captured_date,rooms_sold,rooms_available,occupancy_pct,adr_eur")
            .eq("organization_slug", orgSlug)
            .in("hotel_id", ids)
            .gte("stay_date", from)
            .lte("stay_date", to)
            .order("stay_date")
            .order("captured_date", { ascending: false })
            .limit(6000),
          service
            .from("revenue_pickup_actions")
            .select("hotel_id,stay_date,trigger_kind,trigger_detail,delta_eur,old_price,new_price,occurred_at")
            .eq("organization_slug", orgSlug)
            .in("hotel_id", ids)
            .gte("stay_date", from)
            .lte("stay_date", to)
            .order("occurred_at", { ascending: false })
            .limit(300),
        ]);
        if (snapshots.error) throw new Error(`Pace lookup failed: ${snapshots.error.message}`);
        if (actions.error) throw new Error(`Pickup action lookup failed: ${actions.error.message}`);
        const latest = new Map<string, any>();
        for (const row of snapshots.data ?? []) {
          const key = `${row.hotel_id}|${row.stay_date}`;
          if (!latest.has(key)) latest.set(key, row);
        }
        const pace = [...latest.values()].map((r) => ({
          hotel_id: r.hotel_id,
          stay_date: r.stay_date,
          rooms_sold: r.rooms_sold,
          rooms_available: r.rooms_available,
          rooms_left: Number(r.rooms_available ?? 0) - Number(r.rooms_sold ?? 0),
          occupancy_pct: r.occupancy_pct,
          adr_eur: r.adr_eur,
        }));
        return { from, to, pace, recentPickupActions: actions.data ?? [] };
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
        const ids = resolve(hotelId);
        const from = startDate ?? today();
        const to = endDate ?? new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
        const { data, error } = await service
          .from("revenue_room_type_rates")
          .select("hotel_id,stay_date,room_type_name,occupancy,price,currency,min_stay,closed_to_arrival,captured_at")
          .eq("organization_slug", orgSlug)
          .in("hotel_id", ids)
          .gte("stay_date", from)
          .lte("stay_date", to)
          .order("stay_date")
          .limit(4000);
        if (error) throw new Error(`Rate lookup failed: ${error.message}`);
        return { from, to, rates: data ?? [] };
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
        const ids = resolve(hotelId);
        const from = startDate ?? today();
        const to = endDate ?? from;
        const { data, error } = await service
          .from("revenue_daily_snapshots")
          .select("hotel_id,stay_date,captured_date,occupancy_pct,rooms_sold,rooms_available")
          .gte("stay_date", from)
          .lte("stay_date", to)
          .eq("organization_slug", orgSlug)
          .in("hotel_id", ids)
          .order("stay_date")
          .order("captured_date", { ascending: false })
          .limit(6000);
        if (error) throw new Error(`Occupancy lookup failed: ${error.message}`);
        // Keep only the newest capture per hotel + stay date so figures are current.
        const latest = new Map<string, any>();
        for (const row of data ?? []) {
          const key = `${row.hotel_id}|${row.stay_date}`;
          if (!latest.has(key)) latest.set(key, row);
        }
        const days = [...latest.values()].map((r) => ({
          hotel_id: r.hotel_id,
          stay_date: r.stay_date,
          rooms_sold: r.rooms_sold,
          rooms_available: r.rooms_available,
          occupancy_pct:
            r.occupancy_pct ??
            (r.rooms_available ? Math.round((Number(r.rooms_sold) / Number(r.rooms_available)) * 1000) / 10 : null),
        }));
        const sold = days.reduce((s, d) => s + Number(d.rooms_sold ?? 0), 0);
        const avail = days.reduce((s, d) => s + Number(d.rooms_available ?? 0), 0);
        return {
          from,
          to,
          days,
          totals: {
            rooms_sold: sold,
            rooms_available: avail,
            occupancy_pct: avail ? Math.round((sold / avail) * 1000) / 10 : null,
          },
        };
      },
    });
  }

  if (scopes.has("housekeeping")) {
    tools.get_housekeeping_status = tool({
      description: "Read room status and today's assignments inside the user's authorized hotels and organization only.",
      inputSchema: jsonSchema<{ hotelId: string | null }>(hotelArgSchema({}, [])),
      execute: async ({ hotelId }) => {
        const ids = resolve(hotelId);
        const names = hotels.filter((h) => ids.includes(h.hotel_id)).map((h) => h.hotel_name);
        const roomsQuery = service
          .from("rooms")
          .select("id,room_number,status,hotel")
          .eq("organization_slug", orgSlug)
          .in("hotel", [...new Set([...ids, ...names])])
          .limit(2000);
        const rooms = await roomsQuery;
        if (rooms.error) throw new Error(`Room lookup failed: ${rooms.error.message}`);
        const roomIds = (rooms.data ?? []).map((room: any) => room.id);
        const assignments = roomIds.length
          ? await service
              .from("room_assignments")
              .select("id,room_id,assigned_to,status,started_at,completed_at")
              .eq("organization_slug", orgSlug)
              .in("room_id", roomIds)
              .eq("assignment_date", today())
              .limit(2000)
          : { data: [], error: null };
        if (assignments.error) throw new Error(`Assignment lookup failed: ${assignments.error.message}`);
        const counts: Record<string, number> = {};
        for (const room of rooms.data ?? []) counts[room.status] = (counts[room.status] ?? 0) + 1;
        return { roomStatusCounts: counts, assignments: assignments.data ?? [] };
      },
    });
  }

  if (scopes.has("maintenance")) {
    tools.get_maintenance_tickets = tool({
      description: "Read maintenance tickets inside the user's authorized hotels and organization only.",
      inputSchema: jsonSchema<{ hotelId: string | null; status: string | null }>(
        hotelArgSchema({ status: { type: ["string", "null"], description: "open, in_progress, completed, or null" } }, ["status"]),
      ),
      execute: async ({ hotelId, status }) => {
        const ids = resolve(hotelId);
        const names = hotels.filter((h) => ids.includes(h.hotel_id)).map((h) => h.hotel_name);
        let query = service
          .from("tickets")
          .select("id,ticket_number,title,description,status,priority,room_number,hotel,sla_due_date,created_at")
          .eq("organization_slug", orgSlug)
          .in("hotel", [...new Set([...ids, ...names])])
          .order("created_at", { ascending: false })
          .limit(200);
        if (status) query = query.eq("status", status);
        const { data, error } = await query;
        if (error) throw new Error(`Maintenance lookup failed: ${error.message}`);
        return { tickets: data ?? [] };
      },
    });
  }

  if (scopes.has("reception")) {
    tools.get_reception_overview = tool({
      description: "Read arrivals, departures and breakfast counts inside the user's authorized hotels and organization only. Never returns guest personal details.",
      inputSchema: jsonSchema<{ hotelId: string | null; date: string | null }>(
        hotelArgSchema({ date: { type: ["string", "null"], description: "YYYY-MM-DD or null for today" } }, ["date"]),
      ),
      execute: async ({ hotelId, date }) => {
        const ids = resolve(hotelId);
        const target = date ?? today();
        const reservationsQuery = service
          .from("reservations")
          .select("id,hotel_id,check_in_date,check_out_date,status")
          .eq("organization_slug", orgSlug)
          .in("hotel_id", ids)
          .or(`check_in_date.eq.${target},check_out_date.eq.${target}`)
          .limit(2000);
        const breakfastQuery = service
          .from("breakfast_roster")
          .select("id,hotel_id,stay_date,breakfast_count")
          .eq("organization_slug", orgSlug)
          .in("hotel_id", ids)
          .eq("stay_date", target)
          .limit(2000);
        const [reservations, breakfast] = await Promise.all([reservationsQuery, breakfastQuery]);
        if (reservations.error) throw new Error(`Reservation lookup failed: ${reservations.error.message}`);
        if (breakfast.error) throw new Error(`Breakfast lookup failed: ${breakfast.error.message}`);
        const rows = reservations.data ?? [];
        return {
          date: target,
          hotels: ids,
          arrivals: rows.filter((row: any) => row.check_in_date === target).length,
          departures: rows.filter((row: any) => row.check_out_date === target).length,
          breakfastCount: (breakfast.data ?? []).reduce(
            (sum: number, row: any) => sum + (Number(row.breakfast_count) || 0),
            0,
          ),
        };
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
      description: "Who is currently signed in for work today at the user's authorized properties.",
      inputSchema: jsonSchema<{ hotelId: string | null; date: string | null }>(
        hotelArgSchema({ date: { type: ["string", "null"], description: "YYYY-MM-DD or null for today" } }, ["date"]),
      ),
      execute: async ({ hotelId, date }) => {
        const ids = resolve(hotelId);
        const names = hotels.filter((h) => ids.includes(h.hotel_id)).map((h) => h.hotel_name);
        const target = date ?? today();
        const { data, error } = await service
          .from("staff_attendance")
          .select("id,user_id,hotel,work_date,check_in_time,check_out_time,status")
          .eq("organization_slug", orgSlug)
          .in("hotel", [...new Set([...ids, ...names])])
          .eq("work_date", target)
          .limit(500);
        if (error) throw new Error(`Attendance lookup failed: ${error.message}`);
        return { date: target, attendance: data ?? [] };
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
        ? await service.from("rooms").select("id,room_number,floor,status").in("id", roomIds).limit(200)
        : { data: [] };
      const numbers = new Map((rooms.data ?? []).map((room: any) => [room.id, room]));
      return {
        signedIn: Boolean(attendance.data && !attendance.data.check_out_time),
        attendance: attendance.data ?? null,
        myRooms: (assignments.data ?? []).map((row: any) => ({
          ...row,
          room_number: numbers.get(row.room_id)?.room_number ?? null,
          floor: numbers.get(row.room_id)?.floor ?? null,
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
          .select("id,room_number,floor,status,hotel,room_name,is_checkout_room,guest_nights_stayed")
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
          service
            .from("tickets")
            .select("id,ticket_number,title,status,priority,created_at,sla_due_date")
            .eq("room_id", room.id)
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
        return {
          room,
          todaysAssignments: assignment.data ?? [],
          openTickets: roomTickets.data ?? [],
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
        .select("id,user_id,organization_slug,hotel_id,title")
        .eq("id", threadId)
        .eq("user_id", userData.user.id)
        .single(),
    ]);
    if (profileError || !profile) return json({ error: "Profile not found" }, 403);
    if (threadError || !thread) return json({ error: "Conversation not found" }, 404);
    if (thread.organization_slug !== profile.organization_slug || thread.hotel_id !== profile.assigned_hotel) {
      return json({ error: "Conversation is outside your current property scope" }, 403);
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
    const storedMessages: UIMessage[] = (storedRows ?? []).map((row: any) => ({
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

    if (thread.title === "New chat") {
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
You act as a revenue manager with twenty years of experience in city hotels.
Objective: sell rooms early, build occupancy towards 100% for every single date, and protect ADR — never discount blindly.
Method: before advising anything, read the data. Look at booking pace (rooms left versus days to arrival), recent pickup, day of week, events, current prices and what the automation engine has already been doing. Then say what you would do and why, with numbers.
When a rule change would help, call propose_automation_change. It only creates a proposal: the user taps Apply to make it real, so never claim you have changed anything.
Respect the app's guardrails and mention them when relevant: whole-number prices, room-type/occupancy price ladder safety, sold-out and high-occupancy guards, minimum ADR, far-out floors and top-ups, manual-price hold.
Always state which hotel, which date range and which currency your numbers refer to. If data is missing or stale, say so instead of guessing.`
      : "";
    const result = streamText({
      model: openai.responses(modelId),
      system: `You are the Hotel Care Assistant. Be concise, practical, and accurate.
Reply in ${language}; if the latest user message is clearly in another language, reply in that language instead.
The authenticated user's role is ${profile.role}. Their organization is ${profile.organization_slug ?? "none"}.
Properties you may read: ${hotels.map((h) => `${h.hotel_name} (${h.hotel_id})`).join("; ") || "none"}. Never mention or read any other organization or property.
If the user asks about their own shift, rooms or tickets ('what do I do now', 'my rooms', 'am I signed in'), call get_my_day first.
Use tools for live hotel facts. Never invent internal data. Never reveal another organization, hotel, venue, guest identity, credential, staff pay, or information outside the available tools.
Unavailable tools are unavailable because of authorization. If asked for an unauthorized data area, say access is required without speculating about the data.
Use markdown, and short tables when comparing dates or properties.
For general knowledge, answer normally. For Hotel Care usage questions, use the workflow reference tool.
Where the user is right now: ${page ? JSON.stringify(page) : "unknown"}. Use it to interpret "this page", "this room" or "here", but never as proof of permission.
You can guide people through the app: call find_destination to locate the right screen, get_training_guide for the real steps, and suggest_actions to offer up to three buttons (open a screen, start a walkthrough, or report a problem to the Hotel Care team). Offer a walkthrough when someone asks how to do something, and offer to report a problem when the app looks broken or you cannot answer.
When the user asks you to change something operational (raise a maintenance ticket, assign a room for cleaning, move a ticket's status), gather the facts with the read tools, then call propose_action. It only creates a confirmation card — the user taps Confirm — so never say the change is done.
Never mention tools, tool names, JSON, ids or internal fields in your reply; write as a colleague would.${revenueBrain}`,
      messages: await convertToModelMessages(modelMessages),
      tools: buildTools(service, profile as Profile, scopes, hotels, capabilities),

      stopWhen: stepCountIs(50),
      abortSignal: req.signal,
      providerOptions: {
        openai: {
          store: false,
          reasoningEffort: "medium",
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
        await service
          .from("assistant_threads")
          .update({ updated_at: new Date().toISOString() })
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