// Original HotelCare thoughts are generated in small batches; historical quotes
// attributed to real people remain separate, sourced and unchanged.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.0";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-worker-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json" } });
const ROLES = ["housekeeping", "housekeeping_leadership", "reception", "reception_leadership", "maintenance", "maintenance_leadership", "breakfast", "marketing", "marketing_leadership", "finance", "finance_leadership", "hr", "hotel_management", "executive", "admin", "supervisor"] as const;
type Audience = typeof ROLES[number] | "hospitality";
type Stock = { quote_key: string; quote_text: string; audiences: string[] };
type Draft = { quote_text: string; practical_takeaway: string; audience: string; tone: string };
const UNIVERSAL_TARGET = 240;
const ROLE_TARGET = 12;
const BATCH_SIZE = 12; // Smaller JSON generations avoid truncated or malformed batches.
const DAILY_MAX = 640;
const LIFETIME_MAX = 6000;
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

function audienceFor(role: string): Audience {
  const aliases: Record<string, Audience> = { housekeeping_manager: "housekeeping_leadership", front_office: "reception", reception_manager: "reception_leadership", maintenance_manager: "maintenance_leadership", marketing_manager: "marketing_leadership", control_finance: "finance", control_manager: "finance_leadership", finance_manager: "finance_leadership", manager: "hotel_management", back_office_manager: "hotel_management", top_management: "executive", top_management_manager: "executive", breakfast_staff: "breakfast" };
  return aliases[role] ?? (ROLES.includes(role as typeof ROLES[number]) ? role as Audience : "hospitality");
}
function target(stock: Stock[], audience: Audience | null, remaining: number | null): Audience | null {
  if (audience && remaining !== null && remaining <= 2) return audience;
  if (stock.filter(q => q.audiences.includes("hospitality")).length < UNIVERSAL_TARGET) return "hospitality";
  for (const role of ROLES) {
    if (stock.filter(q => q.audiences.includes(role)).length < ROLE_TARGET) return role;
  }
  return audience && remaining !== null && remaining <= 35 ? audience : null;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) return json({ ok: false, error: "Server configuration missing" }, 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const workerSecret = req.headers.get("x-worker-secret");
  let worker = false;
  let userId: string | null = null;
  if (workerSecret) {
    const { data, error } = await admin.rpc("verify_welcome_quote_worker_secret", { p_secret: workerSecret });
    if (error || data !== true) return json({ ok: false, error: "Unauthorized" }, 401);
    worker = true;
  } else {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return json({ ok: false, error: "Unauthorized" }, 401);
    userId = data.user.id;
  }
  let body: { mode?: string } = {};
  try { body = await req.json(); } catch { /* cron body optional */ }
  const scheduled = worker && body.mode === "scheduled";
  let audience: Audience | null = null;
  let remaining: number | null = null;
  if (userId) {
    const { data: profile, error } = await admin.from("profiles").select("role,deleted_at").eq("id", userId).maybeSingle();
    if (error || !profile || profile.deleted_at) return json({ ok: false, error: "Profile unavailable" }, 403);
    audience = audienceFor(String(profile.role));
  }
  const { data: rows, error: stockError } = await admin.from("welcome_quote_catalog").select("quote_key,quote_text,audiences").eq("is_active", true).limit(LIFETIME_MAX + 1);
  if (stockError) return json({ ok: false, error: "Inventory unavailable" }, 503);
  const stock: Stock[] = (rows ?? []) as Stock[];
  if (userId && audience) {
    const { data: seen, error } = await admin.from("welcome_quote_impressions").select("quote_key").eq("user_id", userId).limit(LIFETIME_MAX + 1);
    if (error) return json({ ok: false, error: "History unavailable" }, 503);
    const keys = new Set((seen ?? []).map(row => row.quote_key));
    remaining = stock.filter(q => !keys.has(q.quote_key) && (q.audiences.includes("hospitality") || q.audiences.includes(audience!))).length;
  }
  if (!target(stock, audience, remaining)) return json({ ok: true, skipped: "inventory sufficient", active: stock.length, remaining });
  if (stock.length >= LIFETIME_MAX) return json({ ok: true, skipped: "catalogue size limit", active: stock.length });
  const day = new Date();
  const midnight = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())).toISOString();
  const { count, error: countError } = await admin.from("welcome_quote_catalog").select("quote_key", { head: true, count: "exact" }).eq("provenance", "ai_original").gte("created_at", midnight);
  if (countError) return json({ ok: false, error: "Generation budget unavailable" }, 503);
  if ((count ?? 0) >= DAILY_MAX) return json({ ok: true, skipped: "daily generation limit", active: stock.length });
  const { data: lease, error: leaseError } = await admin.rpc("claim_welcome_quote_refill_lease", { p_bootstrap: scheduled });
  if (leaseError || lease !== true) return json({ ok: true, skipped: "another refill or cooldown", active: stock.length });
  let inserted = 0;
  let failure: string | null = null;
  let paused = false;
  const key = Deno.env.get("OPENAI_API_KEY");
  const known = new Set(stock.map(q => normalize(q.quote_text)));
  if (!key) { failure = "OPENAI_API_KEY missing"; paused = true; }
  try {
    if (key) for (let batch = 0; batch < (worker ? 4 : 2); batch++) {
      const role = target(stock, audience, remaining === null ? null : remaining + inserted);
      if (!role || (count ?? 0) + inserted >= DAILY_MAX || stock.length >= LIFETIME_MAX) break;
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: "gpt-4o-mini", temperature: 0.8,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "Write ORIGINAL, concise, helpful thoughts for hotel staff. These are NOT quotes by real people. Never copy a famous quotation or invent an author, source, statistic, or factual claim. Write plain English, varied practical insight and motivation; at most one gently humorous thought per twelve, never mock guests, coworkers or safety. For hospitality, each idea must be applicable to housekeeping, front desk, maintenance and managers. Return ONLY a JSON object with a quotes array. Each item MUST have exactly quote_text, practical_takeaway, audience, tone. quote_text 35-125 characters, takeaway 15-95 characters. audience is the exact role requested. tone is motivational, practical or humorous." },
            { role: "user", content: `Return JSON {"quotes":[{"quote_text":"...","practical_takeaway":"...","audience":"${role}","tone":"motivational"}]}. Generate ${BATCH_SIZE} DISTINCT original HotelCare thoughts for the ${role} audience. Make each specific and memorable. Do not repeat or closely rephrase these existing examples: ${[...known].slice(-65).join(" | ")}` },
          ],
        }),
      });
      if (!response.ok) { failure = `OpenAI HTTP ${response.status}`; paused = [401, 402, 403].includes(response.status); break; }
      const payload = await response.json();
      const raw = payload?.choices?.[0]?.message?.content;
      if (!raw || payload?.choices?.[0]?.finish_reason === "length") { failure = "OpenAI response was empty or truncated"; break; }
      const parsed = JSON.parse(raw);
      const proposals: unknown[] = Array.isArray(parsed.quotes) ? parsed.quotes : [];
      const valid: Draft[] = [];
      for (const item of proposals) {
        if (!item || typeof item !== "object") continue;
        const draft = item as Record<string, unknown>;
        const text = String(draft.quote_text ?? draft.quote ?? "").trim().replace(/^[“\"]|[”\"]$/g, "");
        const takeaway = String(draft.practical_takeaway ?? draft.takeaway ?? "").trim();
        const itemRole = String(draft.audience ?? draft.role ?? role).trim();
        const tone = String(draft.tone ?? "motivational").trim();
        if (itemRole !== role || !["motivational", "practical", "humorous"].includes(tone) || text.length < 28 || text.length > 150 || takeaway.length < 12 || takeaway.length > 120 || /[\r\n<>]/.test(text + takeaway) || /\b(as an ai|chatgpt|openai|guaranteed)\b/i.test(text) || known.has(normalize(text))) continue;
        known.add(normalize(text));
        valid.push({ quote_text: text, practical_takeaway: takeaway, audience: role, tone });
      }
      if (!valid.length) { failure = `No acceptable drafts (count=${proposals.length}, fields=${Object.keys((proposals[0] && typeof proposals[0] === "object" ? proposals[0] : {}) as Record<string, unknown>).join(",").slice(0, 100)})`; break; }
      const { data: added, error } = await admin.rpc("insert_welcome_original_thoughts", { p_rows: valid });
      if (error) { failure = `Database insertion failed: ${error.message}`; break; }
      const total = Number(added ?? 0);
      inserted += total;
      for (const draft of valid) stock.push({ quote_key: `new-${stock.length}`, quote_text: draft.quote_text, audiences: [draft.audience] });
      if (total === 0) { failure = "Generated thoughts were duplicates"; break; }
    }
  } catch (error) { failure = error instanceof Error ? error.message.slice(0, 180) : "Refill failed"; }
  finally {
    const { error } = await admin.rpc("finish_welcome_quote_refill", { p_inserted: inserted, p_error: failure, p_pause: paused });
    if (error) console.error("Refill lease release failure", error.message);
  }
  return json({ ok: !failure, inserted, active: stock.length, remaining, ...(failure ? { error: failure, paused } : {}) }, paused ? 503 : 200);
});
