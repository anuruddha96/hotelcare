/**
 * channex-booking-worker — cron every 5 minutes while any hotel is connected (verify_jwt = false,
 * authenticated by the Vault worker secret).
 *
 *   1. Drain the booking revision feed PER LINKED PROPERTY (never the whole account, so revisions
 *      of properties that are not ours are never touched or acknowledged).
 *   2. Retry webhook stubs / failed revisions by pulling the full revision.
 *   3. Retry ACKs for revisions already saved (booking or review case) but not yet acknowledged.
 *   4. Alert: un-ACKed > 10 min = warning, > 25 min = urgent (Channex drops un-ACKed revisions
 *      from the feed after ~30 min; recovery is then a manual, date-scoped action).
 */
import { json, serviceDb, workerAuthorized } from "../_shared/channex/http.ts";
import { ChannexClient, channexKeyConfigured, type ChannexEnvironment } from "../_shared/channex/client.ts";
import { ackRow, audit, ingestRevision } from "../_shared/channex/bookingProcessor.ts";

const MAX_FEED_PAGES = 10;
const MAX_RETRIES = 20;
const SWEEP_WINDOW_HOURS = 6;
const getEnv = (k: string) => Deno.env.get(k);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const db = serviceDb();
  if (!(await workerAuthorized(req, db))) return json({ ok: false }, 401);

  const summary: Record<string, unknown>[] = [];
  for (const env of ["staging", "production"] as ChannexEnvironment[]) {
    const { data: conns } = await db.from("channex_connections")
      .select("hotel_id,mode,channex_property_id,environment")
      .eq("environment", env).neq("mode", "off").not("channex_property_id", "is", null);
    if (!conns?.length) continue;

    if (!channexKeyConfigured(env, getEnv)) {
      for (const c of conns) {
        await db.from("channex_connections").update({ last_error: `No ${env} API key configured: bookings are not being fetched`, last_feed_poll_at: new Date().toISOString() }).eq("hotel_id", c.hotel_id);
      }
      continue;
    }
    const client = ChannexClient.fromEnv(env, getEnv);

    for (const conn of conns) {
      const line: Record<string, unknown> = { hotel_id: conn.hotel_id, env, feed: 0, retried: 0, acked: 0 };
      const now = new Date().toISOString();
      try {
        // 1. Feed for this property.
        for (let page = 0; page < MAX_FEED_PAGES; page++) {
          const res = await client.bookingFeed(String(conn.channex_property_id));
          const items = Array.isArray(res.data) ? res.data : [];
          if (!items.length) break;
          let ackedThisPage = 0;
          for (const item of items) {
            const r = await ingestRevision(db, client, item, "feed");
            line.feed = Number(line.feed) + 1;
            if (r.acked) ackedThisPage++;
          }
          // Dry run / failures: items stay in the feed; do not spin on the same page.
          if (ackedThisPage === 0) break;
        }
        await db.from("channex_connections").update({ last_feed_poll_at: now, last_feed_ok_at: now }).eq("hotel_id", conn.hotel_id);
      } catch (err) {
        line.feed_error = err instanceof Error ? err.message : String(err);
        await db.from("channex_connections").update({ last_feed_poll_at: now, last_error: `Booking feed failed: ${line.feed_error}`.slice(0, 300) }).eq("hotel_id", conn.hotel_id);
      }

      // 1b. Safety net: the feed can miss revisions (filter quirks, webhook shape
      // changes, >30 min un-ACKed drop-off), so also sweep this property's revision
      // list for the recent window. ingestRevision is idempotent on revision_id and
      // never ACKs anything that is not durably saved, so overlap with the feed is
      // harmless and the sweep stays property-scoped by construction.
      try {
        const since = new Date(Date.now() - SWEEP_WINDOW_HOURS * 3600_000).toISOString();
        const res = await client.listRevisionsSince(String(conn.channex_property_id), since);
        const items = Array.isArray(res.data) ? res.data : [];
        line.sweep_seen = items.length;
        for (const item of items) {
          const attrs = (item && typeof item === "object" && (item as any).attributes) ? (item as any).attributes : item;
          if (attrs && (attrs as any).acknowledged === true) continue; // already ACKed (by us or before)
          const r = await ingestRevision(db, client, item, "feed");
          line.sweep = Number(line.sweep ?? 0) + 1;
          if (r.acked) line.acked = Number(line.acked) + 1;
        }
      } catch (err) {
        line.sweep_error = err instanceof Error ? err.message : String(err);
      }

      // 2. Stubs and failures: pull the full revision again.
      const { data: pending } = await db.from("channex_booking_revisions")
        .select("id,revision_id,attempts")
        .eq("hotel_id", conn.hotel_id).eq("environment", env).is("acked_at", null)
        .in("state", ["received", "failed"]).lt("attempts", MAX_RETRIES).order("created_at").limit(25);
      for (const row of pending ?? []) {
        try {
          const rev = await client.getRevision(row.revision_id);
          await ingestRevision(db, client, rev.data, "feed");
          line.retried = Number(line.retried) + 1;
        } catch (err) {
          await db.from("channex_booking_revisions").update({
            attempts: (row.attempts ?? 0) + 1, last_error: `Retry failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300), updated_at: new Date().toISOString(),
          }).eq("id", row.id);
        }
      }

      // 3. Saved but not acknowledged.
      if (conn.mode === "live") {
        const { data: unacked } = await db.from("channex_booking_revisions")
          .select("id,revision_id,state").eq("hotel_id", conn.hotel_id).eq("environment", env)
          .is("acked_at", null).in("state", ["applied", "review"]).limit(50);
        for (const row of unacked ?? []) {
          const r = await ackRow(db, client, row.id, row.revision_id, row.state);
          if (r.acked) line.acked = Number(line.acked) + 1;
        }
      }

      // 4. Lag alerts (live only; dry run never acknowledges by design).
      if (conn.mode === "live") {
        const { data: oldest } = await db.from("channex_booking_revisions").select("created_at")
          .eq("hotel_id", conn.hotel_id).is("acked_at", null).in("state", ["received", "failed", "applied", "review"])
          .order("created_at").limit(1);
        const ageMin = oldest?.[0] ? (Date.now() - Date.parse(oldest[0].created_at)) / 60000 : 0;
        if (ageMin > 25) {
          const msg = `URGENT: an OTA booking has not been acknowledged for ${Math.round(ageMin)} minutes. Check the Channel Manager; after 30 minutes run booking recovery.`;
          await db.from("channex_connections").update({ last_error: msg }).eq("hotel_id", conn.hotel_id);
          await audit(db, conn.hotel_id, null, "booking_ack_lag_urgent", { minutes: Math.round(ageMin) });
        } else if (ageMin > 10) {
          await audit(db, conn.hotel_id, null, "booking_ack_lag_warning", { minutes: Math.round(ageMin) });
        }
        line.oldest_unacked_min = Math.round(ageMin);
      }
      summary.push(line);
    }
  }
  return json({ ok: true, summary });
});
