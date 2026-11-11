// "Where should I start?" — the opening screen of the HotelCare AI workspace.
//
// Returns a short, role-scoped list of things worth acting on right now. It
// is computed from Hotel Care data with fixed rules: no language model runs
// here, so opening the workspace costs nothing and does not use a message.
//
// Every card carries the question it would ask. Tapping a card starts a normal
// assistant conversation, where the usual role checks apply again.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { pickHotels, resolveAssistantHotels } from "../_shared/assistantHotels.ts";
import { scopesForRole } from "../_shared/assistantScopes.ts";
import { buildWorkspaceTools } from "../_shared/assistantWorkspace.ts";
import { loadRevenueDataset, type RevenueDataset } from "../_shared/revenueMetrics.ts";

type Card = {
  id: string;
  tone: "priority" | "opportunity" | "good";
  area: "revenue" | "reputation" | "maintenance" | "restaurant";
  title: string;
  detail: string;
  prompt: string;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function niceDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
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
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Configuration incomplete" }, 500);

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await authClient.auth.getUser(authHeader.slice(7));
    if (userError || !userData.user) return json({ error: "Invalid session" }, 401);

    const { data: profile } = await service
      .from("profiles")
      .select("id,role,assigned_hotel,organization_slug")
      .eq("id", userData.user.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!profile) return json({ error: "Profile not found" }, 403);

    const body = await req.json().catch(() => ({}));
    const scopes = new Set<string>(scopesForRole(profile.role));
    const hotels = await resolveAssistantHotels(service, profile);
    if (!hotels.length) return json({ cards: [], hotel: null });

    // One hotel for the revenue cards: the screen the user is on if it is one
    // of theirs, otherwise their own hotel, otherwise the first of the group.
    const requested = typeof body?.hotelId === "string" ? body.hotelId : null;
    const focus =
      (requested && hotels.find((h) => h.hotel_id === requested)) ||
      hotels.find((h) => h.hotel_id === profile.assigned_hotel) ||
      hotels[0];

    const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", dateStyle: "short" }).format(new Date());
    const datasetCache = new Map<string, Promise<RevenueDataset | null>>();
    const tools = buildWorkspaceTools({
      service,
      profile,
      scopes,
      hotels,
      resolve: (value) => {
        const picked = pickHotels(hotels, value);
        if (!picked.ok) throw new Error(picked.error);
        return picked.hotels.map((h) => h.hotel_id);
      },
      revenueDatasets: async (value) => {
        const picked = pickHotels(hotels, value);
        if (!picked.ok) throw new Error(picked.error);
        return await Promise.all(
          picked.hotels.map(async (hotel) => {
            if (!datasetCache.has(hotel.hotel_id)) datasetCache.set(hotel.hotel_id, loadRevenueDataset(service as any, hotel.hotel_id, hotel.hotel_name));
            return { hotel, dataset: await datasetCache.get(hotel.hotel_id)! };
          }),
        );
      },
      today,
      openAiKey: "",
      pageHotelId: focus.hotel_id,
      attachments: [],
    });
    const call = async (name: string, input: Record<string, unknown>) => {
      if (!tools[name]) return null;
      try {
        return await tools[name].execute(input, { toolCallId: "priorities", messages: [] });
      } catch (error) {
        console.error(`assistant-priorities ${name} failed`, error);
        return null;
      }
    };

    const [review, reputation, restaurant, tickets] = await Promise.all([
      call("review_pricing", { hotelId: focus.hotel_id, startDate: null, days: 21 }),
      call("get_reputation_overview", { days: 14 }),
      call("get_restaurant_reservations", { hotelId: null, startDate: null, endDate: null }),
      scopes.has("maintenance")
        ? service
            .from("tickets")
            .select("id,priority,status,sla_due_date,hotel")
            .eq("organization_slug", profile.organization_slug)
            .in("hotel", [...new Set(hotels.flatMap((h) => [h.hotel_id, h.hotel_name]))])
            .neq("status", "completed")
            .limit(500)
        : Promise.resolve({ data: null }),
    ]);

    const cards: Card[] = [];
    const name = focus.hotel_name;

    const dates: any[] = review?.data?.dates ?? [];
    if (dates.length) {
      const eventRaise = dates.filter((d) => d.event_impact === "high" && d.stance === "raise");
      const eventWatch = dates.filter((d) => d.event_impact === "high" && d.stance === "protect");
      const scarce = dates.filter((d) => d.event_impact !== "high" && d.stance === "raise" && (d.rooms_left ?? 99) <= 3);
      const slow = dates.filter((d) => d.stance === "lower");
      if (eventRaise.length) {
        const first = eventRaise[0];
        cards.push({
          id: "rev-event",
          tone: "priority",
          area: "revenue",
          title: `Price up for ${first.events[0] ?? "the event"} · ${niceDate(first.stay_date)}`,
          detail: `${name}: ${eventRaise.length} event night${eventRaise.length === 1 ? "" : "s"} with demand confirming. Occupancy ${Math.round(first.occupancy_pct)}%, entry rate €${Math.round(first.entry_rate)}.`,
          prompt: `Review pricing for ${name} for the next 21 days. Focus on the high-impact event dates and propose the rate changes.`,
        });
      } else if (eventWatch.length) {
        const first = eventWatch[0];
        cards.push({
          id: "rev-event-watch",
          tone: "opportunity",
          area: "revenue",
          title: `Watch ${first.events[0] ?? "the event"} · ${niceDate(first.stay_date)}`,
          detail: `${name}: ${eventWatch.length} event night${eventWatch.length === 1 ? "" : "s"} where the rate should be held, not discounted.`,
          prompt: `How is ${name} positioned for ${first.events[0] ?? "the upcoming event"} around ${first.stay_date}? Show occupancy, pickup and our rate against competitors as a chart.`,
        });
      }
      if (scarce.length) {
        cards.push({
          id: "rev-scarce",
          tone: "priority",
          area: "revenue",
          title: `Last rooms on ${scarce.length} night${scarce.length === 1 ? "" : "s"}`,
          detail: `${name}: ${scarce.slice(0, 3).map((d) => `${niceDate(d.stay_date)} (${d.rooms_left} left)`).join(", ")}. Protect the rate on what remains.`,
          prompt: `Review pricing for ${name} for the next 21 days. Which nearly sold-out nights should go up, and by how much?`,
        });
      }
      if (slow.length) {
        cards.push({
          id: "rev-slow",
          tone: "opportunity",
          area: "revenue",
          title: `${slow.length} slow night${slow.length === 1 ? "" : "s"} priced above the market`,
          detail: `${name}: starting ${niceDate(slow[0].stay_date)} at ${Math.round(slow[0].occupancy_pct)}% occupancy, ${slow[0].position_vs_competitors_pct}% above the competitor median.`,
          prompt: `Review pricing for ${name} for the next 21 days. Which slow dates are priced above competitors and what step do you recommend?`,
        });
      }
      if (!eventRaise.length && !scarce.length && !slow.length && !eventWatch.length) {
        cards.push({
          id: "rev-ok",
          tone: "good",
          area: "revenue",
          title: "Rates are in line for the next 3 weeks",
          detail: `${name}: no date needs a price move today.`,
          prompt: `Show occupancy and our entry rate against the competitor median for ${name} for the next 21 days as a chart.`,
        });
      }
    }

    if (reputation?.data) {
      const lowStar = (reputation.data.reply_first ?? []).length;
      const unanswered = Number(reputation.data.unanswered ?? 0);
      if (lowStar > 0) {
        cards.push({
          id: "rep-low",
          tone: "priority",
          area: "reputation",
          title: `Reply to ${lowStar} low-star review${lowStar === 1 ? "" : "s"}`,
          detail: `${unanswered} Google review${unanswered === 1 ? "" : "s"} unanswered in the last 14 days. Average rating ${reputation.data.average_rating ?? "n/a"}.`,
          prompt: "Which Google reviews need a reply first, and what are guests complaining about most?",
        });
      } else if (unanswered > 0) {
        cards.push({
          id: "rep-open",
          tone: "opportunity",
          area: "reputation",
          title: `${unanswered} review${unanswered === 1 ? "" : "s"} waiting for a reply`,
          detail: `Average rating ${reputation.data.average_rating ?? "n/a"} over the last 14 days.`,
          prompt: "Summarise our Google reviews of the last 14 days and show the weekly rating trend as a chart.",
        });
      } else if (Number(reputation.data.total_reviews ?? 0) > 0) {
        cards.push({
          id: "rep-good",
          tone: "good",
          area: "reputation",
          title: "Every recent review is answered",
          detail: `${reputation.data.total_reviews} reviews in 14 days, average rating ${reputation.data.average_rating}.`,
          prompt: "Summarise what guests praised and criticised in our Google reviews this month.",
        });
      }
    }

    const openTickets: any[] = (tickets as any)?.data ?? [];
    if (openTickets.length) {
      const now = Date.now();
      const breached = openTickets.filter((t) => t.sla_due_date && Date.parse(t.sla_due_date) < now).length;
      const urgent = openTickets.filter((t) => ["urgent", "high"].includes(String(t.priority).toLowerCase())).length;
      if (breached || urgent) {
        cards.push({
          id: "mnt",
          tone: breached ? "priority" : "opportunity",
          area: "maintenance",
          title: breached ? `${breached} maintenance ticket${breached === 1 ? "" : "s"} past due` : `${urgent} high-priority ticket${urgent === 1 ? "" : "s"} open`,
          detail: `${openTickets.length} open in total${urgent ? `, ${urgent} high priority` : ""}.`,
          prompt: "Which maintenance tickets are overdue or high priority, and who has them?",
        });
      }
    }

    if (restaurant && Number(restaurant.total_reservations ?? 0) > 0) {
      cards.push({
        id: "rest",
        tone: "good",
        area: "restaurant",
        title: `${restaurant.total_reservations} restaurant reservation${restaurant.total_reservations === 1 ? "" : "s"} today`,
        detail: `${restaurant.total_covers} covers booked.`,
        prompt: "Show today's restaurant reservations with times, party sizes and special requests.",
      });
    }

    const rank = { priority: 0, opportunity: 1, good: 2 } as const;
    cards.sort((a, b) => rank[a.tone] - rank[b.tone]);
    return json({ cards: cards.slice(0, 5), hotel: { id: focus.hotel_id, name }, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("assistant-priorities error", error);
    return json({ cards: [], error: "Priorities are unavailable right now" }, 200);
  }
});
