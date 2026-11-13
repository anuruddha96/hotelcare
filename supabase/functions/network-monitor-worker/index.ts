import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { sendEmail } from "../_shared/emailSender.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-worker-secret",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Claimed = {
  alert_id: string;
  alert_kind: "outage" | "recovery";
  organization_slug: string;
  hotel_id: string;
  device_label: string;
  last_heartbeat_at: string;
  incident_started_at: string;
  incident_detected_at: string;
  incident_recovered_at: string | null;
};
const ADMIN_EMAIL = "anu@rdhotels.hu";

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c] || c);
}
function budapest(value: string | null): string {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest", dateStyle: "medium", timeStyle: "medium",
  }).format(new Date(value)) + " (Budapest)";
}
function emailFor(row: Claimed, hotelName: string) {
  const outage = row.alert_kind === "outage";
  const subject = `${outage ? "Possible Internet Outage" : "Connection Restored"} — ${hotelName}`;
  const lines = [
    outage
      ? "HotelCare stopped receiving connectivity heartbeats from the registered reception computer. This might mean an internet outage, a powered-off PC, or a suspended browser."
      : "HotelCare is receiving connectivity heartbeats from the registered reception computer again.",
    `Hotel: ${hotelName}`,
    `Computer: ${row.device_label}`,
    `Last confirmed connection before interruption: ${budapest(row.incident_started_at)}`,
    `Possible outage detected: ${budapest(row.incident_detected_at)}`,
    ...(outage ? [] : [`Connection restored: ${budapest(row.incident_recovered_at)}`]),
    "No action or confirmation is required from reception.",
  ];
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;color:#172433">
    <h2 style="color:${outage ? "#b91c1c" : "#15803d"}">${escapeHtml(subject)}</h2>
    <p>${escapeHtml(lines[0])}</p>
    <table style="border-collapse:collapse;width:100%">${lines.slice(1, -1).map((line) => {
      const separator = line.indexOf(":");
      return `<tr><td style="padding:7px;border-bottom:1px solid #e5e7eb"><strong>${escapeHtml(line.slice(0, separator))}</strong></td><td style="padding:7px;border-bottom:1px solid #e5e7eb">${escapeHtml(line.slice(separator + 1).trim())}</td></tr>`;
    }).join("")}</table>
    <p style="font-size:13px;color:#64748b">${escapeHtml(lines[lines.length - 1])}</p>
    </div>`;
  return { subject, html, text: lines.join("\n") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("NETWORK_MONITOR_WORKER_SECRET") || "";
  if (!safeEqual(req.headers.get("x-worker-secret") || "", secret)) {
    return json({ error: "Unauthorized" }, 401);
  }
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Missing Supabase credentials" }, 503);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: prepared, error: prepError } = await admin.rpc("network_monitor_prepare_alerts");
  if (prepError) return json({ error: "Cannot process network incidents", detail: prepError.message }, 503);
  const { data: claimData, error: claimError } = await admin.rpc("network_monitor_claim_alerts", { p_limit: 30 });
  if (claimError) return json({ error: "Cannot claim network notifications", detail: claimError.message }, 503);
  const claimed = (claimData || []) as Claimed[];
  if (!claimed.length) return json({ ok: true, prepared: Number(prepared), claimed: 0, emails_sent: 0 });

  const hotelIds = [...new Set(claimed.map((x) => x.hotel_id))];
  const { data: hotels } = await admin.from("hotel_configurations")
    .select("hotel_id,hotel_name").in("hotel_id", hotelIds);
  const hotelNames = new Map((hotels || []).map((h) => [h.hotel_id, h.hotel_name || h.hotel_id]));
  let emailsSent = 0;
  let emailsFailed = 0;

  for (const row of claimed) {
    // A pilot for RD Hotels only. Never send other tenants' monitoring data
    // to the RD Hotels administrator.
    if (row.organization_slug !== "rdhotels") {
      await admin.from("network_monitor_alerts").update({
        status: "cancelled", last_error: "Other organizations are not configured",
      }).eq("id", row.alert_id).eq("status", "sending");
      continue;
    }
    const name = hotelNames.get(row.hotel_id) || row.hotel_id;
    const body = emailFor(row, name);
    try {
      const sent = await sendEmail({
        admin: admin as any, organizationSlug: row.organization_slug,
        to: [ADMIN_EMAIL], subject: body.subject, html: body.html,
        text: body.text, kind: "transactional",
      });
      if (!sent.ok) throw new Error(sent.error || "Email provider rejected the notification");
      const { error } = await admin.from("network_monitor_alerts").update({
        status: "sent", sent_at: new Date().toISOString(),
        provider_message_id: sent.id || null, last_error: null,
      }).eq("id", row.alert_id).eq("status", "sending");
      if (error) throw error;
      emailsSent++;
    } catch (error) {
      emailsFailed++;
      const message = String(error instanceof Error ? error.message : error);
      await admin.from("network_monitor_alerts").update({
        status: "failed", last_error: message.slice(0, 500),
        next_retry_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      }).eq("id", row.alert_id).eq("status", "sending");
    }
  }
  return json({ ok: emailsFailed === 0, prepared: Number(prepared),
    claimed: claimed.length, emails_sent: emailsSent, failed: emailsFailed }, emailsFailed ? 207 : 200);
});
