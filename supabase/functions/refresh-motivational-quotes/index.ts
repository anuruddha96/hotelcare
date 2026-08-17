// Monthly refresh of the welcome-screen quote pool.
//
// Runs on a cron once a month (and can be triggered manually by an admin).
// Safety rules that matter here:
//  • Single-flight: a short lease row stops two runs overlapping.
//  • Bounded work: exactly ONE model call asking for a small batch.
//  • Idempotent: quotes are upserted on a normalised key, so a re-run adds nothing twice.
//  • Circuit breaker: 401/402/403 park the job in a paused state that every
//    entry point checks; 429/5xx just stop this run and try again next month.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Keep the visible pool at a sane size so rotation stays varied but curated. */
const MAX_ACTIVE = 140;
const BATCH = 25;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  let force = false;
  let resume = false;
  try {
    const body = await req.json();
    force = Boolean(body?.force);
    resume = Boolean(body?.resume);
  } catch { /* cron posts a plain body */ }

  // A human trigger must be an admin; the cron calls with no user token.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if ((force || resume) && token && token !== ANON_KEY) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: userRes } = await userClient.auth.getUser(token);
    if (!userRes?.user) return json({ ok: false, error: "Unauthorized" }, 401);
    const { data: profile } = await admin
      .from("profiles").select("role").eq("id", userRes.user.id).maybeSingle();
    if (!["admin", "top_management"].includes(String(profile?.role ?? ""))) {
      return json({ ok: false, error: "Admins only" }, 403);
    }
  }

  const nowIso = new Date().toISOString();
  const { data: state } = await admin
    .from("motivational_quote_state").select("*").eq("id", true).maybeSingle();

  // Paused-state guard: cron keeps firing, this is what actually stops the work.
  if (state?.status === "paused" && !resume) {
    return json({ ok: false, paused: true, reason: state.paused_reason }, 200);
  }

  // Once a month is enough unless a human forces it.
  if (!force && state?.last_refresh_at) {
    const days = (Date.now() - new Date(state.last_refresh_at).getTime()) / 86400000;
    if (days < 25) return json({ ok: true, skipped: "refreshed recently", days: Math.round(days) });
  }

  // Single-flight lease (10 minutes).
  const leaseUntil = new Date(Date.now() + 10 * 60_000).toISOString();
  const { data: claimed } = await admin
    .from("motivational_quote_state")
    .update({ status: "running", lease_until: leaseUntil, paused_reason: null, updated_at: nowIso })
    .eq("id", true)
    .or(`lease_until.is.null,lease_until.lt.${nowIso}`)
    .select("id");
  if (!claimed?.length) return json({ ok: true, skipped: "another run holds the lease" });

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) {
    await admin.from("motivational_quote_state").update({
      status: "paused", paused_reason: "OPENAI_API_KEY is not configured",
      lease_until: null, updated_at: new Date().toISOString(),
    }).eq("id", true);
    return json({ ok: false, error: "OPENAI_API_KEY is not configured" }, 200);
  }

  try {
    const { data: existing } = await admin
      .from("motivational_quotes").select("quote").eq("is_active", true).limit(200);
    const known = (existing ?? []).map((r) => r.quote).slice(0, 120);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.8,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You curate short, genuinely valuable quotes for a hotel operations and revenue management team. " +
              "Only real, correctly attributed quotes, or clearly labelled industry maxims. " +
              "No clichés about hustle, no invented attributions, nothing longer than 140 characters. " +
              "Reply as JSON: {\"quotes\":[{\"quote\":\"...\",\"author\":\"...\"}]}.",
          },
          {
            role: "user",
            content:
              `Give me ${BATCH} quotes about leadership, service excellence, decision making under uncertainty, ` +
              `teamwork, discipline and pricing judgement. Do NOT repeat any of these already in use:\n` +
              known.map((q) => `- ${q}`).join("\n"),
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      const terminal = [401, 402, 403].includes(res.status);
      await admin.from("motivational_quote_state").update({
        status: terminal ? "paused" : "idle",
        paused_reason: terminal ? `OpenAI ${res.status}: ${text.slice(0, 300)}` : null,
        last_error: `OpenAI ${res.status}: ${text.slice(0, 300)}`,
        lease_until: null,
        updated_at: new Date().toISOString(),
      }).eq("id", true);
      return json({ ok: false, error: `OpenAI ${res.status}`, paused: terminal }, 200);
    }

    const payload = await res.json();
    const parsed = JSON.parse(payload?.choices?.[0]?.message?.content ?? "{}");
    const rows = (Array.isArray(parsed?.quotes) ? parsed.quotes : [])
      .map((q: { quote?: string; author?: string }) => ({
        quote: String(q?.quote ?? "").trim(),
        author: String(q?.author ?? "").trim() || "Unknown",
        source: "ai",
      }))
      .filter((q) => q.quote.length > 10 && q.quote.length <= 200)
      .slice(0, BATCH);

    let inserted = 0;
    if (rows.length) {
      const { data: ins } = await admin
        .from("motivational_quotes")
        .upsert(rows, { onConflict: "quote_key", ignoreDuplicates: true })
        .select("id");
      inserted = ins?.length ?? 0;
    }

    // Trim the pool: retire the oldest AI-added quotes over the cap (seeds stay).
    const { count } = await admin
      .from("motivational_quotes").select("id", { count: "exact", head: true }).eq("is_active", true);
    let retired = 0;
    if ((count ?? 0) > MAX_ACTIVE) {
      const { data: oldest } = await admin
        .from("motivational_quotes")
        .select("id").eq("is_active", true).eq("source", "ai")
        .order("created_at", { ascending: true })
        .limit((count ?? 0) - MAX_ACTIVE);
      const ids = (oldest ?? []).map((r) => r.id);
      if (ids.length) {
        await admin.from("motivational_quotes").update({ is_active: false }).in("id", ids);
        retired = ids.length;
      }
    }

    await admin.from("motivational_quote_state").update({
      status: "idle", paused_reason: null, last_error: null,
      last_refresh_at: new Date().toISOString(),
      lease_until: null, updated_at: new Date().toISOString(),
    }).eq("id", true);

    return json({ ok: true, inserted, retired, active: count ?? 0 });
  } catch (e) {
    await admin.from("motivational_quote_state").update({
      status: "idle", last_error: String((e as Error).message).slice(0, 300),
      lease_until: null, updated_at: new Date().toISOString(),
    }).eq("id", true);
    return json({ ok: false, error: (e as Error).message }, 200);
  }
});
