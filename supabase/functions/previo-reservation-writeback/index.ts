// Sends check-in / check-out done in HotelCare to Previo (Phase 2, first slice).
//
// Jobs come from public.pms_reservation_outbox, filled by a trigger only when
// HotelCare's own check-in/check-out runs and the hotel's
// reservation_writeback_mode is 'dry_run' or 'live' (default 'off').
//
//   dry_run -> store the exact request, send nothing.
//   live    -> send, unless outbound_kill_switch is on or the mode was switched off since.
//
// Each job is claimed (pending -> sending) before any call, so overlapping runs
// cannot send twice. Transient failures retry with backoff; validation failures
// (guest profile incomplete, room not tidy, ...) stop and show Previo's reason.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { callPrevioXml, hasPrevioCredentials, loadPrevioCredentials, resolvePrevioSecretName } from "../_shared/previoCredentials.ts";
import { fetchPrevioWithAuth } from "../_shared/previoAuth.ts";
import {
  buildWritebackRequest, classifyWritebackFailure, MAX_WRITEBACK_ATTEMPTS, readableWritebackError,
  retryDelayMinutes, writebackBlocker, type WritebackAction,
} from "../_shared/previoWriteback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-worker-secret",
};
const BATCH = 20;
const TIME_BUDGET_MS = 45_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type Job = {
  id: string; hotel_id: string; reservation_id: string; action: WritebackAction; mode: "dry_run" | "live";
  pms_reservation_id: string | null; pms_room_reservation_id: string | null; room_changed: boolean; attempts: number;
};
type Config = {
  hotel_id: string; pms_hotel_id: string | null; credentials_secret_name: string | null;
  reservation_writeback_mode: string | null; outbound_kill_switch: boolean | null;
};

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
  const now = () => new Date().toISOString();
  const summary = { claimed: 0, sent: 0, dry_run: 0, retry: 0, failed: 0, blocked: 0 };

  try {
    const { data: due, error: dueError } = await db.from("pms_reservation_outbox")
      .select("id,hotel_id,reservation_id,action,mode,pms_reservation_id,pms_room_reservation_id,room_changed,attempts")
      .eq("status", "pending").lte("next_attempt_at", now()).order("created_at").limit(BATCH);
    if (dueError) throw new Error("Cannot read write-back queue");
    const jobs = (due ?? []) as Job[];
    if (!jobs.length) return json({ ok: true, ...summary });

    const hotelIds = [...new Set(jobs.map((job) => job.hotel_id))];
    const { data: configRows, error: configError } = await db.from("pms_configurations")
      .select("hotel_id,pms_hotel_id,credentials_secret_name,reservation_writeback_mode,outbound_kill_switch,is_active")
      .in("hotel_id", hotelIds).eq("pms_type", "previo").eq("is_active", true);
    if (configError) throw new Error("Cannot read Previo configuration");
    const configs = new Map<string, Config>();
    for (const row of (configRows ?? []) as Config[]) if (!configs.has(row.hotel_id)) configs.set(row.hotel_id, row);

    const finish = async (job: Job, patch: Record<string, unknown>) => {
      await db.from("pms_reservation_outbox").update({ ...patch, updated_at: now() }).eq("id", job.id).eq("status", "sending");
    };

    for (const job of jobs) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      // Claim first: only one run may work on a job.
      const { data: claimed } = await db.from("pms_reservation_outbox")
        .update({ status: "sending", updated_at: now() }).eq("id", job.id).eq("status", "pending").select("id");
      if (!claimed?.length) continue;
      summary.claimed++;

      const config = configs.get(job.hotel_id);
      const currentMode = config?.reservation_writeback_mode ?? "off";
      if (!config || currentMode === "off") {
        summary.blocked++;
        await finish(job, { status: "blocked", last_error: "Write-back to Previo is switched off for this hotel." });
        continue;
      }
      const blocker = writebackBlocker(job);
      if (blocker) {
        summary.blocked++;
        await finish(job, { status: "blocked", last_error: blocker });
        continue;
      }
      const request = buildWritebackRequest(job);
      // The job's own mode, made safer by the hotel's current setting: never live if the hotel went to dry_run.
      const live = job.mode === "live" && currentMode === "live";
      if (!live) {
        summary.dry_run++;
        await finish(job, { status: "dry_run", request, last_error: null });
        continue;
      }
      if (config.outbound_kill_switch === true) {
        summary.blocked++;
        await finish(job, { status: "blocked", request, last_error: "Outbound kill switch is on: nothing is sent to Previo." });
        continue;
      }
      if (!config.pms_hotel_id || !hasPrevioCredentials(config.credentials_secret_name)) {
        summary.blocked++;
        await finish(job, { status: "blocked", request, last_error: "Previo account is not fully configured for this hotel." });
        continue;
      }

      let status = 0;
      let message: string | null = null;
      let body: string | null = null;
      let ok = false;
      try {
        if (request.kind === "rest") {
          const { response } = await fetchPrevioWithAuth({
            credentialsSecretName: resolvePrevioSecretName(config.credentials_secret_name),
            path: request.path,
            method: request.method,
            pmsHotelId: config.pms_hotel_id,
            body: JSON.stringify(request.body),
          });
          status = response.status;
          body = await response.text().catch(() => "");
          ok = response.ok;
          if (!ok) {
            try { const parsed = JSON.parse(body); message = String(parsed?.message ?? parsed?.error ?? "") || null; } catch { /* not JSON */ }
          }
        } else {
          const result = await callPrevioXml({
            method: request.method,
            creds: loadPrevioCredentials(config.credentials_secret_name),
            pmsHotelId: config.pms_hotel_id,
            extraXml: request.extraXml,
          });
          status = result.status;
          ok = result.ok;
          message = result.errorMessage;
          body = ok ? null : result.text.slice(0, 600);
        }
      } catch (error) {
        status = 0;
        message = error instanceof Error ? error.message : String(error);
      }

      if (ok) {
        summary.sent++;
        await finish(job, { status: "sent", request, sent_at: now(), last_error: null, attempts: job.attempts + 1 });
        continue;
      }
      const attempts = job.attempts + 1;
      const reason = readableWritebackError(status, message, body);
      if (classifyWritebackFailure(status, message) === "retry" && attempts < MAX_WRITEBACK_ATTEMPTS) {
        summary.retry++;
        await finish(job, {
          status: "pending", request, attempts, last_error: reason,
          next_attempt_at: new Date(Date.now() + retryDelayMinutes(attempts) * 60_000).toISOString(),
        });
      } else {
        summary.failed++;
        await finish(job, { status: "failed", request, attempts, last_error: reason });
      }
    }

    return json({ ok: true, ...summary, duration_ms: Date.now() - started });
  } catch (error) {
    console.error("Previo write-back run failed", error instanceof Error ? error.name : "unknown");
    return json({ ok: false, error: error instanceof Error ? error.message : String(error), ...summary }, 500);
  }
});
