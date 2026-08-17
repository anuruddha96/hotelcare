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

type Profile = {
  id: string;
  role: string;
  assigned_hotel: string | null;
  organization_slug: string | null;
  preferred_language: string | null;
};

type Scope = "revenue" | "housekeeping" | "maintenance" | "reception";

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
    return new Set(["revenue", "housekeeping", "maintenance", "reception"]);
  }
  if (["housekeeping", "housekeeping_manager", "supervisor"].includes(role)) return new Set(["housekeeping"]);
  if (["maintenance", "maintenance_manager"].includes(role)) return new Set(["maintenance"]);
  if (["reception", "reception_manager", "front_office"].includes(role)) return new Set(["reception"]);
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
  return null;
}

function buildTools(service: any, profile: Profile, scopes: Set<Scope>) {
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
  };

  if (scopes.has("revenue")) {
    tools.get_revenue_metrics = tool({
      description: "Read revenue metrics for dates inside the user's authorized hotel and organization only.",
      inputSchema: jsonSchema<{ startDate: string | null; endDate: string | null }>({
        type: "object",
        properties: {
          startDate: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
          endDate: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
        },
        required: ["startDate", "endDate"],
        additionalProperties: false,
      }),
      execute: async ({ startDate, endDate }) => {
        const today = new Date().toISOString().slice(0, 10);
        const from = startDate ?? today;
        const to = endDate ?? from;
        let query = service
          .from("revenue_daily_snapshots")
          .select("stay_date,captured_date,occupancy_pct,adr_eur,revenue_eur,rooms_sold,rooms_available")
          .gte("stay_date", from)
          .lte("stay_date", to)
          .eq("organization_slug", profile.organization_slug)
          .eq("hotel_id", profile.assigned_hotel)
          .order("stay_date")
          .limit(370);
        const { data, error } = await query;
        if (error) throw new Error(`Revenue lookup failed: ${error.message}`);
        return { from, to, rows: data ?? [] };
      },
    });
  }

  if (scopes.has("housekeeping")) {
    tools.get_housekeeping_status = tool({
      description: "Read room status and today's assignments inside the user's authorized hotel and organization only.",
      inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {}, required: [], additionalProperties: false }),
      execute: async () => {
        const roomsQuery = service
          .from("rooms")
          .select("id,room_number,status")
          .eq("organization_slug", profile.organization_slug)
          .eq("hotel", profile.assigned_hotel)
          .limit(500);
        const rooms = await roomsQuery;
        if (rooms.error) throw new Error(`Room lookup failed: ${rooms.error.message}`);
        const roomIds = (rooms.data ?? []).map((room: any) => room.id);
        const assignments = roomIds.length
          ? await service
              .from("room_assignments")
              .select("id,room_id,assigned_to,status,started_at,completed_at")
              .eq("organization_slug", profile.organization_slug)
              .in("room_id", roomIds)
              .eq("assignment_date", new Date().toISOString().slice(0, 10))
              .limit(500)
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
      description: "Read maintenance tickets inside the user's authorized hotel and organization only.",
      inputSchema: jsonSchema<{ status: string | null }>({
        type: "object",
        properties: { status: { type: ["string", "null"], description: "open, in_progress, completed, or null" } },
        required: ["status"],
        additionalProperties: false,
      }),
      execute: async ({ status }) => {
        let query = service
          .from("tickets")
          .select("id,ticket_number,title,description,status,priority,room_number,sla_due_date,created_at")
          .eq("organization_slug", profile.organization_slug)
          .eq("hotel", profile.assigned_hotel)
          .order("created_at", { ascending: false })
          .limit(100);
        if (status) query = query.eq("status", status);
        const { data, error } = await query;
        if (error) throw new Error(`Maintenance lookup failed: ${error.message}`);
        return { tickets: data ?? [] };
      },
    });
  }

  if (scopes.has("reception")) {
    tools.get_reception_overview = tool({
      description: "Read arrivals, departures, room status, and breakfast counts inside the user's authorized hotel and organization only. Never returns guest personal details.",
      inputSchema: jsonSchema<{ date: string | null }>({
        type: "object",
        properties: { date: { type: ["string", "null"], description: "YYYY-MM-DD or null for today" } },
        required: ["date"],
        additionalProperties: false,
      }),
      execute: async ({ date }) => {
        const target = date ?? new Date().toISOString().slice(0, 10);
        let reservationsQuery = service
          .from("reservations")
          .select("id,check_in_date,check_out_date,status")
          .eq("organization_slug", profile.organization_slug)
          .eq("hotel_id", profile.assigned_hotel)
          .or(`check_in_date.eq.${target},check_out_date.eq.${target}`)
          .limit(500);
        let breakfastQuery = service
          .from("breakfast_roster")
          .select("id,stay_date,breakfast_count")
          .eq("organization_slug", profile.organization_slug)
          .eq("hotel_id", profile.assigned_hotel)
          .eq("stay_date", target)
          .limit(500);
        const [reservations, breakfast] = await Promise.all([reservationsQuery, breakfastQuery]);
        if (reservations.error) throw new Error(`Reservation lookup failed: ${reservations.error.message}`);
        if (breakfast.error) throw new Error(`Breakfast lookup failed: ${breakfast.error.message}`);
        const rows = reservations.data ?? [];
        return {
          date: target,
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
    const modelId = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
    const result = streamText({
      model: openai.responses(modelId),
      system: `You are the Hotel Care Assistant. Be concise, practical, and accurate.
Reply in ${language}; if the latest user message is clearly in another language, reply in that language instead.
The authenticated user's role is ${profile.role}. Their organization is ${profile.organization_slug ?? "none"} and hotel/venue is ${profile.assigned_hotel ?? "none"}.
Use tools for live hotel facts. Never invent internal data. Never reveal another organization, hotel, venue, guest identity, credential, staff pay, or information outside the available tools.
Unavailable tools are unavailable because of authorization. If asked for an unauthorized data area, say access is required without speculating about the data.
For general knowledge, answer normally. For Hotel Care usage questions, use the workflow reference tool.`,
      messages: await convertToModelMessages(modelMessages),
      tools: buildTools(service, profile as Profile, scopes),
      stopWhen: stepCountIs(50),
      abortSignal: req.signal,
      providerOptions: { openai: { store: false } },
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