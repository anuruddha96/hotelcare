import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth");

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: userRes, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userRes?.user) throw new Error("Unauthorized");

    const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, organization_slug")
      .eq("id", userRes.user.id)
      .single();
    if (!profile || !["admin", "top_management"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { hotel_id, focus_date, horizon_days = 120 } = await req.json();
    if (!hotel_id) throw new Error("hotel_id required");

    const today = new Date();
    const horizon = new Date();
    horizon.setUTCDate(horizon.getUTCDate() + horizon_days);
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 30);

    const [{ data: snapshots }, { data: settings }, { data: history }, { data: pendingRecs }, { data: hotel }] =
      await Promise.all([
        supabase.from("pickup_snapshots").select("stay_date,bookings_current,bookings_last_year,delta,captured_at")
          .eq("hotel_id", hotel_id)
          .gte("captured_at", cutoff.toISOString())
          .order("captured_at", { ascending: false })
          .limit(2000),
        supabase.from("hotel_revenue_settings").select("*").eq("hotel_id", hotel_id).maybeSingle(),
        supabase.from("rate_history").select("stay_date,new_rate_eur,changed_at")
          .eq("hotel_id", hotel_id)
          .gte("stay_date", today.toISOString().slice(0, 10))
          .lte("stay_date", horizon.toISOString().slice(0, 10))
          .order("changed_at", { ascending: false })
          .limit(500),
        supabase.from("rate_recommendations").select("stay_date,recommended_rate_eur,delta_eur,reason,status")
          .eq("hotel_id", hotel_id).eq("status", "pending").limit(200),
        supabase.from("hotel_configurations").select("hotel_name").eq("hotel_id", hotel_id).maybeSingle(),
      ]);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const systemPrompt = `You are a hotel revenue management analyst for ${hotel?.hotel_name ?? hotel_id}.
You are given recent pickup snapshots (bookings for each stay date over time), the current rate history, the engine settings, and any pending rate recommendations.
Your job: identify which stay dates in the next ${horizon_days} days are best candidates to RAISE prices (strong pickup, demand signals, sell-out risk) and which are best to LOWER prices (no pickup, weak demand vs last year, far out with empty inventory).
Be concrete: name specific dates. Suggest a delta in EUR (respect floor price ${settings?.floor_price_eur ?? "n/a"} and max daily change ${settings?.max_daily_change_eur ?? "n/a"}).
Provide a short executive summary the revenue manager can read in 10 seconds.
${focus_date ? `Focus your analysis on ${focus_date}.` : ""}`;

    const userPayload = {
      today: today.toISOString().slice(0, 10),
      settings,
      snapshots: snapshots ?? [],
      rate_history: history ?? [],
      pending_recommendations: pendingRecs ?? [],
    };

    const aiBody = {
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Analyze this data and return structured findings:\n" + JSON.stringify(userPayload).slice(0, 60000) },
      ],
      tools: [{
        type: "function",
        function: {
          name: "submit_analysis",
          description: "Return structured revenue findings.",
          parameters: {
            type: "object",
            properties: {
              summary: { type: "string", description: "2-4 sentence executive summary." },
              top_increase_dates: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    date: { type: "string" },
                    reason: { type: "string" },
                    suggested_delta_eur: { type: "number" },
                    confidence: { type: "string", enum: ["low", "medium", "high"] },
                  },
                  required: ["date", "reason", "suggested_delta_eur", "confidence"],
                },
              },
              top_decrease_dates: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    date: { type: "string" },
                    reason: { type: "string" },
                    suggested_delta_eur: { type: "number" },
                    confidence: { type: "string", enum: ["low", "medium", "high"] },
                  },
                  required: ["date", "reason", "suggested_delta_eur", "confidence"],
                },
              },
              anomalies: {
                type: "array",
                items: {
                  type: "object",
                  properties: { date: { type: "string" }, note: { type: "string" } },
                  required: ["date", "note"],
                },
              },
              strategy_notes: { type: "string" },
            },
            required: ["summary", "top_increase_dates", "top_decrease_dates", "anomalies", "strategy_notes"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "submit_analysis" } },
    };

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(aiBody),
    });

    if (aiResp.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded, try again shortly." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (aiResp.status === 402) {
      return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Lovable Workspace settings." }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!aiResp.ok) {
      const t = await aiResp.text();
      throw new Error(`AI gateway ${aiResp.status}: ${t.slice(0, 200)}`);
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("AI returned no structured output");
    const payload = JSON.parse(toolCall.function.arguments);

    await supabase.from("revenue_ai_insights").insert({
      hotel_id,
      organization_slug: profile.organization_slug,
      focus_date: focus_date ?? null,
      payload,
      generated_by: userRes.user.id,
    });

    return new Response(JSON.stringify({ ok: true, payload }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("revenue-ai-analyze error:", e);
    return new Response(JSON.stringify({ error: e.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
