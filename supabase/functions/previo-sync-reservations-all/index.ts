// Scheduled fan-out for the Previo reservation import.
//
// Called by pg_cron (see migration 20261111100000) with the Vault worker secret:
//   { "mode": "incremental" }                      every 10 minutes
//       -> previo-sync-reservations pulls only bookings changed in Previo recently.
//   { "mode": "horizon", "staleAfterHours": 6 }    hourly
//       -> a hotel gets a full re-import only when its last successful full
//          import is older than staleAfterHours.
//
// Bounded work: one sequential pass over the active Previo hotels (Previo
// rejects simultaneous calls on one API key), least recently imported first,
// inside a time budget. Hotels that do not fit are picked up by the next tick.
// Read-only towards Previo. No self-invocation, no queue.
// One-off catch-up after a long outage: { "mode": "horizon", "staleAfterHours": 1, "daysBack": 120 }.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-worker-secret",
};
const TIME_BUDGET_MS = 100_000;
const MAX_HOTELS = 50;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ ok: false, error: "Server configuration unavailable" }, 503);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const provided = req.headers.get("x-worker-secret") || "";
  const { data: expected, error: secretError } = await db.rpc("get_previo_reservation_sync_worker_secret");
  if (secretError || !safeEqual(provided, String(expected || ""))) return json({ ok: false, error: "Unauthorized" }, 401);

  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const mode = body?.mode === "horizon" ? "horizon" : "incremental";
    const only = typeof body?.hotelId === "string" && body.hotelId.trim() ? body.hotelId.trim() : null;
    const staleAfterHours = Math.min(Math.max(Number(body?.staleAfterHours) || 6, 1), 48);
    // Optional one-off catch-up ({ mode: "horizon", daysBack: 120 }); the importer validates the range.
    const daysBack = Number.isInteger(body?.daysBack) ? Number(body.daysBack) : undefined;

    const [configs, accounts] = await Promise.all([
      db.from("pms_configurations").select("hotel_id").eq("pms_type", "previo").eq("is_active", true).limit(500),
      db.from("pms_accounts").select("hotel_id").eq("pms_type", "previo").eq("is_active", true).limit(500),
    ]);
    if (configs.error && accounts.error) throw new Error("Cannot read Previo configurations");
    let hotelIds = [...new Set([...(configs.data ?? []), ...(accounts.data ?? [])]
      .map((row) => String(row.hotel_id ?? "").trim()).filter(Boolean))];
    if (only) hotelIds = hotelIds.filter((id) => id === only);
    hotelIds = hotelIds.slice(0, MAX_HOTELS);

    // Last successful FULL import per hotel (incremental rows are marked data.mode = "incremental").
    const lastFull = new Map<string, number>();
    for (const hotelId of hotelIds) {
      const { data } = await db.from("pms_sync_history").select("created_at, data")
        .eq("hotel_id", hotelId).eq("sync_type", "reservations").eq("sync_status", "success")
        .order("created_at", { ascending: false }).limit(25);
      const full = (data ?? []).find((row) => (row.data as Record<string, unknown> | null)?.mode !== "incremental");
      lastFull.set(hotelId, full?.created_at ? Date.parse(String(full.created_at)) || 0 : 0);
    }
    hotelIds.sort((a, b) => (lastFull.get(a) ?? 0) - (lastFull.get(b) ?? 0));

    const results: Array<Record<string, unknown>> = [];
    for (const hotelId of hotelIds) {
      if (mode === "horizon" && Date.now() - (lastFull.get(hotelId) ?? 0) < staleAfterHours * 3_600_000) {
        results.push({ hotel_id: hotelId, skipped: "fresh" });
        continue;
      }
      // A hotel never fully imported gets its full import from the horizon job first:
      // a "modified in the last 2 days" search cannot stand in for it.
      if (mode === "incremental" && !lastFull.get(hotelId)) {
        results.push({ hotel_id: hotelId, skipped: "awaiting_first_full_import" });
        continue;
      }
      if (Date.now() - started > TIME_BUDGET_MS) {
        results.push({ hotel_id: hotelId, skipped: "time_budget" });
        continue;
      }
      try {
        const response = await fetch(`${url}/functions/v1/previo-sync-reservations`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
          body: JSON.stringify(mode === "horizon" && daysBack !== undefined ? { hotelId, mode, daysBack } : { hotelId, mode }),
        });
        const payload = await response.json().catch(() => ({} as Record<string, unknown>));
        const ok = response.ok && payload?.success === true;
        if (!ok) console.error(`Previo reservation ${mode} sync failed for one hotel (HTTP ${response.status})`);
        results.push({
          hotel_id: hotelId, ok, http: response.status, status: payload?.status ?? null,
          received: payload?.received ?? 0, inserted: payload?.inserted ?? 0, updated: payload?.updated ?? 0,
          schema_pending: payload?.schema_pending === true || undefined,
          error: ok ? null : (Array.isArray(payload?.errors) ? String(payload.errors[0] ?? "") : String(payload?.error ?? "")).slice(0, 200) || "failed",
        });
      } catch (error) {
        console.error(`Previo reservation ${mode} sync call failed for one hotel`);
        results.push({ hotel_id: hotelId, ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) });
      }
    }

    return json({ ok: results.every((r) => r.ok !== false), mode, duration_ms: Date.now() - started, results });
  } catch (error) {
    console.error("Previo reservation sync fan-out failed", error instanceof Error ? error.name : "unknown");
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
