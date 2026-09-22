// Automatically replenishes a durable catalogue of original HotelCare thoughts.
// Real-person quotations remain in the separately sourced/verified catalogue:
// NEVER ask a model to invent quotations, author names or source links.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});

const ROLES = [
  "housekeeping", "housekeeping_leadership", "reception", "reception_leadership",
  "maintenance", "maintenance_leadership", "breakfast", "marketing",
  "marketing_leadership", "finance", "finance_leadership", "hr",
  "hotel_management", "executive", "admin", "supervisor",
] as const;
type Audience = typeof ROLES[number] | "hospitality";
type Stock = { quote_key: string; quote_text: string; audiences: string[] };
type Generated = { quote_text: string; practical_takeaway: string; audience: string; tone: string };
const UNIVERSAL_TARGET = 240;
const ROLE_TARGET = 12;
const LOW_USER_STOCK = 35;
const DAILY_MAX = 640;
const LIFETIME_MAX = 6000;
const BATCH_SIZE = 32;

function roleAudience(role: string): Audience {
  const mapping: Record<string, Audience> = {
    housekeeping_manager: "housekeeping_leadership", front_office: "reception",
    reception_manager: "reception_leadership", maintenance_manager: "maintenance_leadership",
    marketing_manager: "marketing_leadership", control_finance: "finance",
    control_manager: "finance_leadership", finance_manager: "finance_leadership",
    manager: "hotel_management", back_office_manager: "hotel_management",
    top_management: "executive", top_management_manager: "executive",
    breakfast_staff: "breakfast",
  };
  if (mapping[role]) return mapping[role];
  return ROLES.includes(role as typeof ROLES[number]) ? role as Audience : "hospitality";
}

function normal(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function plan(stock: Stock[], userAudience: Audience | null, userRemaining: number | null) {
  const universal = stock.filter((q) => q.audiences.includes("hospitality")).length;
  const counts = ROLES.map((audience) => ({
    audience, count: stock.filter((q) => q.audiences.includes(audience)).length,
  }));
  // An employee who is actually out receives relevant new stock first.
  if (userAudience && userRemaining !== null && userRemaining <= 2) {
    return { targets: [{ audience: userAudience, count: BATCH_SIZE }], universal, counts };
  }
  if (universal < UNIVERSAL_TARGET) {
    return { targets: [{ audience: "hospitality" as Audience, count: BATCH_SIZE }], universal, counts };
  }
  const low = counts.filter((r) => r.count < ROLE_TARGET).sort((a, b) => a.count - b.count).slice(0, 3);
  if (low.length) {
    return { targets: low.map((r) => ({ audience: r.audience as Audience, count: 12 })), universal, counts };
  }
  if (userAudience && userRemaining !== null && userRemaining <= LOW_USER_STOCK) {
    return { targets: [{ audience: userAudience, count: BATCH_SIZE }], universal, counts };
  }
  return { targets: [] as { audience: Audience; count: number }[], universal, counts };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) return json({ ok: false, error: "Server configuration" }, 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Explicit custom authorization is required even for calls made by pg_cron.
  const workerSecret = req.headers.get("x-worker-secret");
  let worker = false;
  let userId: string | null = null;
  if (workerSecret) {
    const { data, error } = await admin.rpc("verify_welcome_quote_worker_secret", { p_secret: workerSecret });
    if (error || data !== true) return json({ ok: false, error: "Unauthorized" }, 401);
    worker = true;
  } else {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return json({ ok: false, error: "Unauthorized" }, 401);
    userId = data.user.id;
  }

  let body: { mode?: string } = {};
  try { body = await req.json(); } catch { /* empty cron body */ }
  const scheduled = worker && body.mode === "scheduled";
  let audience: Audience | null = null;
  let remaining: number | null = null;
  if (userId) {
    const { data: profile, error } = await admin.from("profiles")
      .select("role,deleted_at").eq("id", userId).maybeSingle();
    if (error || !profile || profile.deleted_at) return json({ ok: false, error: "Profile unavailable" }, 403);
    audience = roleAudience(String(profile.role));
  }

  const { data: all, error: stockError } = await admin.from("welcome_quote_catalog")
    .select("quote_key,quote_text,audiences").eq("is_active", true).limit(LIFETIME_MAX + 1);
  if (stockError) return json({ ok: false, error: "Inventory unavailable" }, 503);
  const stock: Stock[] = (all ?? []) as Stock[];
  if (userId && audience) {
    const { data: seen, error } = await admin.from("welcome_quote_impressions")
      .select("quote_key").eq("user_id", userId).limit(LIFETIME_MAX + 1);
    if (error) return json({ ok: false, error: "History unavailable" }, 503);
    const seenKeys = new Set((seen ?? []).map((row) => row.quote_key));
    remaining = stock.filter((q) => !seenKeys.has(q.quote_key) &&
      (q.audiences.includes("hospitality") || q.audiences.includes(audience!))).length;
  }
  const initial = plan(stock, audience, remaining);
  if (!initial.targets.length) return json({ ok: true, skipped: "stock sufficient", active: stock.length, remaining });
  if (stock.length >= LIFETIME_MAX) return json({ ok: false, skipped: "catalogue safety cap reached" }, 200);

  const today = new Date();
  const dayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())).toISOString();
  const { count: todayCount, error: countError } = await admin.from("welcome_quote_catalog")
    .select("quote_key", { count: "exact", head: true }).eq("provenance", "ai_original")
    .gte("created_at", dayStart);
  if (countError) return json({ ok: false, error: "Daily budget check failed" }, 503);
  if ((todayCount ?? 0) >= DAILY_MAX) return json({ ok: true, skipped: "daily generation limit", active: stock.length });

  const { data: lease, error: leaseError } = await admin.rpc("claim_welcome_quote_refill_lease", {
    p_bootstrap: scheduled,
  });
  if (leaseError || lease !== true) return json({ ok: true, skipped: "refill already running or cooling down" });

  let inserted = 0;
  let failure: string | null = null;
  let paused = false;
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) { failure = "OPENAI_API_KEY missing"; paused = true; }
  const known = new Set(stock.map((q) => normal(q.quote_text)));
  // Scheduled jobs build the catalogue in small bounded batches; user-triggered
  // jobs have a smaller upper bound and never delay normal workspace access.
  const maxBatches = worker ? 4 : 2;
  try {
    if (!failure) {
      for (let batch = 0; batch < maxBatches; batch += 1) {
        const next = plan(stock, audience, remaining === null ? null : remaining + inserted);
        if (!next.targets.length || stock.length >= LIFETIME_MAX ||
            (todayCount ?? 0) + inserted >= DAILY_MAX) break;
        const allowed = new Set(next.targets.map((r) => r.audience));
        const exactCount = next.targets.reduce((sum, r) => sum + r.count, 0);
        const focus = next.targets.map((r) => `${r.count} for ${r.audience}`).join(", ");
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: "gpt-4o-mini", temperature: 0.85,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content:
                "Write ORIGINAL short, specific, genuinely useful thoughts for a hotel operations workplace. " +
                "These are newly written HotelCare thoughts, NOT quotations by famous people. " +
                "NEVER copy known quotations or invent attributions, people, sources, statistics or factual claims. " +
                "Each thought should be 35-125 characters in simple English and understandable on a loading screen. " +
                "Most motivational or practical, 10% gently humorous about situations, never guests, staff, identity or safety. " +
                "Make each thought a fresh concrete insight, not generic hustle clichés, marketing slogans or repeats. " +
                "Role-tag each with the audience requested. For hospitality use ideas useful to ALL hotel employees, " +
                "including housekeepers, reception and maintenance (avoid revenue-only concepts). " +
                "Output only JSON {\"quotes\":[{\"quote_text\":\"...\",\"practical_takeaway\":\"...\",\"audience\":\"...\",\"tone\":\"motivational|practical|humorous\"}]}." },
              { role: "user", content:
                `Write ${exactCount} DIFFERENT original thoughts: ${focus}. ` +
                "For role-specific thoughts include useful hotel-domain knowledge and simple memorable wording. " +
                "Avoid these existing examples and near-paraphrases:\n" +
                [...known].slice(-115).map((text) => `- ${text}`).join("\n") },
            ],
          }),
        });
        if (!response.ok) {
          failure = `OpenAI HTTP ${response.status}`;
          paused = [401, 402, 403].includes(response.status);
          break;
        }
        const payload = await response.json();
        const parsed = JSON.parse(payload?.choices?.[0]?.message?.content || "{}");
        const proposals: unknown[] = Array.isArray(parsed?.quotes) ? parsed.quotes : [];
        const valid: Generated[] = [];
        for (const item of proposals) {
          if (!item || typeof item !== "object") continue;
          const q = item as Record<string, unknown>;
          const text = typeof q.quote_text === "string" ? q.quote_text.trim() : "";
          const takeaway = typeof q.practical_takeaway === "string" ? q.practical_takeaway.trim() : "";
          const target = typeof q.audience === "string" ? q.audience : "";
          const tone = typeof q.tone === "string" ? q.tone : "";
          if (!allowed.has(target as Audience) || !["practical", "motivational", "humorous"].includes(tone) ||
              text.length < 35 || text.length > 125 || takeaway.length < 12 || takeaway.length > 120 ||
              /[\r\n<>]/.test(text + takeaway) || /^['“\"]/.test(text) ||
              /\b(as an ai|openai|chatgpt|guaranteed|always perfect)\b/i.test(text) || known.has(normal(text))) continue;
          known.add(normal(text));
          valid.push({ quote_text: text, practical_takeaway: takeaway, audience: target, tone });
        }
        if (!valid.length) { failure = "OpenAI returned no acceptable original thoughts"; break; }
        const { data: added, error: insertError } = await admin.rpc("insert_welcome_original_thoughts", {
          p_rows: valid.slice(0, 40),
        });
        if (insertError) { failure = `Database insert: ${insertError.message}`; break; }
        const count = Number(added ?? 0);
        inserted += count;
        for (const q of valid) stock.push({ quote_key: `pending-${stock.length}`, quote_text: q.quote_text, audiences: [q.audience] });
        if (!count) { failure = "No new, distinct thoughts were accepted"; break; }
      }
    }
  } catch (err) {
    failure = err instanceof Error ? err.message.slice(0, 160) : "Refill failed";
  } finally {
    const { error: finishError } = await admin.rpc("finish_welcome_quote_refill", {
      p_inserted: inserted, p_error: failure, p_pause: paused,
    });
    if (finishError) console.error("Welcome quote lease release failed", finishError.message);
  }
  if (failure) return json({ ok: false, inserted, active: stock.length, error: failure, paused }, paused ? 503 : 200);
  return json({ ok: true, inserted, active: stock.length, remaining });
});
