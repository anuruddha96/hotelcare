// The automatic morning e-mail for revenue people.
//
// Runs on a schedule (and can be triggered by hand from the app). For every
// hotel that switched the digest on and is due at this Budapest hour, it builds
// a short summary — yesterday's pickup, today's occupancy, the next fourteen
// days that need attention, and what the automation changed overnight — and
// sends it with Resend.

import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function budapestParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
  };
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

interface Night { stay_date: string; res_id: string; nightly_price_eur: number | null; created_at_pms: string | null }

async function buildDigest(admin: ReturnType<typeof createClient>, hotelId: string, today: string) {
  const horizon = addDays(today, 60);
  const [{ data: nights }, { data: actions }, { data: snaps }] = await Promise.all([
    admin.from("revenue_booking_nights")
      .select("stay_date, res_id, nightly_price_eur, created_at_pms")
      .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizon).limit(20000),
    admin.from("revenue_pickup_automation_actions")
      .select("stay_date, old_price, new_price, reason, created_at")
      .eq("hotel_id", hotelId)
      .gte("created_at", `${addDays(today, -1)}T00:00:00Z`)
      .limit(200),
    admin.from("revenue_daily_snapshots")
      .select("stay_date, rooms_sold, rooms_available, revenue_eur")
      .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", addDays(today, 14)).limit(500),
  ]);

  const list = (nights ?? []) as Night[];
  const since = new Date(`${addDays(today, -1)}T00:00:00Z`).getTime();
  let pickupNights = 0;
  let pickupRevenue = 0;
  const pickupRes = new Set<string>();
  for (const n of list) {
    const created = n.created_at_pms ? new Date(n.created_at_pms).getTime() : NaN;
    if (Number.isFinite(created) && created >= since) {
      pickupNights += 1;
      pickupRevenue += Number(n.nightly_price_eur ?? 0);
      if (n.res_id) pickupRes.add(n.res_id);
    }
  }

  const soldToday = list.filter((n) => n.stay_date === today).length;

  const attention = ((snaps ?? []) as { stay_date: string; rooms_sold: number | null; rooms_available: number | null }[])
    .map((s) => ({
      date: s.stay_date,
      occ: s.rooms_available ? Math.round(((s.rooms_sold ?? 0) / s.rooms_available) * 100) : null,
    }))
    .filter((s) => s.occ != null && s.occ < 60)
    .slice(0, 14);

  const changes = (actions ?? []) as { stay_date: string; old_price: number | null; new_price: number | null; reason: string | null }[];

  return { pickupNights, pickupRevenue, pickupRes: pickupRes.size, soldToday, attention, changes };
}

function renderHtml(hotelId: string, today: string, d: Awaited<ReturnType<typeof buildDigest>>) {
  const rows = d.attention.length
    ? d.attention.map((a) => `<li>${a.date} — ${a.occ}% sold</li>`).join("")
    : "<li>Nothing under 60% in the next 14 days.</li>";
  const changes = d.changes.length
    ? d.changes.slice(0, 15).map((c) => `<li>${c.stay_date}: ${c.old_price ?? "—"} → ${c.new_price ?? "—"} <span style="color:#666">${c.reason ?? ""}</span></li>`).join("")
    : "<li>The automation made no change overnight.</li>";

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:600px">
    <h2 style="margin:0 0 4px">${hotelId} — morning summary</h2>
    <p style="color:#666;margin:0 0 16px">${today}</p>
    <h3 style="margin:16px 0 4px">Pickup in the last 24 hours</h3>
    <p style="margin:0">${d.pickupNights} room nights across ${d.pickupRes} reservations, ${Math.round(d.pickupRevenue)} in room revenue.</p>
    <h3 style="margin:16px 0 4px">Today</h3>
    <p style="margin:0">${d.soldToday} rooms occupied tonight.</p>
    <h3 style="margin:16px 0 4px">Dates that need attention</h3>
    <ul style="margin:0;padding-left:18px">${rows}</ul>
    <h3 style="margin:16px 0 4px">What the automation changed</h3>
    <ul style="margin:0;padding-left:18px">${changes}</ul>
    <p style="color:#888;font-size:12px;margin-top:24px">Sent by Hotel Care. Switch this off in Revenue → Morning e-mail.</p>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return json({ error: "RESEND_API_KEY is not configured" }, 500);
    const resend = new Resend(resendKey);

    const body = await req.json().catch(() => ({}));
    const force = Boolean(body.force);
    const requestedHotel = body.hotelId ? String(body.hotelId) : null;

    let requester: { id: string; email?: string } | null = null;
    if (force) {
      const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
      const { data: userRes } = await admin.auth.getUser(token);
      if (!userRes?.user) return json({ error: "Not signed in" }, 401);
      const { data: ok } = await admin.rpc("is_revenue_user", { _uid: userRes.user.id });
      if (!ok) return json({ error: "Revenue access is required" }, 403);
      requester = { id: userRes.user.id, email: userRes.user.email ?? undefined };
    }

    const now = budapestParts();
    let query = admin
      .from("revenue_digest_settings")
      .select("hotel_id, organization_slug, enabled, send_hour, send_minute, recipients, last_sent_on");
    if (requestedHotel) query = query.eq("hotel_id", requestedHotel);
    const { data: settings } = await query;

    const due = (settings ?? []).filter((s) =>
      force
        ? true
        : s.enabled && s.last_sent_on !== now.date && (now.hour > s.send_hour || (now.hour === s.send_hour && now.minute >= s.send_minute))
    );

    const sent: string[] = [];

    for (const s of due) {
      const digest = await buildDigest(admin, s.hotel_id, now.date);

      let recipients: string[] = [...(s.recipients ?? [])];
      if (force && requester?.email) {
        recipients = [requester.email];
      } else {
        const { data: staff } = await admin
          .from("profiles")
          .select("email, role, assigned_hotel, organization_slug")
          .eq("organization_slug", s.organization_slug)
          .in("role", ["admin", "top_management", "top_management_manager", "manager"])
          .is("deleted_at", null);
        for (const p of staff ?? []) {
          if (p.email) recipients.push(p.email as string);
        }
      }
      recipients = [...new Set(recipients.filter(Boolean))];
      if (!recipients.length) continue;

      const { error } = await resend.emails.send({
        from: "Hotel Care <onboarding@resend.dev>",
        to: recipients,
        subject: `${s.hotel_id} — morning revenue summary (${now.date})`,
        html: renderHtml(s.hotel_id, now.date, digest),
      });
      if (error) {
        console.error("revenue-morning-digest send failed", error);
        continue;
      }

      if (!force) {
        await admin.from("revenue_digest_settings")
          .update({ last_sent_on: now.date })
          .eq("hotel_id", s.hotel_id);
      }
      sent.push(s.hotel_id);
    }

    return json({ ok: true, sent });
  } catch (e) {
    console.error("revenue-morning-digest error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
