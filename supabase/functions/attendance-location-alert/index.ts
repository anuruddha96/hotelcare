// Emails HotelCare support when a staff member had to check in without a
// location fix ("temporary access"). Work is never blocked by location: the
// attendance row already exists when this runs, and this function only reports.
//
// POST { attendance_id }  — called by the signed-in staff member right after
// their temporary check-in. One email per attendance row (deduplicated).
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { loadEmailSettings, sendEmail } from "../_shared/emailSender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const line = (v: unknown, max = 300) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);

type Attempt = { highAccuracy?: boolean; outcome?: string; code?: number; ms?: number };
type Diagnostics = {
  reason?: string; site_permission?: string | null; attempts?: Attempt[]; user_agent?: string | null;
  online?: boolean | null; installed_app?: boolean; secure_context?: boolean | null; app_opt_in?: boolean;
};

/** One plain sentence support can act on. */
export function likelyCause(d: Diagnostics): { cause: string; fix: string } {
  const codes = (d.attempts || []).map((a) => a.code);
  if (d.reason === "unsupported") {
    return { cause: "The browser on this phone does not offer location.",
      fix: "Open HotelCare in Chrome (Android) or Safari (iPhone)." };
  }
  if (d.site_permission === "denied") {
    return { cause: "Location is blocked for HotelCare in the browser.",
      fix: "Chrome → lock icon next to the address → Permissions → Location → Allow." };
  }
  if (d.site_permission === "granted" && codes.includes(1)) {
    return { cause: "HotelCare is allowed in the browser, but the phone refused to give Chrome a position. Usually Chrome lost its Android location permission (e.g. \"Only this time\" expired) or Location is off.",
      fix: "Android Settings → Apps → Chrome → Permissions → Location → \"Allow only while using the app\" and turn on \"Use precise location\". Make sure Location is on in quick settings." };
  }
  if (codes.includes(3) || d.reason === "timeout") {
    return { cause: "The phone could not find its position in time (often indoors or with Wi-Fi/Google location accuracy off).",
      fix: "Turn on Location → Location services → Google Location Accuracy and Wi-Fi scanning; switch off battery saver for Chrome." };
  }
  return { cause: "The phone reported that its position is unavailable.",
    fix: "Toggle Location off and on, check Google Location Accuracy is on, then try again near a window." };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Mail service is not configured" }, 500);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return json({ error: "Please sign in" }, 401);
  const { data: auth, error: authError } = await admin.auth.getUser(bearer);
  if (authError || !auth?.user) return json({ error: "Invalid session" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const attendanceId = String(body.attendance_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(attendanceId)) return json({ error: "Invalid attendance" }, 400);

  const { data: row, error: rowError } = await admin.from("staff_attendance")
    .select("id,user_id,organization_slug,work_date,check_in_time,check_in_location")
    .eq("id", attendanceId).maybeSingle();
  if (rowError || !row) return json({ error: "Attendance not found" }, 404);
  // Only the staff member who checked in can trigger the alert for their row.
  if (row.user_id !== auth.user.id) return json({ error: "Not your attendance" }, 403);
  const loc = (row.check_in_location || {}) as Record<string, unknown>;
  if (loc.location_unavailable !== true) return json({ ok: true, skipped: true, reason: "Location was verified" });
  if (loc.alert_emailed_at) return json({ ok: true, skipped: true, reason: "Already reported" });
  if (Date.now() - new Date(row.check_in_time).getTime() > 6 * 60 * 60 * 1000) {
    return json({ ok: true, skipped: true, reason: "Too old to report" });
  }

  const { data: person } = await admin.from("profiles")
    .select("full_name,nickname,email,role,assigned_hotel,organization_slug")
    .eq("id", row.user_id).maybeSingle();
  const name = line(person?.full_name || person?.nickname || "Staff member", 120);
  const hotel = line(person?.assigned_hotel || "—", 120);
  const d = (loc.diagnostics || {}) as Diagnostics;
  const { cause, fix } = likelyCause({ ...d, reason: String(loc.reason || d.reason || "") });
  const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Budapest", dateStyle: "medium", timeStyle: "short" })
    .format(new Date(row.check_in_time));
  const attempts = (d.attempts || []).slice(0, 4).map((a, i) =>
    `Try ${i + 1}: ${a.highAccuracy ? "GPS" : "network"} → ${line(a.outcome, 20)}${a.code !== undefined ? ` (code ${a.code})` : ""} after ${Math.round((a.ms || 0) / 100) / 10}s`);
  const facts: Array<[string, string]> = [
    ["Staff member", `${name} (${line(person?.role, 40)})`],
    ["Hotel", hotel],
    ["Organization", line(row.organization_slug, 60)],
    ["Checked in", `${when} — temporary access, no location`],
    ["Error", line(loc.reason || d.reason, 30)],
    ["Browser site permission", line(d.site_permission ?? "unknown", 30)],
    ["Installed app (home screen)", d.installed_app ? "yes" : "no"],
    ["Online", d.online === false ? "no" : "yes"],
    ["Device", line(d.user_agent || "unknown", 300)],
  ];
  const inbox = Deno.env.get("ATTENDANCE_ALERT_INBOX") || "info@hotelcare.app";
  const subject = `Attendance · location not working · ${hotel} · ${name}`;
  const text = [
    "HotelCare — staff checked in without location",
    `${name} could not share a location and was given temporary access so work could start.`,
    "", `Likely cause: ${cause}`, `How to fix on the phone: ${fix}`, "",
    ...facts.map(([k, v]) => `${k}: ${v}`), ...attempts, "", `Attendance ID: ${row.id}`,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<div style="padding:24px 12px"><div style="max-width:600px;margin:auto;background:#fff;border:1px solid #dbe5ef;border-radius:16px;overflow:hidden">
<div style="background:#0d3554;color:#fff;padding:20px 24px"><div style="font-size:20px;font-weight:800">✦ HotelCare</div>
<div style="font-size:12px;opacity:.8;margin-top:4px">ATTENDANCE · LOCATION ALERT</div></div>
<div style="padding:24px">
<h1 style="font-size:20px;margin:0 0 8px">${esc(name)} checked in without location</h1>
<p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 16px">The phone could not share a location, so HotelCare gave temporary access and work started normally. Please help fix the phone so tomorrow's check-in is location-verified.</p>
<div style="border-left:4px solid #f59e0b;background:#fffbeb;padding:12px 14px;border-radius:6px;margin-bottom:12px"><strong>Likely cause</strong><p style="margin:6px 0 0;line-height:1.5">${esc(cause)}</p></div>
<div style="border-left:4px solid #0284c7;background:#f0f9ff;padding:12px 14px;border-radius:6px;margin-bottom:16px"><strong>How to fix on the phone</strong><p style="margin:6px 0 0;line-height:1.5">${esc(fix)}</p></div>
<table style="width:100%;font-size:13px;border-collapse:collapse">${facts.map(([k, v]) =>
    `<tr><td style="padding:5px 10px 5px 0;color:#64748b;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:5px 0;word-break:break-word">${esc(v)}</td></tr>`).join("")}</table>
${attempts.length ? `<p style="font-size:12px;color:#64748b;margin:14px 0 0">${attempts.map(esc).join("<br>")}</p>` : ""}
<p style="font-size:11px;color:#94a3b8;margin:18px 0 0">Attendance ID ${esc(row.id)}. HR sees this check-in marked as not location-verified.</p>
</div></div></div></body></html>`;

  const base = await loadEmailSettings(admin as never, row.organization_slug);
  const settings = { ...base, from_name: "HotelCare.app", from_email: "notifications@updates.hotelcare.app", reply_to: "info@hotelcare.app" };
  let result: { ok: boolean; id?: string; error?: string; skipped?: boolean };
  try {
    result = await sendEmail({ admin: admin as never, organizationSlug: row.organization_slug, to: [inbox], subject, html, text, kind: "transactional", settings });
  } catch (error) { result = { ok: false, error: String(error) }; }

  // Record the outcome on the row itself (no schema change needed) so the
  // same check-in is never reported twice and HR can see that support knew.
  await admin.from("staff_attendance").update({
    check_in_location: { ...loc, alert_emailed_at: result.ok ? new Date().toISOString() : null,
      alert_status: result.ok ? "sent" : result.skipped ? "skipped" : "failed",
      alert_error: result.ok ? null : line(result.error, 300) },
  }).eq("id", row.id);
  if (!result.ok) return json({ ok: false, error: result.error || "Email failed" }, result.skipped ? 200 : 502);
  return json({ ok: true });
});
