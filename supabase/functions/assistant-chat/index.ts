// Hotel Care Assistant — role-aware, read-only AI helper.
//
// Everything that matters for safety happens here, server-side:
//  * the caller's JWT is validated and the profile is loaded from the database
//  * scopes come from the role, never from the request body
//  * only the tools the role may use are offered to the model
//  * every tool re-applies the organization + hotel filter itself
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import {
  scopesForRole,
  canSeeAllOrganizations,
  type AssistantScope,
} from "../_shared/assistantScopes.ts";
import { searchHowTo } from "../_shared/assistantHowTo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHEAP_MODEL = "gpt-4o-mini";
const SMART_MODEL = "gpt-4o";
const DAILY_LIMIT = 80;

const BUDAPEST = "Europe/Budapest";
function budapestNow() {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: BUDAPEST, dateStyle: "short" }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: BUDAPEST, timeStyle: "short" }).format(now);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: BUDAPEST, weekday: "long" }).format(now);
  return { date, time, weekday };
}

function monthRange(month?: string, from?: string, to?: string) {
  if (from && to) return { from, to };
  const { date } = budapestNow();
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : date.slice(0, 7);
  const start = `${m}-01`;
  const d = new Date(`${m}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return { from: start, to: d.toISOString().slice(0, 10) };
}

interface Ctx {
  supabase: any;
  userId: string;
  role: string;
  orgSlug: string | null;
  hotelId: string | null;
  scopes: AssistantScope[];
  allOrgs: boolean;
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

function toolDefs(ctx: Ctx) {
  const tools: any[] = [
    {
      type: "function",
      name: "get_context_now",
      description:
        "Current date and time in Budapest plus the hotel and organization the user is working in. Call this whenever the question uses today, tomorrow, this month or a weekday.",
      strict: true,
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
    {
      type: "function",
      name: "get_app_howto",
      description:
        "Search the Hotel Care how-to knowledge for the real workflow of a feature (assigning rooms, tickets, prices, breakfast, attendance...).",
      strict: true,
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "What the user wants to do" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  ];

  if (ctx.scopes.includes("revenue")) {
    tools.push({
      type: "function",
      name: "get_revenue_metrics",
      description:
        "Revenue figures for the user's hotel: ADR, occupancy, RevPAR, rooms sold, rooms available and revenue, for a month or a date range.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          month: { type: ["string", "null"], description: "YYYY-MM, e.g. 2027-01" },
          from: { type: ["string", "null"], description: "YYYY-MM-DD" },
          to: { type: ["string", "null"], description: "YYYY-MM-DD" },
        },
        required: ["month", "from", "to"],
        additionalProperties: false,
      },
    });
  }

  if (ctx.scopes.includes("housekeeping")) {
    tools.push({
      type: "function",
      name: "get_housekeeping_status",
      description: "Today's housekeeping picture for the user's hotel: room statuses and assignment progress per housekeeper.",
      strict: true,
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    });
  }

  if (ctx.scopes.includes("maintenance")) {
    tools.push({
      type: "function",
      name: "get_maintenance_tickets",
      description: "Open and overdue maintenance tickets for the user's hotel.",
      strict: true,
      parameters: {
        type: "object",
        properties: { status: { type: ["string", "null"], description: "open, in_progress or completed" } },
        required: ["status"],
        additionalProperties: false,
      },
    });
  }

  if (ctx.scopes.includes("reception")) {
    tools.push({
      type: "function",
      name: "get_front_desk_today",
      description: "Today's reception picture: room statuses, checkout rooms and arrivals/departures counts for the user's hotel.",
      strict: true,
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    });
  }

  return tools;
}

async function runTool(ctx: Ctx, name: string, args: any): Promise<unknown> {
  const { supabase, orgSlug, hotelId } = ctx;
  const scopeGuard = (s: AssistantScope) => {
    if (!ctx.scopes.includes(s)) throw new Error(`not_allowed:${s}`);
  };

  if (name === "get_context_now") {
    const now = budapestNow();
    return { ...now, hotel_id: hotelId, organization: orgSlug, role: ctx.role };
  }

  if (name === "get_app_howto") {
    return { entries: searchHowTo(String(args?.query ?? ""), ctx.scopes) };
  }

  if (!hotelId) return { error: "No hotel is selected for this user." };

  if (name === "get_revenue_metrics") {
    scopeGuard("revenue");
    const { from, to } = monthRange(args?.month ?? undefined, args?.from ?? undefined, args?.to ?? undefined);
    let q = supabase
      .from("revenue_daily_snapshots")
      .select("stay_date,rooms_sold,rooms_available,occupancy_pct,revenue_eur,adr_eur,captured_at")
      .eq("hotel_id", hotelId)
      .gte("stay_date", from)
      .lte("stay_date", to)
      .order("captured_at", { ascending: false })
      .limit(4000);
    if (!ctx.allOrgs && orgSlug) q = q.eq("organization_slug", orgSlug);
    const { data, error } = await q;
    if (error) return { error: error.message };
    // keep the latest capture per stay date
    const latest = new Map<string, any>();
    for (const r of data ?? []) if (!latest.has(r.stay_date)) latest.set(r.stay_date, r);
    const rows = [...latest.values()].sort((a, b) => a.stay_date.localeCompare(b.stay_date));
    const soldTotal = rows.reduce((s, r) => s + (r.rooms_sold ?? 0), 0);
    const availTotal = rows.reduce((s, r) => s + (r.rooms_available ?? 0), 0);
    const revenueTotal = rows.reduce((s, r) => s + Number(r.revenue_eur ?? 0), 0);
    return {
      range: { from, to },
      days: rows.length,
      rooms_sold: soldTotal,
      rooms_available: availTotal,
      rooms_left_to_sell: Math.max(0, availTotal - soldTotal),
      occupancy_pct: availTotal ? Math.round((soldTotal / availTotal) * 1000) / 10 : null,
      adr: soldTotal ? Math.round((revenueTotal / soldTotal) * 100) / 100 : null,
      revpar: availTotal ? Math.round((revenueTotal / availTotal) * 100) / 100 : null,
      revenue_on_the_books: Math.round(revenueTotal),
      daily: rows.slice(0, 45).map((r) => ({
        date: r.stay_date,
        sold: r.rooms_sold,
        available: r.rooms_available,
        occ: r.occupancy_pct,
        adr: r.adr_eur,
      })),
    };
  }

  if (name === "get_housekeeping_status") {
    scopeGuard("housekeeping");
    const { date } = budapestNow();
    let roomsQ = supabase.from("rooms").select("id,room_number,status,is_checkout_room").eq("hotel", hotelId).limit(1000);
    if (!ctx.allOrgs && orgSlug) roomsQ = roomsQ.eq("organization_slug", orgSlug);
    let asgQ = supabase
      .from("room_assignments")
      .select("id,status,assigned_to,assignment_type,room_id")
      .eq("assignment_date", date)
      .limit(1000);
    if (!ctx.allOrgs && orgSlug) asgQ = asgQ.eq("organization_slug", orgSlug);
    const [{ data: rooms }, { data: assignments }] = await Promise.all([roomsQ, asgQ]);
    const roomIds = new Set((rooms ?? []).map((r: any) => r.id));
    const mine = (assignments ?? []).filter((a: any) => roomIds.has(a.room_id));
    const byStatus: Record<string, number> = {};
    for (const r of rooms ?? []) byStatus[r.status ?? "unknown"] = (byStatus[r.status ?? "unknown"] ?? 0) + 1;
    const staffIds = [...new Set(mine.map((a: any) => a.assigned_to).filter(Boolean))];
    const { data: staff } = staffIds.length
      ? await supabase.from("profiles").select("id,full_name,nickname").in("id", staffIds)
      : { data: [] as any[] };
    const nameOf = (id: string) => {
      const p = (staff ?? []).find((s: any) => s.id === id);
      return p?.full_name || p?.nickname || "Unassigned";
    };
    const perStaff: Record<string, { total: number; completed: number; in_progress: number }> = {};
    for (const a of mine) {
      const key = nameOf(a.assigned_to);
      perStaff[key] ??= { total: 0, completed: 0, in_progress: 0 };
      perStaff[key].total += 1;
      if (a.status === "completed") perStaff[key].completed += 1;
      if (a.status === "in_progress") perStaff[key].in_progress += 1;
    }
    return {
      date,
      total_rooms: rooms?.length ?? 0,
      rooms_by_status: byStatus,
      checkout_rooms: (rooms ?? []).filter((r: any) => r.is_checkout_room).length,
      assignments_today: mine.length,
      completed_today: mine.filter((a: any) => a.status === "completed").length,
      per_housekeeper: perStaff,
    };
  }

  if (name === "get_maintenance_tickets") {
    scopeGuard("maintenance");
    let q = supabase
      .from("tickets")
      .select("ticket_number,title,room_number,priority,status,sla_due_date,created_at,on_hold,department")
      .eq("hotel", hotelId)
      .order("created_at", { ascending: false })
      .limit(80);
    if (!ctx.allOrgs && orgSlug) q = q.eq("organization_slug", orgSlug);
    const status = args?.status;
    if (status) q = q.eq("status", status);
    else q = q.in("status", ["open", "in_progress"]);
    const { data, error } = await q;
    if (error) return { error: error.message };
    const nowIso = new Date().toISOString();
    return {
      count: data?.length ?? 0,
      overdue: (data ?? []).filter((t: any) => t.sla_due_date && t.sla_due_date < nowIso && t.status !== "completed").length,
      tickets: data ?? [],
    };
  }

  if (name === "get_front_desk_today") {
    scopeGuard("reception");
    const { date } = budapestNow();
    let roomsQ = supabase.from("rooms").select("room_number,status,is_checkout_room,checkout_time").eq("hotel", hotelId).limit(1000);
    if (!ctx.allOrgs && orgSlug) roomsQ = roomsQ.eq("organization_slug", orgSlug);
    const { data: rooms } = await roomsQ;
    const byStatus: Record<string, number> = {};
    for (const r of rooms ?? []) byStatus[r.status ?? "unknown"] = (byStatus[r.status ?? "unknown"] ?? 0) + 1;
    return {
      date,
      total_rooms: rooms?.length ?? 0,
      rooms_by_status: byStatus,
      checkout_rooms: (rooms ?? []).filter((r: any) => r.is_checkout_room).length,
    };
  }

  return { error: `Unknown tool ${name}` };
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

function systemPrompt(ctx: Ctx, language: string, grants: string[]) {
  const scopeList = ctx.scopes.length ? ctx.scopes.join(", ") : "none (how-to help only)";
  return `You are "Hotel Care Assistant", the in-app helper of the Hotel Care hotel operations platform.

WHO YOU ARE TALKING TO
- Role: ${ctx.role}
- Organization: ${ctx.orgSlug ?? "unknown"}
- Hotel currently selected: ${ctx.hotelId ?? "none"}
- Data areas this person may see: ${scopeList}${grants.length ? ` (temporary approved access: ${grants.join(", ")})` : ""}

WHAT YOU DO
1. Help people use the app. Use get_app_howto before explaining any Hotel Care workflow, and follow it exactly.
2. Answer questions about live hotel data using the tools you were given. Call get_context_now whenever the question involves today, this month or a weekday.
3. Answer light general-knowledge questions normally.

HARD RULES
- You only ever see this person's own organization and hotel. Never mention, compare with, count or speculate about other organizations, other companies' hotels, or the size of the wider group. If asked, say you can only speak about their own property.
- If a question needs a data area that is not in the list above, do NOT guess and do NOT use general knowledge as a substitute. Answer with exactly one line: NEEDS_ACCESS:<area> followed by a short friendly sentence saying they can request approval from their manager. Valid areas: revenue, housekeeping, maintenance, reception.
- Never reveal guest personal data, passwords, credentials, salaries or other staff's private details.
- You are read-only: never claim to have changed a price, an assignment or a ticket. Explain how the person can do it instead.

STYLE
- ALWAYS reply in the same language the person wrote their latest message in. If that is unclear, use ${language}.
- Be short and practical: a couple of sentences or a small markdown list. Give concrete numbers with their date range when you used data.`;
}

/** Short conversation title in the user's own language. */
async function makeTitle(apiKey: string, question: string): Promise<string> {
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: CHEAP_MODEL,
        instructions:
          "Write a 3-5 word title for this chat, in the same language as the message. Plain text, no quotes, no punctuation at the end.",
        input: question.slice(0, 500),
        store: false,
        max_output_tokens: 40,
      }),
    });
    if (!res.ok) return question.slice(0, 60);
    const data = await res.json();
    const t = String(data.output_text ?? "").replace(/["\n]/g, " ").trim();
    return t ? t.slice(0, 60) : question.slice(0, 60);
  } catch {
    return question.slice(0, 60);
  }
}

/* ------------------------------------------------------------------ */

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: userRes, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userRes?.user) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, organization_slug, assigned_hotel, preferred_language, full_name")
      .eq("id", userRes.user.id)
      .maybeSingle();
    if (!profile) return json({ error: "No profile" }, 403);

    const body = await req.json().catch(() => ({}));
    const question = String(body?.question ?? "").slice(0, 4000).trim();
    const threadId = body?.thread_id ? String(body.thread_id) : null;
    if (!question) return json({ error: "question required" }, 400);

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY missing" }, 500);

    // Daily fair-use cap per user.
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await supabase
      .from("assistant_audit_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userRes.user.id)
      .gte("created_at", since);
    if ((count ?? 0) >= DAILY_LIMIT) {
      return json({ error: "You have reached today's assistant limit. Please try again tomorrow." }, 429);
    }

    // Temporary approved scopes.
    const { data: grantRows } = await supabase
      .from("assistant_access_requests")
      .select("requested_scope, expires_at")
      .eq("user_id", userRes.user.id)
      .eq("status", "approved")
      .gt("expires_at", new Date().toISOString());
    const grants = [...new Set((grantRows ?? []).map((g: any) => g.requested_scope))] as AssistantScope[];

    const ctx: Ctx = {
      supabase,
      userId: userRes.user.id,
      role: profile.role,
      orgSlug: profile.organization_slug ?? null,
      hotelId: profile.assigned_hotel ?? null,
      scopes: [...new Set([...scopesForRole(profile.role), ...grants])] as AssistantScope[],
      allOrgs: canSeeAllOrganizations(profile.role),
    };

    // History for this thread (server-side, scoped to the owner).
    let history: any[] = [];
    if (threadId) {
      const { data: msgs } = await supabase
        .from("assistant_messages")
        .select("role, content")
        .eq("thread_id", threadId)
        .eq("user_id", ctx.userId)
        .order("created_at", { ascending: true })
        .limit(30);
      history = (msgs ?? []).map((m: any) => ({
        role: m.role,
        content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }],
      }));
    }

    // Model routing: cheap by default, stronger only for data analysis.
    const dataish = /(adr|revpar|occupanc|pickup|revenue|price|rate|ticket|sla|clean|assign|room|forecast|compare|why|analy)/i.test(
      question,
    );
    const model = dataish && ctx.scopes.length ? SMART_MODEL : CHEAP_MODEL;
    const language = String(body?.language || profile.preferred_language || "English");

    const tools = toolDefs(ctx);
    const input: any[] = [
      ...history,
      { role: "user", content: [{ type: "input_text", text: question }] },
    ];

    const scopesUsed = new Set<string>();
    let answer = "";

    // Tool loop (max 4 rounds), non-streaming per round but each round is short.
    for (let round = 0; round < 4; round++) {
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model,
          instructions: systemPrompt(ctx, language, grants),
          input,
          tools,
          store: false,
          max_output_tokens: 1200,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error("OpenAI error", res.status, text);
        return json({ error: `AI service error (${res.status}). Please try again.` }, res.status === 429 ? 429 : 502);
      }
      const data = await res.json();
      const outputs: any[] = data.output ?? [];
      const calls = outputs.filter((o) => o.type === "function_call");
      answer = (data.output_text ?? "").trim() ||
        outputs
          .filter((o) => o.type === "message")
          .flatMap((o: any) => (o.content ?? []).filter((c: any) => c.type === "output_text").map((c: any) => c.text))
          .join("\n")
          .trim();

      if (!calls.length) break;

      for (const c of outputs) input.push(c);
      for (const c of calls) {
        let result: unknown;
        try {
          result = await runTool(ctx, c.name, JSON.parse(c.arguments || "{}"));
          if (c.name.startsWith("get_revenue")) scopesUsed.add("revenue");
          if (c.name.startsWith("get_housekeeping")) scopesUsed.add("housekeeping");
          if (c.name.startsWith("get_maintenance")) scopesUsed.add("maintenance");
          if (c.name.startsWith("get_front_desk")) scopesUsed.add("reception");
        } catch (e) {
          result = { error: String(e instanceof Error ? e.message : e) };
        }
        input.push({
          type: "function_call_output",
          call_id: c.call_id,
          output: JSON.stringify(result).slice(0, 20000),
        });
      }
    }

    // Refusal detection -> the UI offers a "Request access" button.
    let needsScope: string | null = null;
    const m = answer.match(/NEEDS_ACCESS:\s*(revenue|housekeeping|maintenance|reception)/i);
    if (m) {
      needsScope = m[1].toLowerCase();
      answer = answer.replace(/NEEDS_ACCESS:\s*\w+/i, "").trim();
      if (!answer) {
        answer = `That information sits outside your access. You can ask a manager to approve temporary access.`;
      }
    }
    if (!answer) answer = "I could not produce an answer for that. Please rephrase the question.";

    // Persist + audit.
    if (threadId) {
      await supabase.from("assistant_messages").insert([
        { thread_id: threadId, user_id: ctx.userId, role: "user", content: question },
        {
          thread_id: threadId,
          user_id: ctx.userId,
          role: "assistant",
          content: answer,
          model,
          scopes_used: [...scopesUsed],
          refused: !!needsScope,
        },
      ]);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (history.length === 0) {
        title = await makeTitle(OPENAI_API_KEY, question);
        patch.title = title;
      }
      await supabase
        .from("assistant_threads")
        .update(patch)
        .eq("id", threadId)
        .eq("user_id", ctx.userId);
    }
    await supabase.from("assistant_audit_log").insert({
      user_id: ctx.userId,
      organization_slug: ctx.orgSlug,
      hotel_id: ctx.hotelId,
      role: ctx.role,
      question,
      refused: !!needsScope,
      scopes_used: [...scopesUsed],
      model,
    });

    return json({ answer, model, scopes_used: [...scopesUsed], needs_scope: needsScope });
  } catch (e) {
    console.error("assistant-chat failed", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
