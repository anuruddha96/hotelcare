/**
 * channex-webhook — receives Channex notifications (verify_jwt = false).
 *
 *   * Authenticated by the Vault secret Channex sends in the x-hotelcare-webhook-secret header
 *     (Channex webhooks carry no signature). HTTPS only (Supabase).
 *   * Booking events: the revision id is stored DURABLY before we answer 200, then the full
 *     revision is pulled from the API (the webhook body is a notification, never the authority).
 *     If anything fails, channex-booking-worker retries from the stored stub and the feed.
 *   * Other events (sync_error, rate_error, non_acked_booking, unmapped room/rate…) are written to
 *     the hotel's audit log and surfaced on the Channel Manager screen.
 *   * No guest data is logged here.
 */
import { json, safeEqual, serviceDb } from "../_shared/channex/http.ts";
import { ChannexClient, type ChannexEnvironment } from "../_shared/channex/client.ts";
import { BOOKING_EVENTS, parseWebhook } from "../_shared/channex/revision.ts";
import { audit, ingestRevision, loadConnectionByProperty, recordRevisionStub } from "../_shared/channex/bookingProcessor.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
const ALERT_EVENTS = new Set(["sync_error", "sync_warning", "rate_error", "non_acked_booking", "booking_unmapped_room", "booking_unmapped_rate", "disconnect_channel", "alteration_request"]);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const db = serviceDb();

  const { data: secret } = await db.rpc("get_channex_webhook_secret");
  if (!safeEqual(req.headers.get("x-hotelcare-webhook-secret") ?? "", String(secret ?? ""))) {
    return json({ ok: false }, 401);
  }
  const envParam = new URL(req.url).searchParams.get("env");
  if (envParam !== "staging" && envParam !== "production") return json({ ok: false, error: "env" }, 400);
  const env = envParam as ChannexEnvironment;

  let body: unknown;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json" }, 400); }
  const hook = parseWebhook(body);
  const conn = await loadConnectionByProperty(db, hook.propertyId, env);

  if (BOOKING_EVENTS.has(hook.event) && hook.revisionId) {
    // Durable first: if the pull below fails, the worker still knows this revision exists.
    await recordRevisionStub(db, env, hook.revisionId, hook.propertyId, hook.bookingId, conn?.hotel_id ?? null);
    if (conn && conn.mode !== "off") {
      const work = (async () => {
        try {
          const client = ChannexClient.fromEnv(env, (k) => Deno.env.get(k));
          const rev = await client.getRevision(hook.revisionId!);
          await ingestRevision(db, client, rev.data, "webhook");
        } catch (err) {
          await db.from("channex_booking_revisions").update({
            last_error: `Webhook pull failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
            updated_at: new Date().toISOString(),
          }).eq("revision_id", hook.revisionId).is("acked_at", null);
        }
      })();
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
      else await work;
    }
    return json({ ok: true });
  }

  // "*" also delivers routine events (e.g. ari after every push we make): acknowledge, do not log.
  if (!ALERT_EVENTS.has(hook.event)) return json({ ok: true, ignored: true });
  await audit(db, conn?.hotel_id ?? null, null, `webhook_${hook.event}`.slice(0, 60), {
    environment: env, property_id: hook.propertyId, booking_id: hook.bookingId,
  });
  if (conn) {
    await db.from("channex_connections").update({ last_error: `Channex reported ${hook.event} at ${new Date().toISOString()}`, updated_at: new Date().toISOString() })
      .eq("hotel_id", conn.hotel_id);
  }
  return json({ ok: true });
});
