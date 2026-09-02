import { createClient } from "npm:@supabase/supabase-js@2";
import { createOpenAI } from "npm:@ai-sdk/openai@4";
import { streamText } from "npm:ai@7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const PREMIUM_MODEL = Deno.env.get("OPENAI_PREMIUM_MODEL") || "gpt-5.6-terra";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
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
  const multiFactor = question.length >= 320 && hotelTopic;
  return (hotelTopic && problemSolving) || multiFactor;
}

function requestedScope(question: string): "revenue" | "housekeeping" | "maintenance" | "reception" | null {
  const q = question.toLowerCase();
  if (/\b(sales?|sold|bookings?|booked|pickup|pace|revenue|adr|revpar|occupancy|rates?|prices?|pricing|demand|automation|min.?stay)\b/.test(q)) return "revenue";
  if (/\b(housekeep|cleaning|dirty room|inspected room|room assignment|linen|towel)\b/.test(q)) return "housekeeping";
  if (/\b(maintenance|ticket|repair|broken|sla|overdue issue)\b/.test(q)) return "maintenance";
  if (/\b(arrival|departure|check.?in|check.?out|breakfast|reservation|front office|reception)\b/.test(q)) return "reception";
  return null;
}

function allowedScopes(role: string) {
  if (["admin", "manager", "top_management", "top_management_manager"].includes(role)) return new Set(["revenue", "housekeeping", "maintenance", "reception"]);
  if (["housekeeping", "housekeeping_manager", "supervisor"].includes(role)) return new Set(["housekeeping"]);
  if (["maintenance", "maintenance_manager"].includes(role)) return new Set(["maintenance"]);
  if (["reception", "reception_manager", "front_office", "breakfast_staff"].includes(role)) return new Set(["reception"]);
  if (role === "back_office_manager") return new Set(["housekeeping", "maintenance", "reception"]);
  return new Set<string>();
}

function budapestDay(value: string | Date = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(day: string, amount: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
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

function selectedHotels(question: string, page: any, hotels: any[]) {
  const q = question.toLowerCase();
  const named = hotels.filter((h) => q.includes(String(h.hotel_name ?? "").toLowerCase()) || q.includes(String(h.hotel_id ?? "").toLowerCase()));
  if (named.length) return named.slice(0, 5);
  const pageHotel = String(page?.hotelId ?? "").toLowerCase();
  if (pageHotel) {
    const match = hotels.find((h) => String(h.hotel_id).toLowerCase() === pageHotel || String(h.hotel_name).toLowerCase() === pageHotel);
    if (match) return [match];
  }
  return hotels.slice(0, 5);
}

function revenueSummary(payload: any, today: string) {
  const nights = Array.isArray(payload?.nights) ? payload.nights : [];
  const cancellations = Array.isArray(payload?.cancellations) ? payload.cancellations : [];
  const snapshots = Array.isArray(payload?.snapshots) ? payload.snapshots : [];
  const roomTypes = Array.isArray(payload?.roomTypes) ? payload.roomTypes : [];
  const rates = Array.isArray(payload?.rates) ? payload.rates : [];
  const settings = payload?.settings ?? {};
  const inventoryFromTypes = roomTypes
    .filter((r: any) => r?.is_sellable !== false && r?.counts_toward_inventory !== false)
    .reduce((sum: number, r: any) => sum + Number(r?.num_rooms ?? 0), 0);
  const snapshotRooms = Number(snapshots.find((s: any) => s?.stay_date === today)?.rooms_available ?? snapshots[0]?.rooms_available ?? 0);
  const roomsAvailable = Number(settings?.sellable_rooms ?? 0) || (snapshotRooms > 0 && inventoryFromTypes > snapshotRooms * 1.2 ? snapshotRooms : inventoryFromTypes) || snapshotRooms;

  const byStay = new Map<string, { sold: number; revenue: number }>();
  for (const n of nights) {
    const date = String(n?.stay_date ?? "");
    if (!date) continue;
    const row = byStay.get(date) ?? { sold: 0, revenue: 0 };
    row.sold += 1;
    row.revenue += Number(n?.nightly_price_eur ?? 0);
    byStay.set(date, row);
  }
  const todayStay = byStay.get(today) ?? { sold: 0, revenue: 0 };
  const todayCreated = nights.filter((n: any) => n?.created_at_pms && budapestDay(n.created_at_pms) === today);
  const bookingUnits = new Set(todayCreated.map((n: any) => `${n?.res_id ?? ""}|${n?.room_key ?? ""}`));
  const cancelledToday = cancellations.filter((c: any) => c?.cancelled_at && budapestDay(c.cancelled_at) === today);
  const cancelledUnits = new Set(cancelledToday.map((c: any) => `${c?.res_id ?? ""}|${c?.room_key ?? ""}`));
  const affectedDates = [...new Set(todayCreated.map((n: any) => String(n?.stay_date ?? "")).filter(Boolean))].sort();
  const from = today;
  const to = addDays(today, 30);
  const next30 = [...byStay.entries()]
    .filter(([date]) => date >= from && date <= to)
    .map(([date, row]) => ({
      stay_date: date,
      rooms_sold: row.sold,
      rooms_available: roomsAvailable,
      rooms_left: Math.max(0, roomsAvailable - row.sold),
      occupancy_pct: roomsAvailable ? Math.round((row.sold / roomsAvailable) * 1000) / 10 : null,
      revenue_eur: Math.round(row.revenue * 100) / 100,
      adr_eur: row.sold ? Math.round((row.revenue / row.sold) * 100) / 100 : null,
    }))
    .sort((a, b) => a.stay_date.localeCompare(b.stay_date));
  const weakDates = [...next30]
    .filter((d: any) => d.occupancy_pct !== null)
    .sort((a: any, b: any) => a.occupancy_pct - b.occupancy_pct)
    .slice(0, 10);
  const nextRates = rates
    .filter((r: any) => r?.stay_date >= today && r?.stay_date <= addDays(today, 14))
    .slice(0, 120)
    .map((r: any) => ({ stay_date: r.stay_date, room_type: r.room_type_name, occupancy: r.occupancy, price: r.price, currency: r.currency ?? "EUR" }));

  return {
    today_stay_date: {
      rooms_sold: todayStay.sold,
      rooms_available: roomsAvailable,
      occupancy_pct: roomsAvailable ? Math.round((todayStay.sold / roomsAvailable) * 1000) / 10 : null,
      room_revenue_eur: Math.round(todayStay.revenue * 100) / 100,
      adr_eur: todayStay.sold ? Math.round((todayStay.revenue / todayStay.sold) * 100) / 100 : null,
    },
    sales_created_today: {
      booking_units: bookingUnits.size,
      room_nights: todayCreated.length,
      new_room_revenue_eur: Math.round(todayCreated.reduce((s: number, n: any) => s + Number(n?.nightly_price_eur ?? 0), 0) * 100) / 100,
      cancellations: cancelledUnits.size,
      net_booking_units: bookingUnits.size - cancelledUnits.size,
      affected_future_stay_dates: affectedDates.slice(0, 40),
    },
    weak_next_30_days: weakDates,
    current_rates_next_14_days: nextRates,
  };
}

async function buildContext(db: any, profile: any, hotels: any[], question: string, page: any, scope: string | null) {
  const today = budapestDay();
  const picked = selectedHotels(question, page, hotels);
  const context: any = {
    now: {
      timezone: "Europe/Budapest",
      today,
      local_datetime: new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Budapest", dateStyle: "full", timeStyle: "long" }).format(new Date()),
    },
    properties: picked.map((h) => ({ id: h.hotel_id, name: h.hotel_name })),
    scope,
  };

  if (scope === "revenue") {
    const ids = picked.map((h) => h.hotel_id);
    const [published, rules, actions, events] = await Promise.all([
      db.from("revenue_published_payloads").select("hotel_id,sync_completed_at,payload").in("hotel_id", ids).limit(10),
      db.from("revenue_pickup_automation_rules").select("hotel_id,is_enabled,auto_publish,minimum_adr,maximum_increase,no_pickup_enabled,no_pickup_decrease,low_occupancy_pct,high_occupancy_pct,last_run_at,last_run_status,last_error,updated_at").eq("organization_slug", profile.organization_slug).in("hotel_id", ids).limit(20),
      db.from("revenue_pickup_automation_actions").select("hotel_id,stay_date,room_type_name,old_price,new_price,decision_type,decision_reason,reason_detail,net_pickup,status,push_error,created_at").eq("organization_slug", profile.organization_slug).in("hotel_id", ids).order("created_at", { ascending: false }).limit(80),
      db.from("demand_events").select("hotel_id,title,category,event_date,end_date,expected_impact,surcharge_eur,confidence,approved").eq("organization_slug", profile.organization_slug).in("hotel_id", ids).gte("event_date", today).lte("event_date", addDays(today, 60)).order("event_date").limit(100),
    ]);
    context.revenue = (published.data ?? []).map((row: any) => ({
      hotel_id: row.hotel_id,
      hotel_name: picked.find((h) => h.hotel_id === row.hotel_id)?.hotel_name ?? row.hotel_id,
      dataset_last_synced_at: row.sync_completed_at,
      ...revenueSummary(row.payload, today),
    }));
    context.automation_rules = rules.data ?? [];
    context.recent_automation_activity = actions.data ?? [];
    context.demand_events = events.data ?? [];
  }

  if (scope === "housekeeping") {
    const keys = [...new Set(picked.flatMap((h) => [h.hotel_id, h.hotel_name]).filter(Boolean))];
    const { data: rooms } = await db.from("rooms").select("id,room_number,hotel,status,is_checkout_room,is_dnd,towel_change_required,linen_change_required,pms_metadata").eq("organization_slug", profile.organization_slug).in("hotel", keys).limit(1000);
    const roomIds = (rooms ?? []).map((r: any) => r.id);
    const { data: assignments } = roomIds.length
      ? await db.from("room_assignments").select("room_id,assigned_to,status,assignment_type,started_at,completed_at,ready_to_clean,supervisor_approved").eq("organization_slug", profile.organization_slug).in("room_id", roomIds).eq("assignment_date", today).limit(1000)
      : { data: [] };
    context.housekeeping = { rooms: rooms ?? [], assignments: assignments ?? [] };
  }

  if (scope === "maintenance") {
    const keys = [...new Set(picked.flatMap((h) => [h.hotel_id, h.hotel_name]).filter(Boolean))];
    const { data } = await db.from("tickets").select("ticket_number,title,status,priority,room_number,hotel,sla_due_date,created_at,on_hold,hold_reason").eq("organization_slug", profile.organization_slug).in("hotel", keys).neq("status", "completed").order("created_at", { ascending: false }).limit(120);
    context.maintenance = data ?? [];
  }

  if (scope === "reception") {
    const ids = picked.map((h) => h.hotel_id);
    const { data } = await db.from("daily_overview_snapshots").select("hotel_id,business_date,room_label,room_number,arrival_date,departure_date,status,pax,breakfast").eq("organization_slug", profile.organization_slug).in("hotel_id", ids).or(`arrival_date.eq.${today},departure_date.eq.${today},business_date.eq.${today}`).limit(1500);
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
    const { data } = await db.from("hotel_configurations").select("hotel_id,hotel_name").eq("organization_id", org.id).eq("is_active", true).order("hotel_name");
    hotels = data ?? [];
  }
  if (!hotels.length && profile.assigned_hotel) hotels = [{ hotel_id: profile.assigned_hotel, hotel_name: profile.assigned_hotel }];

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
    const { data: stored } = await db.from("assistant_messages").select("role,content,created_at").eq("thread_id", threadId).eq("user_id", authData.user.id).order("created_at", { ascending: true }).limit(30);
    const history = (stored ?? []).slice(-20).map((row: any) => ({ role: row.role === "assistant" ? "assistant" : "user", content: String(row.content ?? "").slice(0, 5000) }));

    const { error: userSaveError } = await db.from("assistant_messages").insert({ thread_id: threadId, user_id: authData.user.id, role: "user", content: question, refused: false });
    if (userSaveError) {
      await finalize(false);
      return json({ error: "Could not save your question" }, 500);
    }

    const openai = createOpenAI({ apiKey: openAiKey });
    const result = streamText({
      model: openai.responses(PREMIUM_MODEL),
      system: `You are HotelCare Deep Analysis, the higher-intelligence escalation tier inside HotelCare.app. The user has spent one scarce deep-analysis allowance, so make the answer materially more useful than a generic chatbot reply.

Current hotel-local timezone is Europe/Budapest. The authoritative current date/time is included in CURRENT HOTELCARE CONTEXT. Resolve today/yesterday/tomorrow from it exactly.

For revenue language, distinguish these carefully:
- “sales today”, “sold today”, “bookings today” = reservations/booking units created today, unless the user explicitly asks about guests staying today.
- “sold for today”, “occupancy today” = rooms occupied/sold for today’s stay date.
Never substitute a rolling 48-hour pickup figure for exact same-day sales. If exact same-day booking creation data is present, use it.

Lead with a diagnosis. Then show the most important evidence with exact numbers and dates. Then give 3-5 concrete actions in priority order. For revenue problems, protect ADR and do not recommend blind discounting; consider occupancy, rooms left, booking-created-today sales, cancellations, future weak dates, current rates, demand/events and automation behavior. If the data is incomplete or stale, say exactly what is missing rather than guessing.

Do not expose table names, database fields, internal ids, tools, model names, quotas, or implementation details. Never claim you changed a rate, room, ticket or setting. Keep the answer practical for a hotel manager.`,
      messages: [
        ...history,
        {
          role: "user",
          content: `${question}\n\nCURRENT HOTELCARE CONTEXT (authoritative for this turn):\n${JSON.stringify(context).slice(0, 120000)}`,
        },
      ] as any,
      abortSignal: req.signal,
      providerOptions: { openai: { store: false, reasoningEffort: "high", reasoningSummary: "auto" } },
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
        const { error: saveError } = await db.from("assistant_messages").insert({ thread_id: threadId, user_id: authData.user.id, role: "assistant", content: answer, model: PREMIUM_MODEL, refused: false });
        if (saveError) {
          console.error("premium answer save failed", saveError);
          await finalize(false);
          return;
        }
        await db.from("assistant_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId).eq("user_id", authData.user.id);
        await db.from("assistant_audit_log").insert({
          user_id: authData.user.id,
          organization_slug: profile.organization_slug,
          hotel_id: profile.assigned_hotel,
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
