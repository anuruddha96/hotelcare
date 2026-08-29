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
  // A true rolling 24 hours — not "since midnight yesterday", which used to
  // stretch the window to as much as 48 hours and inflate every total.
  const windowStart = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const [
    { data: nights },
    { data: actions },
    { data: decisions },
    { count: raisedCells },
    { count: loweredCells },
    { count: raisedDates },
    { count: loweredDates },
    { data: runs },
    { data: snaps },
    { data: events },
  ] = await Promise.all([
    admin.from("revenue_booking_nights")
      .select("stay_date, res_id, nightly_price_eur, created_at_pms")
      .eq("hotel_id", hotelId).gte("stay_date", today).lte("stay_date", horizon).limit(20000),
    // A readable sample for the "what changed" list — never the source of the totals.
    admin.from("revenue_pickup_automation_actions")
      .select("stay_date, old_price, new_price, decision_reason, created_at, room_type_name")
      .eq("hotel_id", hotelId)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: false })
      .limit(400),
    // Engine V2 decides once per stay date, which is what the email should report.
    admin.from("revenue_date_decisions")
      .select("stay_date, direction, current_price, target_price, reason_detail")
      .eq("hotel_id", hotelId)
      .eq("status", "published")
      .gte("created_at", windowStart)
      .neq("direction", "hold")
      .order("created_at", { ascending: false })
      .limit(2000),
    // Exact totals, so a capped list can never understate or overstate the day.
    admin.from("revenue_pickup_automation_actions")
      .select("id", { count: "exact", head: true })
      .eq("hotel_id", hotelId).gte("created_at", windowStart).eq("decision_type", "pickup_increase"),
    admin.from("revenue_pickup_automation_actions")
      .select("id", { count: "exact", head: true })
      .eq("hotel_id", hotelId).gte("created_at", windowStart).eq("decision_type", "no_pickup_markdown"),
    admin.from("revenue_date_decisions")
      .select("id", { count: "exact", head: true })
      .eq("hotel_id", hotelId).eq("status", "published")
      .gte("created_at", windowStart).eq("direction", "increase"),
    admin.from("revenue_date_decisions")
      .select("id", { count: "exact", head: true })
      .eq("hotel_id", hotelId).eq("status", "published")
      .gte("created_at", windowStart).eq("direction", "decrease"),
    // Runs are reported separately: a failed run is news, not a silent zero.
    admin.from("revenue_automation_runs")
      .select("status, mode, started_at, failure_reason")
      .eq("hotel_id", hotelId).gte("started_at", windowStart)
      .order("started_at", { ascending: false }).limit(50),
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
  const since = Date.parse(windowStart);
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

  // Prefer stay-date decisions (engine V2): "18 dates priced up" is what a
  // revenue manager acts on, and the count is exact rather than page-capped.
  const dateDecisions = (decisions ?? []) as {
    stay_date: string; direction: string; current_price: number | null;
    target_price: number | null; reason_detail: string | null;
  }[];
  const changes = dateDecisions.length > 0
    ? dateDecisions.map((d) => ({
        stay_date: d.stay_date,
        old_price: d.current_price,
        new_price: d.target_price,
        decision_reason: d.reason_detail,
        room_type_name: null as string | null,
      }))
    : ((actions ?? []) as {
        stay_date: string; old_price: number | null; new_price: number | null;
        decision_reason: string | null; room_type_name: string | null;
      }[]);
  // Exact counts come from the database, never from a capped list.
  const usedDecisions = (raisedDates ?? 0) + (loweredDates ?? 0) > 0 || dateDecisions.length > 0;
  const raised = usedDecisions ? (raisedDates ?? 0) : (raisedCells ?? 0);
  const lowered = usedDecisions ? (loweredDates ?? 0) : (loweredCells ?? 0);
  const changeUnit = usedDecisions ? "date" : "price";

  const runRows = (runs ?? []) as { status: string; mode: string | null; started_at: string; failure_reason: string | null }[];
  const runsTotal = runRows.length;
  const runsFailed = runRows.filter((r) => r.status === "failed" || r.status === "timed_out" || r.status === "stopped_stale_data");
  const shadowRuns = runRows.filter((r) => r.mode === "shadow").length;

  const upcoming = ((events ?? []) as {
    title: string; event_date: string; end_date: string | null; category: string | null;
    expected_impact: string | null; venue: string | null;
  }[]);

  void orgSlug;

  return {
    pickupNights, pickupRevenue, pickupRes: pickupRes.size, topPickup,
    soldToday, availTonight, occTonight, adrTonight, revparTonight,
    occ14, adr14, rev14, attention, changes, raised, lowered, upcoming,
    changeUnit, runsTotal, shadowRuns,
    runsFailedCount: runsFailed.length,
    runFailures: runsFailed.slice(0, 5).map((r) => ({
      at: r.started_at, status: r.status, reason: r.failure_reason ?? "no reason recorded",
    })),
  };
}

interface Meta { asOf: string; syncedAt: string | null; stale: boolean }

function renderHtml(
  hotelName: string,
  today: string,
  d: Awaited<ReturnType<typeof buildDigest>>,
  meta: Meta,
  currency = "EUR",
) {
  const money = (n: number | null) => {
    if (n == null) return "—";
    const v = Math.round(n);
    return currency === "HUF" ? `${v.toLocaleString("hu-HU").replace(/,/g, " ")} Ft` : `€${v.toLocaleString("en-US")}`;
  };
  const BLUE = "#1d4ed8";
  const INK = "#0f172a";
  const MUTED = "#64748b";
  const LINE = "#e2e8f0";

  const rows = d.attention.length
    ? d.attention.map((a) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid ${LINE};color:${INK}">${a.date}</td>
             <td style="padding:8px 0;border-bottom:1px solid ${LINE};color:${MUTED}">${a.left != null ? `${a.left} left` : ""}${a.adr != null ? ` · ADR ${money(a.adr)}` : ""}</td>
             <td style="padding:8px 0;border-bottom:1px solid ${LINE};text-align:right;font-weight:700;color:${(a.occ ?? 0) < 40 ? "#b91c1c" : "#b45309"}">${a.occ}%</td></tr>`).join("")
    : `<tr><td style="padding:8px 0;color:${MUTED}">Nothing under 60% in the next 14 days — good shape.</td></tr>`;

  const li = (inner: string) => `<li style="margin:6px 0;color:${INK}">${inner}</li>`;
  const none = (t: string) => `<li style="margin:6px 0;color:${MUTED}">${t}</li>`;

  const movers = d.topPickup.length
    ? d.topPickup.map((p) => li(`<strong>${p.date}</strong> +${p.nights} night${p.nights === 1 ? "" : "s"} <span style="color:${MUTED}">${money(p.revenue)}</span>`)).join("")
    : none("No new bookings in the last 24 hours.");

  const events = d.upcoming.length
    ? d.upcoming.map((e) => {
        const span = e.end_date && e.end_date !== e.event_date ? `${e.event_date} → ${e.end_date}` : e.event_date;
        const meta2 = [e.category, e.venue, e.expected_impact].filter(Boolean).join(" · ");
        return li(`<strong>${span}</strong> ${e.title}${meta2 ? ` <span style="color:${MUTED}">${meta2}</span>` : ""}`);
      }).join("")
    : none("No events recorded for the next 45 days.");

  const changes = d.changes.length
    ? d.changes.slice(0, 15).map((c) =>
        li(`<strong>${c.stay_date}</strong>${c.room_type_name ? ` · ${c.room_type_name}` : ""} ${money(c.old_price)} → ${money(c.new_price)} <span style="color:${MUTED}">${c.decision_reason ?? ""}</span>`)).join("")
    : none("The automation made no change overnight.");

  const card = (label: string, value: string, sub = "") =>
    `<td style="padding:14px;background:#ffffff;border:1px solid #dbeafe;border-radius:12px;width:33%;vertical-align:top">
       <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:${MUTED}">${label}</div>
       <div style="font-size:22px;font-weight:700;color:${BLUE};margin-top:4px">${value}</div>
       ${sub ? `<div style="font-size:12px;color:${MUTED};margin-top:3px">${sub}</div>` : ""}
     </td>`;

  const h3 = (t: string) =>
    `<h3 style="margin:26px 0 8px;font-size:14px;font-weight:700;color:${INK};letter-spacing:.01em">${t}</h3>`;

  const freshness = meta.stale
    ? `<div style="margin:0 0 14px;padding:10px 12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;color:#9a3412;font-size:12px">
         Live data could not be refreshed just now — these figures are from the last successful sync${meta.syncedAt ? ` at ${meta.syncedAt}` : ""}.
       </div>`
    : "";

  return `
  <div style="color-scheme:light only;supported-color-schemes:light only;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;background:#ffffff;padding:20px">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${LINE}">
      <div style="background:#eff6ff;padding:22px 24px;border-bottom:1px solid #dbeafe">
        <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${BLUE};font-weight:700">Hotel Care</div>
        <div style="font-size:21px;font-weight:700;margin-top:6px;color:${INK}">${hotelName}</div>
        <div style="font-size:13px;color:${MUTED};margin-top:2px">Morning revenue summary · ${today} · ${meta.asOf} Budapest time</div>
      </div>
      <div style="padding:20px 24px;background:#ffffff">
        ${freshness}
        ${h3("Last 24 hours")}
        <table style="width:100%;border-spacing:8px 0"><tr>
          ${card("Pickup", `${d.pickupNights} nights`, `${d.pickupRes} reservation${d.pickupRes === 1 ? "" : "s"}`)}
          ${card("Room revenue", money(d.pickupRevenue), "new bookings")}
          ${card("Automation", `${d.raised}↑ ${d.lowered}↓`, `${d.raised + d.lowered} ${d.changeUnit}${d.raised + d.lowered === 1 ? "" : "s"} moved · ${d.runsTotal} run${d.runsTotal === 1 ? "" : "s"}${d.runsFailedCount ? `, ${d.runsFailedCount} failed` : ""}`)}
        </tr></table>

        ${h3("Tonight")}
        <table style="width:100%;border-spacing:8px 0"><tr>
          ${card("Occupancy", d.occTonight != null ? `${d.occTonight}%` : "—", `${d.soldToday}${d.availTonight ? ` / ${d.availTonight}` : ""} rooms`)}
          ${card("ADR", money(d.adrTonight))}
          ${card("RevPAR", money(d.revparTonight))}
        </tr></table>

        ${h3("Next 14 nights")}
        <p style="margin:0;color:${INK};font-size:14px">
          On the books: <strong style="color:${BLUE}">${d.occ14 != null ? `${d.occ14}%` : "—"}</strong> occupancy ·
          ADR <strong style="color:${BLUE}">${money(d.adr14)}</strong> · revenue <strong style="color:${BLUE}">${money(d.rev14)}</strong>
        </p>

        ${h3("Biggest movers")}
        <ul style="margin:0;padding-left:18px;font-size:14px">${movers}</ul>

        ${h3("Dates that need attention")}
        <table style="width:100%;font-size:14px">${rows}</table>

        ${h3("Events coming up")}
        <ul style="margin:0;padding-left:18px;font-size:14px">${events}</ul>

        ${h3("What the automation changed")}
        <ul style="margin:0;padding-left:18px;font-size:14px">${changes}</ul>

        ${h3("Automation health")}
        <p style="margin:0;color:${INK};font-size:14px">
          ${d.runsTotal} run${d.runsTotal === 1 ? "" : "s"} in the last 24 hours${d.shadowRuns ? ` (${d.shadowRuns} in test mode, no prices sent)` : ""}.
          ${d.runsFailedCount === 0 ? "All runs completed." : `<strong style="color:#b91c1c">${d.runsFailedCount} did not complete.</strong>`}
        </p>
        ${d.runFailures.length
          ? `<ul style="margin:6px 0 0;padding-left:18px;font-size:13px;color:${MUTED}">${d.runFailures.map((f) => `<li>${f.at.slice(0, 16).replace("T", " ")} — ${f.status}: ${f.reason}</li>`).join("")}</ul>`
          : ""}
      </div>
      <div style="padding:16px 24px;background:#f8fafc;border-top:1px solid ${LINE};color:${MUTED};font-size:12px;line-height:1.5">
        Figures as of ${meta.asOf} Budapest time${meta.syncedAt ? `, data last synced ${meta.syncedAt}` : ""}.<br />
        Confidential commercial data — sent only to the addresses configured in Revenue → Morning e-mail.
      </div>
    </div>
  </div>`;
}

function renderText(hotelName: string, today: string, d: Awaited<ReturnType<typeof buildDigest>>, meta: Meta, currency = "EUR") {
  const money = (n: number | null) => (n == null ? "-" : `${currency} ${Math.round(n).toLocaleString("en-US")}`);
  const lines = [
    `${hotelName} — morning revenue summary (${today}, ${meta.asOf} Budapest time)`,
    "",
    `Last 24 hours: ${d.pickupNights} nights / ${d.pickupRes} reservations / ${money(d.pickupRevenue)}`,
    `Automation: ${d.raised} up, ${d.lowered} down (${d.raised + d.lowered} ${d.changeUnit}s moved)`,
    `Automation health: ${d.runsTotal} runs, ${d.runsFailedCount} did not complete${d.shadowRuns ? `, ${d.shadowRuns} in test mode` : ""}`,
    ...d.runFailures.map((f) => `  ${f.at.slice(0, 16).replace("T", " ")} ${f.status}: ${f.reason}`),
    `Tonight: ${d.occTonight != null ? `${d.occTonight}%` : "-"} occupancy, ADR ${money(d.adrTonight)}, RevPAR ${money(d.revparTonight)}`,
    `Next 14 nights: ${d.occ14 != null ? `${d.occ14}%` : "-"} occupancy, ADR ${money(d.adr14)}, revenue ${money(d.rev14)}`,
    "",
    "Biggest movers:",
    ...(d.topPickup.length ? d.topPickup.map((p) => `  ${p.date}  +${p.nights} nights  ${money(p.revenue)}`) : ["  none"]),
    "",
    "Dates under 60% in the next 14 nights:",
    ...(d.attention.length ? d.attention.map((a) => `  ${a.date}  ${a.occ}%  ${a.left ?? "-"} left`) : ["  none"]),
    "",
    `Figures as of ${meta.asOf} Budapest time${meta.syncedAt ? `, data last synced ${meta.syncedAt}` : ""}.`,
    "Confidential — sent only to the configured recipients.",
  ];
  return lines.join("\n");
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
      // Only the addresses configured in Revenue → Morning e-mail. A forced
      // test also goes to the person who pressed the button. No role-based
      // expansion — this is confidential commercial data.
      const configured = ((s.recipients ?? []) as string[])
        .map((x) => String(x ?? "").trim())
        .filter((x) => /\S+@\S+\.\S+/.test(x) && !/@rdhotels\.local$/i.test(x));
      const recipients = [...new Set(
        (force ? [requester?.email ?? "", ...configured] : configured).filter(Boolean),
      )] as string[];
      if (!recipients.length) {
        failures.push({ hotel_id: s.hotel_id, error: "No recipients configured — add an e-mail address in Revenue → Morning e-mail." });
        continue;
      }

      // Refresh live Previo data first so the mail matches what the app shows
      // right now; if it fails we still send, but the mail says the data is old.
      let synced = false;
      try {
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/previo-revenue-sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ hotelId: s.hotel_id }),
          signal: AbortSignal.timeout(90_000),
        });
        synced = res.ok;
        if (!res.ok) console.warn(`digest sync failed for ${s.hotel_id}: ${res.status}`);
      } catch (e) {
        console.warn(`digest sync error for ${s.hotel_id}`, e);
      }

      const { data: state } = await admin
        .from("revenue_sync_state")
        .select("last_success_at")
        .eq("hotel_id", s.hotel_id)
        .maybeSingle();
      const lastSuccess = state?.last_success_at ? new Date(state.last_success_at as string) : null;
      const meta: Meta = {
        asOf: `${String(now.hour).padStart(2, "0")}:${String(now.minute).padStart(2, "0")}`,
        syncedAt: lastSuccess
          ? new Intl.DateTimeFormat("en-GB", {
              timeZone: "Europe/Budapest", hour: "2-digit", minute: "2-digit", hour12: false,
            }).format(lastSuccess)
          : null,
        stale: !synced && (!lastSuccess || Date.now() - lastSuccess.getTime() > 6 * 60 * 60 * 1000),
      };

      const digest = await buildDigest(admin, s.hotel_id, (s.organization_slug as string | null) ?? null, now.date);

      // hotel_id can be a slug ("ottofiori", "slnt-group") or a UUID — resolve both.
      const isUuid = /^[0-9a-f-]{36}$/i.test(String(s.hotel_id));
      let hotelName: string | null = null;
      if (isUuid) {
        const { data: hotel } = await admin.from("hotels").select("name").eq("id", s.hotel_id).maybeSingle();
        hotelName = (hotel?.name as string | undefined) ?? null;
      } else {
        const { data: named } = await admin.rpc("get_hotel_name_from_id", { hotel_id: s.hotel_id });
        hotelName = typeof named === "string" && named && named !== s.hotel_id ? named : null;
        // Slug-based properties live in hotel_configurations (works for any tenant).
        if (!hotelName) {
          const { data: cfg } = await admin
            .from("hotel_configurations")
            .select("hotel_name")
            .eq("hotel_id", s.hotel_id)
            .maybeSingle();
          hotelName = (cfg?.hotel_name as string | undefined) ?? null;
        }
        if (!hotelName) {
          const { data: hotel } = await admin.from("hotels").select("name").eq("name", s.hotel_id).maybeSingle();
          hotelName = (hotel?.name as string | undefined) ?? null;
        }
      }

      if (!hotelName) {
        failures.push({ hotel_id: s.hotel_id, error: `Could not resolve the hotel name for "${s.hotel_id}" — digest not sent.` });
        continue;
      }

      // Each hotel prices in its own base currency (SLNT = HUF, Ottofiori = EUR).
      const { data: revSettings } = await admin
        .from("hotel_revenue_settings")
        .select("base_currency")
        .eq("hotel_id", s.hotel_id)
        .maybeSingle();
      const currency = ((revSettings?.base_currency as string | undefined) ?? "EUR").toUpperCase();

      const html = renderHtml(hotelName, now.date, digest, meta, currency);
      const text = renderText(hotelName, now.date, digest, meta, currency);
      const subject = `${hotelName} — morning revenue summary (${now.date})`;

      // One message per recipient: nobody sees the other addresses.
      let anySent = false;
      let lastError: string | null = null;
      for (const to of recipients) {
        const result = await sendEmail({
          admin,
          organizationSlug: s.organization_slug as string | null,
          to: [to],
          subject,
          html,
          text,
          kind: "digest",
        });
        if (result.ok) anySent = true;
        else lastError = result.error ?? "send failed";
      }

      if (!anySent) {
        failures.push({ hotel_id: s.hotel_id, error: lastError ?? "send failed" });
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

