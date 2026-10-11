// Queues a concise receptionist-facing upgrade review after a confirmed new
// booking. During pilot, mail ALWAYS goes only to the admin test address.
// This does not open, close, or resell rooms. Inventory handling is separate.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/emailSender.ts";

const TEST_RECIPIENT = "anuruddha.dharmasena@gmail.com";
const json = (data: unknown, code = 200) =>
  new Response(JSON.stringify(data), { status: code, headers: { "Content-Type": "application/json" } });
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

Deno.serve(async (req) => {
  // Scheduled server-only worker. Never allow a signed-in browser user to run it.
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!secret || req.headers.get("Authorization") !== `Bearer ${secret}`) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, secret);
  const report = { rules: 0, events: 0, sent: 0, failed: 0 };
  try {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const { data: rules, error } = await admin.from("room_sale_upgrade_rules")
      .select("id,hotel_id,organization_slug,stay_date,source_obk_id,target_obk_id,source_room_type_name,target_room_type_name,notify_mode,activated_at")
      .eq("status", "active").gte("stay_date", today).limit(200);
    if (error) throw error;
    for (const rule of rules ?? []) {
      report.rules++;
      if (!rule.activated_at || rule.notify_mode === "off") continue;
      const { data: bookings, error: bookingError } = await admin.from("revenue_booking_nights")
        .select("res_id,room_key,room_type_name,guests,stay_from,stay_to,created_at_pms,obk_id")
        .eq("hotel_id", rule.hotel_id).eq("stay_date", rule.stay_date)
        .eq("obk_id", rule.target_obk_id).eq("status_id", 3)
        .gte("created_at_pms", rule.activated_at).limit(100);
      if (bookingError) { console.error("upgrade bookings", bookingError); report.failed++; continue; }
      for (const booking of bookings ?? []) {
        if (!booking.res_id || !booking.room_key) continue;
        // A multi-night reservation gets one email even if multiple daily
        // upgrade rules are active. Mark the actual date in the message.
        const { data: earlier } = await admin.from("room_sale_upgrade_events")
          .select("id").eq("hotel_id", rule.hotel_id)
          .eq("reservation_id", booking.res_id).eq("room_key", booking.room_key)
          .eq("event_kind", "upgrade_review").limit(1);
        if (earlier?.length) continue;
        const { data: inserted, error: insertError } = await admin.from("room_sale_upgrade_events")
          .insert({
            rule_id: rule.id, hotel_id: rule.hotel_id, organization_slug: rule.organization_slug,
            stay_date: rule.stay_date, reservation_id: booking.res_id,
            room_key: booking.room_key, event_kind: "upgrade_review",
            booked_room_type_name: booking.room_type_name || rule.target_room_type_name,
            upgrade_room_type_name: rule.source_room_type_name,
            delivery_state: "pending",
          }).select("id").single();
        if (insertError || !inserted?.id) { report.failed++; continue; }
        report.events++;
      }
    }
    // Send queued notices separately so transient delivery errors can be
    // retried. A duplicate worker cannot create duplicate booking events.
    const { data: pending } = await admin.from("room_sale_upgrade_events")
      .select("id,rule_id,hotel_id,organization_slug,stay_date,reservation_id,booked_room_type_name,upgrade_room_type_name,attempts")
      .in("delivery_state", ["pending", "failed"]).lt("attempts", 3)
      .eq("event_kind", "upgrade_review").order("created_at").limit(40);
    for (const event of pending ?? []) {
      const subject = `[HotelCare TEST] Complimentary room upgrade to review — ${event.hotel_id}`;
      const plain = `HotelCare · Complimentary upgrade for reception review\n\nHotel: ${event.hotel_id}\nStay date: ${event.stay_date}\nReservation: ${event.reservation_id}\nBooked as: ${event.booked_room_type_name}\nPossible free upgrade: ${event.upgrade_room_type_name}\n\nReception: verify the assignment in Previo before arrival. The guest keeps the booked rate; no guest message is sent by HotelCare.\n\nPilot notification — admin only.`;
      const html = `<div style="font:14px/1.5 Arial,sans-serif;max-width:560px"><h2>Complimentary room upgrade to review</h2><p><strong>Hotel:</strong> ${esc(event.hotel_id)}<br><strong>Stay:</strong> ${esc(event.stay_date)}<br><strong>Reservation:</strong> ${esc(event.reservation_id)}</p><p>Booked: <strong>${esc(event.booked_room_type_name)}</strong><br>Possible free upgrade: <strong>${esc(event.upgrade_room_type_name)}</strong></p><p>Reception should check the room assignment in Previo. The guest keeps the booked rate.</p><p style="color:#64748b;font-size:12px">HotelCare pilot — sent only to the administrator. No guest message.</p></div>`;
      const mailed = await sendEmail({
        admin, organizationSlug: event.organization_slug,
        to: [TEST_RECIPIENT], subject, text: plain, html, kind: "transactional",
      });
      const update = mailed.ok
        ? { delivery_state: "sent", email_to: TEST_RECIPIENT, sent_at: new Date().toISOString(), attempts: event.attempts + 1, last_error: null }
        : { delivery_state: "failed", attempts: event.attempts + 1, last_error: mailed.error ?? "Delivery failed" };
      const { error: updateError } = await admin.from("room_sale_upgrade_events").update(update).eq("id", event.id);
      if (updateError) console.error("upgrade event update", updateError);
      if (mailed.ok) report.sent++; else report.failed++;
    }
    return json({ ok: true, ...report });
  } catch (e) {
    console.error("upgrade monitor failed", e);
    return json({ ok: false, error: "Upgrade monitor failed" }, 500);
  }
});
