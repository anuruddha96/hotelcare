// channex-booking-worker — pulls booking revisions from Channex, stores them in
// HotelCare, then acknowledges them.
//
//   poll        (cron / webhook, x-worker-secret)  feed for every hotel with bookings_enabled
//   poll_hotel  (user)                              feed for one hotel ("Check bookings now")
//   revision    (x-worker-secret)                   one revision id (from the webhook)
//
// Uses GET /booking_revisions/feed and GET /booking_revisions/:id only
// (never GET /bookings). ACK happens only after channex_apply_booking_revision
// has committed. Revisions for properties that are not ours are never acked.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { authoriseUser, channexRequest, corsHeaders, isWorkerCall, json, logSync, serviceClient, stripCardData } from "../_shared/channexClient.ts";
import { classifyStatus } from "../_shared/channexAri.ts";

type Conn = { hotel_id: string; channex_property_id: string; bookings_enabled: boolean; environment: string };

async function bookingConnections(db: SupabaseClient, hotelId?: string): Promise<Conn[]> {
  let q = db.from("channex_connections").select("hotel_id, channex_property_id, bookings_enabled, environment")
    .eq("bookings_enabled", true).not("channex_property_id", "is", null);
  if (hotelId) q = q.eq("hotel_id", hotelId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const out: Conn[] = [];
  for (const c of (data || []) as Conn[]) {
    const { data: native } = await db.rpc("pms_ari_native_hotel", { _hotel_id: c.hotel_id });
    if (native && c.environment === "staging") out.push(c);
  }
  return out;
}

async function applyAndAck(db: SupabaseClient, conn: Conn, revision: any, via: string) {
  const attrs = revision?.attributes || revision || {};
  const revId = String(revision?.id || attrs.id || "");
  if (String(attrs.property_id || "") !== conn.channex_property_id) {
    return { revision_id: revId, skipped: "foreign_property" };
  }
  const clean = stripCardData(revision);
  const { data, error } = await db.rpc("channex_apply_booking_revision", { _hotel_id: conn.hotel_id, _revision: clean, _received_via: via });
  if (error) {
    await db.from("channex_booking_revisions").upsert({
      revision_id: revId, booking_id: String(attrs.booking_id || "?"), property_id: conn.channex_property_id, hotel_id: conn.hotel_id,
      status: String(attrs.status || "new"), ota_name: attrs.ota_name || null, ota_reservation_code: attrs.ota_reservation_code || null,
      payload: clean, received_via: via, apply_error: error.message.slice(0, 1000),
    }, { onConflict: "revision_id", ignoreDuplicates: false });
    return { revision_id: revId, applied: false, error: error.message };
  }
  const ack = await channexRequest("POST", `/booking_revisions/${revId}/ack`);
  const ok = classifyStatus(ack.status) === "ok";
  await db.from("channex_booking_revisions").update(ok ? { acked_at: new Date().toISOString(), ack_error: null } : { ack_error: `HTTP ${ack.status ?? "network"}` }).eq("revision_id", revId);
  await logSync(db, { hotel_id: conn.hotel_id, kind: "booking_ack", request_type: "ack", ok, http_status: ack.status,
    response_body: { revision_id: revId, booking_id: attrs.booking_id, status: attrs.status, review_required: data?.review_required ?? false },
    duration_ms: ack.durationMs, trigger_source: via, error: ok ? null : (ack.error || JSON.stringify(ack.body || {}).slice(0, 500)) });
  return { revision_id: revId, applied: true, acked: ok, duplicate: Boolean(data?.duplicate), review_required: Boolean(data?.review_required) };
}

async function pollHotel(db: SupabaseClient, conn: Conn, via: string) {
  const results: any[] = [];
  for (let page = 0; page < 10; page++) {
    const res = await channexRequest("GET", `/booking_revisions/feed?filter[property_id]=${conn.channex_property_id}`);
    if (classifyStatus(res.status) !== "ok") {
      await logSync(db, { hotel_id: conn.hotel_id, kind: "booking_feed", request_type: "feed", ok: false, http_status: res.status,
        duration_ms: res.durationMs, trigger_source: via, error: res.error || JSON.stringify(res.body || {}).slice(0, 500) });
      break;
    }
    const list: any[] = Array.isArray(res.body?.data) ? res.body.data : [];
    if (!list.length) break;
    let progressed = false;
    for (const rev of list) {
      const r = await applyAndAck(db, conn, rev, via);
      results.push(r);
      if (r.acked) progressed = true;
    }
    if (!progressed) break; // nothing could be acked: stop instead of looping on the same page
  }
  await db.from("channex_connections").update({ last_feed_poll_at: new Date().toISOString() }).eq("hotel_id", conn.hotel_id);
  return { hotel_id: conn.hotel_id, processed: results.length, results };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const db = serviceClient();
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "poll");

    if (action === "poll" || action === "revision") {
      if (!(await isWorkerCall(req, db))) return json({ ok: false, error: "Unauthorized" }, 401);
      const via = String(body?.trigger || (action === "revision" ? "webhook" : "cron"));
      if (action === "revision") {
        const [conn] = (await bookingConnections(db)).filter((c) => c.channex_property_id === String(body?.property_id || ""));
        if (!conn) return json({ ok: false, error: "Unknown or disabled property" }, 404);
        const res = await channexRequest("GET", `/booking_revisions/${encodeURIComponent(String(body?.revision_id || ""))}`);
        if (classifyStatus(res.status) !== "ok" || !res.body?.data) {
          // Fall back to the feed so nothing is lost.
          return json({ ok: true, fallback: await pollHotel(db, conn, via) });
        }
        return json({ ok: true, result: await applyAndAck(db, conn, res.body.data, via) });
      }
      const results = [];
      for (const c of await bookingConnections(db)) results.push(await pollHotel(db, c, via));
      return json({ ok: true, results });
    }

    if (action === "poll_hotel") {
      const hotelId = String(body?.hotel_id || "");
      await authoriseUser(req, db, hotelId, false);
      const [conn] = await bookingConnections(db, hotelId);
      if (!conn) return json({ ok: false, error: "Booking intake is off for this hotel" }, 409);
      return json({ ok: true, ...(await pollHotel(db, conn, "ui")) });
    }
    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (e) {
    const status = Number((e as any)?.status) || 500;
    return json({ ok: false, error: String((e as Error)?.message || e).slice(0, 800) }, status);
  }
});
