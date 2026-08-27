// One-off repair: bring prices that were inflated by repeated event surcharges
// back to what the new percentage daily cap would ever have allowed.
//
// For every cell that took MORE THAN ONE event-driven rise in the lookback,
// the allowed price is the price before the first of those rises grown by the
// rule's daily percentage cap, once per business day that fired. Anything above
// that is walked back and queued to the PMS through the normal publisher.
//
// Service-role only: the caller must present the service role key.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { enforceRateSafety } from "../_shared/rateSafety.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!serviceKey || token !== serviceKey) return json({ error: "Not authorised" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const hotelId = String(body?.hotelId ?? "");
    const dryRun = body?.dryRun !== false;
    const lookbackDays = Math.max(1, Math.min(30, Number(body?.lookbackDays ?? 7)));
    if (!hotelId) return json({ error: "hotelId is required" }, 400);

    const { data: rule } = await admin.from("revenue_pickup_automation_rules")
      .select("*").eq("hotel_id", hotelId).maybeSingle();
    if (!rule) return json({ error: "No automation rule for that hotel" }, 404);

    const today = new Date().toISOString().slice(0, 10);
    const dailyPct = Math.max(0, Number(rule.max_daily_increase_pct ?? 6));

    const { data: actions, error: actionErr } = await admin
      .from("revenue_pickup_automation_actions")
      .select("stay_date, obk_id, occupancy, room_type_name, old_price, increase_amount, local_business_date, created_at")
      .eq("hotel_id", hotelId)
      .eq("decision_reason", "event_demand")
      .gte("stay_date", today)
      .gte("created_at", new Date(Date.now() - lookbackDays * 86_400_000).toISOString())
      .order("created_at", { ascending: true })
      .limit(20000);
    if (actionErr) throw actionErr;

    type Cell = { stay_date: string; obk_id: string; occupancy: number; room_type_name: string; base: number; days: Set<string>; count: number };
    const cells = new Map<string, Cell>();
    for (const row of (actions ?? []) as any[]) {
      const key = `${row.stay_date}|${row.obk_id}|${row.occupancy}`;
      const existing = cells.get(key);
      if (existing) {
        existing.days.add(String(row.local_business_date));
        existing.count += 1;
        continue;
      }
      cells.set(key, {
        stay_date: row.stay_date, obk_id: String(row.obk_id), occupancy: Number(row.occupancy) || 2,
        room_type_name: String(row.room_type_name ?? ""),
        base: Number(row.old_price), days: new Set([String(row.local_business_date)]), count: 1,
      });
    }

    // Current live price per cell.
    const { data: rates } = await admin.from("revenue_room_type_rates")
      .select("stay_date, obk_id, occupancy, price, currency, captured_at")
      .eq("hotel_id", hotelId).gte("stay_date", today)
      .order("captured_at", { ascending: false }).limit(20000);
    const currentByCell = new Map<string, { price: number; currency: string | null }>();
    for (const row of (rates ?? []) as any[]) {
      const key = `${row.stay_date}|${row.obk_id}|${row.occupancy}`;
      if (!currentByCell.has(key)) currentByCell.set(key, { price: Number(row.price), currency: row.currency ?? null });
    }

    const floor = rule.minimum_adr === null || rule.minimum_adr === undefined ? null : Number(rule.minimum_adr);
    const payload: Array<Record<string, unknown>> = [];
    const preview: any[] = [];
    for (const [key, cell] of cells) {
      if (cell.count < 2) continue;
      const live = currentByCell.get(key);
      if (!live || !Number.isFinite(live.price) || live.price <= 0) continue;
      if (!Number.isFinite(cell.base) || cell.base <= 0) continue;
      let allowed = cell.base * Math.pow(1 + dailyPct / 100, cell.days.size);
      if (floor !== null) allowed = Math.max(allowed, floor);
      const target = Math.round(Math.min(live.price, allowed));
      if (!(target < Math.round(live.price))) continue;
      preview.push({
        stay_date: cell.stay_date, room_type: cell.room_type_name, occupancy: cell.occupancy,
        from: Math.round(live.price), to: target, base: Math.round(cell.base), days: cell.days.size,
      });
      payload.push({
        hotel_id: hotelId, organization_slug: rule.organization_slug, stay_date: cell.stay_date,
        obk_id: cell.obk_id, room_type_name: cell.room_type_name, occupancy: cell.occupancy,
        old_price: Math.round(live.price), new_price: target,
        currency: live.currency ?? rule.currency ?? "EUR", status: "draft",
        priority: 15, intent_source: "automation_event_repair",
      });
    }

    if (dryRun || payload.length === 0) {
      return json({ dryRun: true, cells: payload.length, sample: preview.slice(0, 25) });
    }

    const safe = await enforceRateSafety(admin, hotelId, payload as any[]);
    const changes = safe.changes as Array<Record<string, unknown>>;

    const runId = crypto.randomUUID();
    const { error: runError } = await admin.from("revenue_rate_push_runs").insert({
      id: runId, hotel_id: hotelId, organization_slug: rule.organization_slug,
      source: "automation", requested_count: changes.length, priority: 15,
    });
    if (runError) throw runError;

    const keyOf = (row: any) => `${row.stay_date}|${row.room_type_name}|${row.occupancy}`;
    const incoming = new Set(changes.map(keyOf));
    const dates = Array.from(new Set(changes.map((row: any) => row.stay_date)));
    const { data: staleDrafts } = await admin.from("revenue_rate_drafts")
      .select("id,stay_date,room_type_name,occupancy")
      .eq("hotel_id", hotelId).in("stay_date", dates)
      .in("status", ["draft", "failed"]).is("superseded_at", null).is("claimed_at", null);
    const staleIds = ((staleDrafts ?? []) as any[]).filter((row) => incoming.has(keyOf(row))).map((row) => row.id);
    for (let i = 0; i < staleIds.length; i += 200) {
      await admin.from("revenue_rate_drafts")
        .update({ superseded_at: new Date().toISOString(), status: "superseded" })
        .in("id", staleIds.slice(i, i + 200)).is("claimed_at", null);
    }

    for (let i = 0; i < changes.length; i += 500) {
      const batch = changes.slice(i, i + 500);
      const { data: drafts, error: draftError } = await admin.from("revenue_rate_drafts")
        .insert(batch.map((row) => ({ ...row, push_run_id: runId, confirmation_status: "queued" })))
        .select("id,stay_date,room_type_name,occupancy");
      if (draftError) throw draftError;
      const draftMap = new Map((drafts ?? []).map((row: any) => [keyOf(row), row.id]));
      const { error: itemError } = await admin.from("revenue_rate_push_items").insert(batch.map((row: any) => ({
        run_id: runId, hotel_id: hotelId, organization_slug: rule.organization_slug,
        stay_date: row.stay_date, obk_id: row.obk_id, room_type_name: row.room_type_name,
        occupancy: row.occupancy, old_price: row.old_price, target_price: row.new_price,
        currency: row.currency, draft_id: draftMap.get(keyOf(row)),
      })));
      if (itemError) throw itemError;
    }

    return json({ dryRun: false, runId, queued: changes.length, dropped: safe.dropped.length, sample: preview.slice(0, 25) });
  } catch (e) {
    console.error("event inflation repair failed", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
