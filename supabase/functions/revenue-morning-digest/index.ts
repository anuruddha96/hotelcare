// The automatic morning e-mail for revenue people.
//
// Runs on a schedule (and can be triggered by hand from the app). For every
// hotel that switched the digest on and is due at this Budapest hour, it builds
// a short summary — yesterday's pickup, today's occupancy, the next fourteen
// days that need attention, and what the automation changed overnight — and
// sends it with Resend.

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/emailSender.ts";

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

interface Snap {
  stay_date: string;
  captured_date: string | null;
  rooms_sold: number | null;
  rooms_available: number | null;
  occupancy_pct: number | null;
  revenue_eur: number | null;
  adr_eur: number | null;
}

async function buildDigest(admin: ReturnType<typeof createClient>, hotelId: string, orgSlug: string | null, today: string) {
  const horizon = addDays(today, 60);
  const [{ data: nights }, { data: actions }, { data: snaps }, { data: events }] = await Promise.all([
    admin.from("revenue_booking_nights")
      .select("stay_date, res_id, nightly_price_eur, created_at_pms")
      .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizon).limit(20000),
    admin.from("revenue_pickup_automation_actions")
      .select("stay_date, old_price, new_price, decision_reason, created_at, room_type_name")
      .eq("hotel_id", hotelId)
      .gte("created_at", `${addDays(today, -1)}T00:00:00Z`)
      .limit(400),
    admin.from("revenue_daily_snapshots")
      .select("stay_date, captured_date, rooms_sold, rooms_available, occupancy_pct, revenue_eur, adr_eur")
      .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", addDays(today, 30)).limit(2000),
    admin.from("demand_events")
      .select("title, event_date, end_date, category, expected_impact, venue")
      .eq("hotel_id", hotelId)
      .gte("event_date", today).lte("event_date", addDays(today, 45))
      .order("event_date", { ascending: true }).limit(12),
  ]);

  const list = (nights ?? []) as Night[];
  const since = new Date(`${addDays(today, -1)}T00:00:00Z`).getTime();
  let pickupNights = 0;
  let pickupRevenue = 0;
  const pickupRes = new Set<string>();
  const perDate = new Map<string, { nights: number; revenue: number }>();
  for (const n of list) {
    const created = n.created_at_pms ? new Date(n.created_at_pms).getTime() : NaN;
    if (Number.isFinite(created) && created >= since) {
      pickupNights += 1;
      pickupRevenue += Number(n.nightly_price_eur ?? 0);
      if (n.res_id) pickupRes.add(n.res_id);
      const cur = perDate.get(n.stay_date) ?? { nights: 0, revenue: 0 };
      cur.nights += 1;
      cur.revenue += Number(n.nightly_price_eur ?? 0);
      perDate.set(n.stay_date, cur);
    }
  }
  const topPickup = [...perDate.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => b.nights - a.nights)
    .slice(0, 5);

  // One row per stay date — the most recent capture wins.
  const latest = new Map<string, Snap>();
  for (const raw of (snaps ?? []) as Snap[]) {
    const prev = latest.get(raw.stay_date);
    if (!prev || String(raw.captured_date ?? "") >= String(prev.captured_date ?? "")) latest.set(raw.stay_date, raw);
  }
  const days = [...latest.values()].sort((a, b) => a.stay_date.localeCompare(b.stay_date));

  const tonight = latest.get(today) ?? null;
  const soldToday = tonight?.rooms_sold ?? list.filter((n) => n.stay_date === today).length;
  const availTonight = tonight?.rooms_available ?? null;
  const occTonight = tonight?.occupancy_pct != null
    ? Math.round(Number(tonight.occupancy_pct))
    : availTonight ? Math.round((soldToday / availTonight) * 100) : null;
  const adrTonight = tonight?.adr_eur != null ? Math.round(Number(tonight.adr_eur)) : null;
  const revparTonight = adrTonight != null && occTonight != null ? Math.round((adrTonight * occTonight) / 100) : null;

  // Next 14 nights at a glance.
  const next14 = days.filter((d) => d.stay_date > today && d.stay_date <= addDays(today, 14));
  const sold14 = next14.reduce((s, d) => s + Number(d.rooms_sold ?? 0), 0);
  const avail14 = next14.reduce((s, d) => s + Number(d.rooms_available ?? 0), 0);
  const rev14 = next14.reduce((s, d) => s + Number(d.revenue_eur ?? 0), 0);
  const occ14 = avail14 ? Math.round((sold14 / avail14) * 100) : null;
  const adr14 = sold14 ? Math.round(rev14 / sold14) : null;

  const attention = next14
    .map((s) => ({
      date: s.stay_date,
      occ: s.occupancy_pct != null
        ? Math.round(Number(s.occupancy_pct))
        : s.rooms_available ? Math.round(((s.rooms_sold ?? 0) / s.rooms_available) * 100) : null,
      left: s.rooms_available != null ? Math.max(0, Number(s.rooms_available) - Number(s.rooms_sold ?? 0)) : null,
      adr: s.adr_eur != null ? Math.round(Number(s.adr_eur)) : null,
    }))
    .filter((s) => s.occ != null && s.occ < 60)
    .slice(0, 14);

  const changes = (actions ?? []) as {
    stay_date: string; old_price: number | null; new_price: number | null;
    decision_reason: string | null; room_type_name: string | null;
  }[];
  const raised = changes.filter((c) => Number(c.new_price ?? 0) > Number(c.old_price ?? 0)).length;
  const lowered = changes.filter((c) => Number(c.new_price ?? 0) < Number(c.old_price ?? 0)).length;

  const upcoming = ((events ?? []) as {
    title: string; event_date: string; end_date: string | null; category: string | null;
    expected_impact: string | null; venue: string | null;
  }[]);

  void orgSlug;

  return {
    pickupNights, pickupRevenue, pickupRes: pickupRes.size, topPickup,
    soldToday, availTonight, occTonight, adrTonight, revparTonight,
    occ14, adr14, rev14, attention, changes, raised, lowered, upcoming,
  };
}

function renderHtml(hotelName: string, today: string, d: Awaited<ReturnType<typeof buildDigest>>) {
  const money = (n: number | null) => (n == null ? "—" : `€${Math.round(n).toLocaleString("en-US")}`);

  const rows = d.attention.length
    ? d.attention.map((a) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${a.date}</td>
             <td style="padding:6px 0;border-bottom:1px solid #eee;color:#64748b">${a.left != null ? `${a.left} left` : ""}${a.adr != null ? ` · ADR ${money(a.adr)}` : ""}</td>
             <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600;color:${(a.occ ?? 0) < 40 ? "#b91c1c" : "#b45309"}">${a.occ}%</td></tr>`).join("")
    : `<tr><td style="padding:6px 0;color:#64748b">Nothing under 60% in the next 14 days — good shape.</td></tr>`;

  const movers = d.topPickup.length
    ? d.topPickup.map((p) =>
        `<li style="margin:4px 0"><strong>${p.date}</strong> +${p.nights} night${p.nights === 1 ? "" : "s"} <span style="color:#64748b">${money(p.revenue)}</span></li>`).join("")
    : `<li style="margin:4px 0;color:#64748b">No new bookings in the last 24 hours.</li>`;

  const events = d.upcoming.length
    ? d.upcoming.map((e) => {
        const span = e.end_date && e.end_date !== e.event_date ? `${e.event_date} → ${e.end_date}` : e.event_date;
        const meta = [e.category, e.venue, e.expected_impact].filter(Boolean).join(" · ");
        return `<li style="margin:4px 0"><strong>${span}</strong> ${e.title}${meta ? ` <span style="color:#64748b">${meta}</span>` : ""}</li>`;
      }).join("")
    : `<li style="margin:4px 0;color:#64748b">No events recorded for the next 45 days.</li>`;

  const changes = d.changes.length
    ? d.changes.slice(0, 15).map((c) =>
        `<li style="margin:4px 0"><strong>${c.stay_date}</strong>${c.room_type_name ? ` · ${c.room_type_name}` : ""} ${money(c.old_price)} → ${money(c.new_price)} <span style="color:#64748b">${c.decision_reason ?? ""}</span></li>`).join("")
    : `<li style="margin:4px 0;color:#64748b">The automation made no change overnight.</li>`;

  const card = (label: string, value: string, sub = "") =>
    `<td style="padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;width:33%;vertical-align:top">
       <div style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b">${label}</div>
       <div style="font-size:20px;font-weight:700;color:#0f172a;margin-top:2px">${value}</div>
       ${sub ? `<div style="font-size:12px;color:#64748b;margin-top:2px">${sub}</div>` : ""}
     </td>`;

  return `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f1f5f9;padding:20px">
    <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="background:linear-gradient(135deg,#0f172a,#1d4ed8);padding:20px 24px;color:#fff">
        <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.8">Hotel Care</div>
        <div style="font-size:20px;font-weight:700;margin-top:4px">${hotelName}</div>
        <div style="font-size:13px;opacity:.85">Morning revenue summary · ${today} · Budapest time</div>
      </div>
      <div style="padding:20px 24px">
        <h3 style="margin:0 0 8px;font-size:15px;color:#0f172a">Last 24 hours</h3>
        <table style="width:100%;border-spacing:8px 0"><tr>
          ${card("Pickup", `${d.pickupNights} nights`, `${d.pickupRes} reservation${d.pickupRes === 1 ? "" : "s"}`)}
          ${card("Room revenue", money(d.pickupRevenue), "new bookings")}
          ${card("Automation", `${d.raised}↑ ${d.lowered}↓`, `${d.changes.length} price move${d.changes.length === 1 ? "" : "s"}`)}
        </tr></table>

        <h3 style="margin:22px 0 8px;font-size:15px;color:#0f172a">Tonight</h3>
        <table style="width:100%;border-spacing:8px 0"><tr>
          ${card("Occupancy", d.occTonight != null ? `${d.occTonight}%` : "—", `${d.soldToday}${d.availTonight ? ` / ${d.availTonight}` : ""} rooms`)}
          ${card("ADR", money(d.adrTonight))}
          ${card("RevPAR", money(d.revparTonight))}
        </tr></table>

        <h3 style="margin:22px 0 8px;font-size:15px;color:#0f172a">Next 14 nights</h3>
        <p style="margin:0;color:#334155;font-size:14px">
          On the books: <strong>${d.occ14 != null ? `${d.occ14}%` : "—"}</strong> occupancy ·
          ADR <strong>${money(d.adr14)}</strong> · revenue <strong>${money(d.rev14)}</strong>
        </p>

        <h3 style="margin:22px 0 6px;font-size:15px;color:#0f172a">Biggest movers</h3>
        <ul style="margin:0;padding-left:18px;font-size:14px;color:#334155">${movers}</ul>

        <h3 style="margin:22px 0 6px;font-size:15px;color:#0f172a">Dates that need attention</h3>
        <table style="width:100%;font-size:14px;color:#334155">${rows}</table>

        <h3 style="margin:22px 0 6px;font-size:15px;color:#0f172a">Events coming up</h3>
        <ul style="margin:0;padding-left:18px;font-size:14px;color:#334155">${events}</ul>

        <h3 style="margin:22px 0 6px;font-size:15px;color:#0f172a">What the automation changed</h3>
        <ul style="margin:0;padding-left:18px;font-size:14px;color:#334155">${changes}</ul>
      </div>
      <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px">
        Sent by Hotel Care · switch this off in Revenue → Morning e-mail.
      </div>
    </div>
  </div>`;
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (!Deno.env.get("RESEND_API_KEY")) {
      return json({ error: "No RESEND_API_KEY is configured. Add it in Admin → E-mail settings." }, 500);
    }

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

    if (force && !due.length) {
      return json({ error: "Save the morning e-mail settings for this hotel first." }, 400);
    }

    const sent: string[] = [];
    const failures: { hotel_id: string; error: string }[] = [];

    for (const s of due) {
      const digest = await buildDigest(admin, s.hotel_id, now.date);
      const { data: hotel } = await admin.from("hotels").select("name").eq("id", s.hotel_id).maybeSingle();
      const hotelName = (hotel?.name as string | undefined) ?? "Your hotel";

      let recipients: string[] = [];
      if (force) {
        recipients = [requester?.email, ...(s.recipients ?? [])].filter(Boolean) as string[];
      } else {
        recipients = [...(s.recipients ?? [])];
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
      if (!recipients.length) {
        failures.push({ hotel_id: s.hotel_id, error: "No recipients — add an e-mail address." });
        continue;
      }

      const result = await sendEmail({
        admin,
        organizationSlug: s.organization_slug as string | null,
        to: recipients,
        subject: `${hotelName} — morning revenue summary (${now.date})`,
        html: renderHtml(hotelName, now.date, digest),
        kind: "digest",
      });

      if (!result.ok) {
        failures.push({ hotel_id: s.hotel_id, error: result.error ?? "send failed" });
        continue;
      }

      if (!force) {
        await admin.from("revenue_digest_settings")
          .update({ last_sent_on: now.date })
          .eq("hotel_id", s.hotel_id);
      }
      sent.push(s.hotel_id);
    }

    if (!sent.length && failures.length) {
      return json({ error: failures[0].error, failures }, 502);
    }

    return json({ ok: true, sent, failures, recipients_note: force ? "Sent to you and the extra recipients." : undefined });
  } catch (e) {
    console.error("revenue-morning-digest error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

