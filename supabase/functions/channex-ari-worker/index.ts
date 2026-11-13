/**
 * channex-ari-worker — cron every minute while there is ARI work (verify_jwt = false,
 * authenticated by the Vault worker secret).
 *
 *   1. Debounce: only change signals older than 20 s are planned (bursts become one message).
 *   2. Availability: recompute sellable stock for the touched dates from HotelCare and send
 *      compressed ranges. Rates/restrictions: field-level deltas (omitted fields stay untouched).
 *   3. Strict order per hotel and kind: if the oldest pending message is backing off, newer ones
 *      wait, so a retried old snapshot can never overwrite newer data.
 *   4. Channex limit 10 availability + 10 restriction calls / property / minute: we stay below.
 *   5. 200 = accepted/queued, not proven: task ids and meta.warnings are stored; warnings are
 *      shown as "sent with warnings". Readback is available from the Channel Manager (Verify).
 *   6. Dry run records exactly what would be sent. Kill switch / off: nothing is sent.
 */
import { addDays, budapestToday, json, serviceDb, workerAuthorized } from "../_shared/channex/http.ts";
import { ChannexClient, ChannexError, readChannexKey, summarizeAriResponse, type ChannexEnvironment } from "../_shared/channex/client.ts";
import { callsAllowedNow, FULL_SYNC_DAYS, planAvailability, planRestrictions, type RateChangeRow } from "../_shared/channex/ariPlan.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
const DEBOUNCE_MS = 20_000;
const MAX_ATTEMPTS = 8;
const getEnv = (k: string) => Deno.env.get(k);

const backoffSeconds = (attempt: number) => Math.min(30 * 2 ** Math.max(attempt - 1, 0), 1800);

async function planHotel(db: Db, conn: any, today: string) {
  const cutoff = new Date(Date.now() - DEBOUNCE_MS).toISOString();
  const propertyId = String(conn.channex_property_id);
  const nowIso = new Date().toISOString();
  const status = conn.kill_switch ? "blocked" : conn.mode === "live" ? "pending" : "dry_run";
  const outboxMode = conn.mode === "live" ? "live" : "dry_run";
  const created: string[] = [];

  // Availability
  const { data: dirty } = await db.from("channex_availability_dirty").select("id,date_from,date_to")
    .eq("hotel_id", conn.hotel_id).is("processed_at", null).lte("created_at", cutoff).order("id").limit(500);
  if (dirty?.length) {
    const last = addDays(today, FULL_SYNC_DAYS - 1);
    const from = dirty.reduce((m: string, d: any) => (d.date_from < m ? d.date_from : m), dirty[0].date_from);
    const to = dirty.reduce((m: string, d: any) => (d.date_to > m ? d.date_to : m), dirty[0].date_to);
    const f = from < today ? today : from;
    const t = to > last ? last : to;
    if (f <= t) {
      const { data: rows, error } = await db.rpc("channex_room_type_availability", { p_hotel_id: conn.hotel_id, p_from: f, p_to: t });
      if (error) throw new Error(error.message);
      const values = planAvailability(propertyId, rows ?? [], today);
      if (values.length) {
        await db.from("channex_ari_outbox").insert({
          hotel_id: conn.hotel_id, kind: "availability", mode: outboxMode, environment: conn.environment,
          values, value_count: values.length, status, last_error: conn.kill_switch ? "Kill switch" : null,
        });
        created.push("availability");
      }
    }
    await db.from("channex_availability_dirty").update({ processed_at: nowIso }).in("id", dirty.map((d: any) => d.id));
  }

  // Rates / restrictions
  const { data: changes } = await db.from("channex_rate_changes").select("id,room_type_id,stay_date,currency,patch")
    .eq("hotel_id", conn.hotel_id).is("processed_at", null).lte("created_at", cutoff).order("id").limit(2000);
  if (changes?.length) {
    const { data: maps } = await db.from("channex_mappings").select("local_id,channex_id").eq("hotel_id", conn.hotel_id).eq("kind", "rate_plan");
    const ratePlanByRoomType = new Map<string, string>((maps ?? []).map((m: any) => [m.local_id, m.channex_id]));
    const { values, usedIds, skipped } = planRestrictions(changes as RateChangeRow[], { propertyId, currency: conn.currency, today, ratePlanByRoomType });
    if (values.length) {
      await db.from("channex_ari_outbox").insert({
        hotel_id: conn.hotel_id, kind: "restrictions", mode: outboxMode, environment: conn.environment,
        values, value_count: values.length, status, last_error: conn.kill_switch ? "Kill switch" : null,
      });
      created.push("restrictions");
    }
    if (usedIds.length) await db.from("channex_rate_changes").update({ processed_at: nowIso }).in("id", usedIds);
    for (const s of skipped) {
      await db.from("channex_rate_changes").update({ processed_at: nowIso, skipped_reason: s.reason.slice(0, 200) }).eq("id", s.id);
    }
  }
  return created;
}

async function sendHotel(db: Db, client: ChannexClient, conn: any) {
  const sent: Record<string, number> = {};
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  for (const kind of ["availability", "restrictions"] as const) {
    const { count } = await db.from("channex_ari_outbox").select("id", { count: "exact", head: true })
      .eq("hotel_id", conn.hotel_id).eq("kind", kind).gt("attempts", 0).gte("updated_at", minuteAgo);
    let budget = callsAllowedNow(count ?? 0);
    if (budget <= 0) continue;

    const { data: queue } = await db.from("channex_ari_outbox").select("id,values,attempts,next_attempt_at,environment")
      .eq("hotel_id", conn.hotel_id).eq("kind", kind).eq("status", "pending").order("created_at").limit(budget);
    for (const row of queue ?? []) {
      if (Date.parse(row.next_attempt_at) > Date.now()) break; // keep order: newer waits for older
      if (row.environment !== conn.environment) {
        await db.from("channex_ari_outbox").update({ status: "blocked", last_error: "Environment changed", updated_at: new Date().toISOString() }).eq("id", row.id);
        continue;
      }
      const attempts = (row.attempts ?? 0) + 1;
      // Claim (status guard prevents double sending if two runs overlap).
      const { data: claimed } = await db.from("channex_ari_outbox").update({ status: "sending", attempts, updated_at: new Date().toISOString() })
        .eq("id", row.id).eq("status", "pending").select("id").maybeSingle();
      if (!claimed) break;
      try {
        const res = kind === "availability" ? await client.pushAvailability(row.values) : await client.pushRestrictions(row.values);
        const { taskIds, warnings } = summarizeAriResponse(res);
        await db.from("channex_ari_outbox").update({
          status: warnings.length ? "sent_with_warnings" : "sent", task_ids: taskIds, warnings: warnings.length ? warnings : null,
          last_error: null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq("id", row.id);
        sent[kind] = (sent[kind] ?? 0) + 1;
        budget--;
      } catch (err) {
        const retry = err instanceof ChannexError ? err.retryable : true;
        const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        const details = err instanceof ChannexError ? err.details : null;
        if (retry && attempts < MAX_ATTEMPTS) {
          await db.from("channex_ari_outbox").update({
            status: "pending", last_error: message, warnings: details ? [details] : null,
            next_attempt_at: new Date(Date.now() + backoffSeconds(attempts) * 1000).toISOString(), updated_at: new Date().toISOString(),
          }).eq("id", row.id);
        } else {
          await db.from("channex_ari_outbox").update({ status: "failed", last_error: message, warnings: details ? [details] : null, updated_at: new Date().toISOString() }).eq("id", row.id);
          await db.from("channex_connections").update({ last_error: `ARI ${kind} message failed: ${message}`.slice(0, 300) }).eq("hotel_id", conn.hotel_id);
        }
        break; // stop this kind for now; order is preserved
      }
      if (budget <= 0) break;
    }
  }
  return sent;
}

/**
 * Read-only key check (GET one property). Returns only status codes and a count, never the key or
 * property details. If a key is rejected, the other environment is tried read-only to spot a
 * staging/production mix-up.
 */
async function probeKeys() {
  const out: Record<string, Record<string, unknown>> = {};
  for (const env of ["staging", "production"] as ChannexEnvironment[]) {
    const key = readChannexKey(env, getEnv);
    if (!key) { out[env] = { configured: false }; continue; }
    try {
      const r = await new ChannexClient(env, key, fetch, 0).probe();
      const total = Number((r.meta as Record<string, unknown> | undefined)?.total ?? (Array.isArray(r.data) ? r.data.length : 0));
      out[env] = { configured: true, ok: true, properties_visible: Number.isFinite(total) ? total : null };
    } catch (err) {
      const status = err instanceof ChannexError ? err.status : 0;
      out[env] = { configured: true, ok: false, status };
      if (status === 401 || status === 403) {
        const other: ChannexEnvironment = env === "staging" ? "production" : "staging";
        try { await new ChannexClient(other, key, fetch, 0).probe(); out[env].works_on = other; }
        catch (e2) { out[env].other_environment_status = e2 instanceof ChannexError ? e2.status : 0; }
      }
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const db = serviceDb();
  if (!(await workerAuthorized(req, db))) return json({ ok: false }, 401);
  const body = await req.json().catch(() => ({}));
  if (body?.trigger === "probe") return json({ ok: true, probe: await probeKeys() });

  // Recover messages stuck in "sending" (function crashed mid-call): retry; Channex ARI writes are idempotent.
  await db.from("channex_ari_outbox").update({ status: "pending", last_error: "Recovered after interrupted send", updated_at: new Date().toISOString() })
    .eq("status", "sending").lt("updated_at", new Date(Date.now() - 5 * 60_000).toISOString());

  const today = budapestToday();
  const { data: conns } = await db.from("channex_connections").select("*").neq("mode", "off").not("channex_property_id", "is", null);
  const clients = new Map<ChannexEnvironment, ChannexClient | null>();
  const summary: Record<string, unknown>[] = [];

  for (const conn of conns ?? []) {
    const line: Record<string, unknown> = { hotel_id: conn.hotel_id, mode: conn.mode };
    try {
      line.planned = await planHotel(db, conn, today);
      if (conn.mode === "live" && !conn.kill_switch) {
        const env = conn.environment as ChannexEnvironment;
        if (!clients.has(env)) {
          try { clients.set(env, ChannexClient.fromEnv(env, getEnv)); } catch { clients.set(env, null); }
        }
        const client = clients.get(env);
        if (!client) {
          await db.from("channex_connections").update({ last_error: `No ${env} API key configured: ARI is not being sent` }).eq("hotel_id", conn.hotel_id);
        } else {
          line.sent = await sendHotel(db, client, conn);
          if (Object.keys(line.sent as object).length) await db.from("channex_connections").update({ last_ari_push_at: new Date().toISOString() }).eq("hotel_id", conn.hotel_id);
        }
      }
    } catch (err) {
      line.error = err instanceof Error ? err.message : String(err);
      await db.from("channex_connections").update({ last_error: `ARI planning failed: ${line.error}`.slice(0, 300) }).eq("hotel_id", conn.hotel_id);
    }
    summary.push(line);
  }

  // Signals of hotels that are off/unlinked are never published: close them so the cron stays idle.
  const linked = (conns ?? []).map((c: any) => c.hotel_id);
  const closeOthers = async (table: string) => {
    let q = db.from(table).update({ processed_at: new Date().toISOString() }).is("processed_at", null);
    if (linked.length) q = q.not("hotel_id", "in", `(${linked.map((h: string) => `"${h.replaceAll('"', "")}"`).join(",")})`);
    await q;
  };
  await closeOthers("channex_availability_dirty");
  await closeOthers("channex_rate_changes");

  return json({ ok: true, summary });
});
