// Quick signals, sharpened by OpenAI directly (the hotel's own OPENAI_API_KEY,
// not the Lovable gateway).
//
// The client sends the evidence it already computed from Previo data — today's
// KPIs, the ADR leakage tables and the heuristic signals. The model re-reads
// that evidence, drops anything the numbers do not support, and returns a
// short, ranked list of concrete actions. Nothing is invented: every signal
// must quote figures that appear in the payload.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = Deno.env.get("OPENAI_SIGNALS_MODEL") ?? "gpt-5";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["signals", "headline"],
  properties: {
    headline: { type: "string" },
    signals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "title", "why", "action", "tone", "priority", "confidence"],
        properties: {
          key: { type: "string" },
          title: { type: "string" },
          why: { type: "string" },
          action: { type: "string" },
          tone: { type: "string", enum: ["good", "warn", "bad"] },
          priority: { type: "integer" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
  },
} as const;

const SYSTEM = [
  "You are a hotel revenue manager reviewing one property's bookings created today.",
  "You are given verified figures pulled from the property's PMS plus draft heuristic signals.",
  "Return only signals that the supplied numbers support. Never invent a figure, a date, a channel or a room type that is not in the payload.",
  "Each signal: a short imperative title, a one-sentence 'why' quoting the actual numbers, and an 'action' the manager can do in the next hour.",
  "Drop weak or duplicate heuristics. Rank by revenue impact, priority 1 = act first. At most 6 signals.",
  "Use a stable lowercase slug for 'key' (for example 'channel-booking-com-below-target').",
  "Currency amounts must be written in the currency given in the payload.",
].join(" ");

/** Read the whole SSE stream and return the concatenated output text. */
async function readResponsesStream(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buf = "";
  let out = "";
  let completed = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload);
        if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") out += evt.delta;
        if (evt.type === "response.completed" && typeof evt.response?.output_text === "string") {
          completed = evt.response.output_text;
        }
      } catch { /* partial frame */ }
    }
  }
  return out || completed;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!token) return json({ error: "Not signed in" }, 401);
    const { data: userRes } = await admin.auth.getUser(token);
    const user = userRes?.user;
    if (!user) return json({ error: "Not signed in" }, 401);

    const { data: profile } = await admin
      .from("profiles")
      .select("role, assigned_hotel, organization_slug")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile) return json({ error: "Profile not found" }, 403);

    const body = await req.json().catch(() => ({}));
    const hotelId: string = String(body.hotelId ?? "");
    if (!hotelId) return json({ error: "hotelId is required" }, 400);

    const { data: allowed } = await admin.rpc("user_can_access_hotel", {
      _uid: user.id,
      _hotel_id: hotelId,
    });
    if (allowed === false) return json({ error: "No access to this hotel" }, 403);

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return json({ error: "OPENAI_API_KEY is not configured for this project." }, 500);
    }

    const businessDate: string = typeof body.businessDate === "string"
      ? body.businessDate
      : new Date().toISOString().slice(0, 10);
    const evidence = body.evidence ?? {};

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        reasoning: { effort: "high" },
        instructions: SYSTEM,
        input: [{
          role: "user",
          content: [{
            type: "input_text",
            text: `Property: ${hotelId}. Business date: ${businessDate}.\nEvidence JSON:\n${JSON.stringify(evidence).slice(0, 60000)}`,
          }],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "revenue_signals",
            strict: true,
            schema: SCHEMA,
          },
        },
      }),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 500);
      await admin.from("revenue_signal_runs").insert({
        hotel_id: hotelId,
        organization_slug: profile.organization_slug,
        business_date: businessDate,
        model: MODEL,
        signals: [],
        error: detail,
      });
      return json({ error: `OpenAI rejected the request (${res.status}): ${detail}` }, res.status === 429 ? 429 : 502);
    }

    const text = await readResponsesStream(res);
    let parsed: { headline?: string; signals?: unknown[] } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      return json({ error: "The model returned an unreadable answer. Try again." }, 502);
    }
    const signals = Array.isArray(parsed.signals) ? parsed.signals : [];

    await admin.from("revenue_signal_runs").insert({
      hotel_id: hotelId,
      organization_slug: profile.organization_slug,
      business_date: businessDate,
      model: MODEL,
      signals,
    });

    return json({ ok: true, model: MODEL, headline: parsed.headline ?? null, signals });
  } catch (e) {
    console.error("revenue-signals error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
