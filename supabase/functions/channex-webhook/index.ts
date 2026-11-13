// channex-webhook — receives Channex webhooks (booking events).
//
// Channex webhooks have no built-in signature, so the webhook is configured in
// Channex with a custom header `x-hotelcare-webhook-secret` holding a long
// random secret (vault: channex_webhook_secret). Requests without it get 401.
//
// The webhook is only a notification: we store the ids, answer 200 fast, and
// let channex-booking-worker fetch the full revision, apply it and ACK it.
// Guest data from the webhook body is not stored.
import { corsHeaders, integrationSecrets, json, safeEqual, serviceClient } from "../_shared/channexClient.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false }, 405);
  const db = serviceClient();
  const secrets = await integrationSecrets(db).catch(() => null);
  if (!secrets || !safeEqual(req.headers.get("x-hotelcare-webhook-secret") || "", secrets.webhook)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  const body = await req.json().catch(() => ({}));
  const event = String(body?.event || "");
  const propertyId = String(body?.property_id || body?.payload?.property_id || "");
  const revisionId = String(body?.payload?.revision_id || body?.payload?.booking_revision_id || "");
  const bookingId = String(body?.payload?.booking_id || "");

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(propertyId);
  const { data: conn } = isUuid
    ? await db.from("channex_connections").select("hotel_id, bookings_enabled").eq("channex_property_id", propertyId).maybeSingle()
    : { data: null };
  const { data: row } = await db.from("channex_webhook_events").insert({
    event, property_id: propertyId || null, hotel_id: conn?.hotel_id || null, revision_id: revisionId || null, booking_id: bookingId || null,
  }).select("id").single();

  if (conn?.bookings_enabled && event.startsWith("booking")) {
    const work = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/channex-booking-worker`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": secrets.worker },
      body: JSON.stringify(revisionId
        ? { action: "revision", revision_id: revisionId, property_id: propertyId, trigger: "webhook" }
        : { action: "poll", trigger: "webhook" }),
    }).then(async (r) => {
      await db.from("channex_webhook_events").update({ processed_at: new Date().toISOString(), error: r.ok ? null : `worker HTTP ${r.status}` }).eq("id", row?.id);
    }).catch(async (e) => {
      await db.from("channex_webhook_events").update({ error: String(e?.message || e).slice(0, 300) }).eq("id", row?.id);
    });
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(work); else await work;
  }
  return json({ ok: true });
});
