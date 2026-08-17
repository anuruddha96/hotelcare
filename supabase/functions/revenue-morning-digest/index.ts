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
      .select("stay_date, old_price, new_price, decision_reason, created_at")
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

  const changes = (actions ?? []) as { stay_date: string; old_price: number | null; new_price: number | null; decision_reason: string | null }[];

  return { pickupNights, pickupRevenue, pickupRes: pickupRes.size, soldToday, attention, changes };
}

function renderHtml(hotelName: string, today: string, d: Awaited<ReturnType<typeof buildDigest>>) {
  const rows = d.attention.length
    ? d.attention.map((a) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${a.date}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600;color:${(a.occ ?? 0) < 40 ? "#b91c1c" : "#b45309"}">${a.occ}%</td></tr>`).join("")
    : `<tr><td style="padding:6px 0;color:#64748b">Nothing under 60% in the next 14 days.</td></tr>`;
  const changes = d.changes.length
    ? d.changes.slice(0, 15).map((c) =>
        `<li style="margin:4px 0"><strong>${c.stay_date}</strong> ${c.old_price ?? "—"} → ${c.new_price ?? "—"} <span style="color:#64748b">${c.decision_reason ?? ""}</span></li>`).join("")
    : `<li style="margin:4px 0;color:#64748b">The automation made no change overnight.</li>`;

  const card = (label: string, value: string) =>
    `<td style="padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;width:33%">
       <div style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b">${label}</div>
       <div style="font-size:20px;font-weight:700;color:#0f172a;margin-top:2px">${value}</div>
     </td>`;

  return `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f1f5f9;padding:20px">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="background:linear-gradient(135deg,#0f172a,#1d4ed8);padding:20px 24px;color:#fff">
        <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.8">Hotel Care</div>
        <div style="font-size:20px;font-weight:700;margin-top:4px">${hotelName}</div>
        <div style="font-size:13px;opacity:.85">Morning revenue summary · ${today}</div>
      </div>
      <div style="padding:20px 24px">
        <table style="width:100%;border-spacing:8px 0"><tr>
          ${card("Pickup 24h", `${d.pickupNights} nights`)}
          ${card("Reservations", `${d.pickupRes}`)}
          ${card("Room revenue", `${Math.round(d.pickupRevenue)}`)}
        </tr></table>

        <h3 style="margin:24px 0 6px;font-size:15px;color:#0f172a">Tonight</h3>
        <p style="margin:0;color:#334155">${d.soldToday} rooms occupied.</p>

        <h3 style="margin:24px 0 6px;font-size:15px;color:#0f172a">Dates that need attention</h3>
        <table style="width:100%;font-size:14px;color:#334155">${rows}</table>

        <h3 style="margin:24px 0 6px;font-size:15px;color:#0f172a">What the automation changed</h3>
        <ul style="margin:0;padding-left:18px;font-size:14px;color:#334155">${changes}</ul>
      </div>
      <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px">
        Sent by Hotel Care · switch this off in Revenue → Morning e-mail.
      </div>
    </div>
  </div>`;
}

// Resend refuses to deliver from an unverified domain, and the shared sandbox
// sender only reaches the account owner. Try the branded sender first and fall
// back, so a misconfigured domain never silently swallows the mail.
const SENDERS = [
  "Hotel Care <noreply@rdhotels.com>",
  "Hotel Care <onboarding@resend.dev>",
];

async function sendWithFallback(
  resend: Resend,
  to: string[],
  subject: string,
  html: string,
): Promise<{ ok: boolean; from?: string; error?: string }> {
  let lastError = "unknown error";
  for (const from of SENDERS) {
    const { data, error } = await resend.emails.send({ from, to, subject, html });
    if (!error && data) return { ok: true, from };
    lastError = error ? (error.message ?? JSON.stringify(error)) : "no id returned";
    console.error(`revenue-morning-digest: send from ${from} failed — ${lastError}`);
  }
  return { ok: false, error: lastError };
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

      const result = await sendWithFallback(
        resend,
        recipients,
        `${hotelName} — morning revenue summary (${now.date})`,
        renderHtml(hotelName, now.date, digest),
      );

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

