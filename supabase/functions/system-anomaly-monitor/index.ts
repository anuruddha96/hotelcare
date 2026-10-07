import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { sendEmail } from "../_shared/emailSender.ts";

const ADMIN_FALLBACK = "anuruddha.dharmasena@gmail.com";

type Alert = {
  id: string;
  fingerprint: string;
  kind: string;
  severity: "warning" | "critical";
  title: string;
  details: Record<string, unknown> | null;
  detected_at: string;
  notify_attempts: number;
};

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

function detailRows(details: Record<string, unknown> | null): string {
  if (!details) return "";
  return Object.entries(details)
    .filter(([key]) => key !== "query_sample")
    .map(([key, value]) =>
      `<tr><td style="padding:5px 10px 5px 0;color:#64748b;vertical-align:top">${esc(key.replace(/_/g, " "))}</td><td style="padding:5px 0;font-weight:600">${esc(
        typeof value === "object" ? JSON.stringify(value) : value,
      )}</td></tr>`
    )
    .join("");
}

function messageFor(alert: Alert) {
  const details = alert.details || {};
  const query = typeof details.query_sample === "string" ? details.query_sample : "";
  const severity = alert.severity.toUpperCase();
  const subject = `[HotelCare ${severity}] ${alert.title}`;
  const text = [
    `HotelCare system anomaly — ${severity}`,
    alert.title,
    `Detected: ${formatTime(alert.detected_at)}`,
    `Type: ${alert.kind}`,
    `Fingerprint: ${alert.fingerprint}`,
    ...Object.entries(details).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`),
    "",
    "HotelCare detected this automatically from PostgreSQL runtime counters. Duplicate alerts are rate-limited.",
  ].join("\n");

  const html = `
  <div style="background:#f6f9fc;padding:28px 12px;font-family:Arial,sans-serif;color:#0f172a">
    <div style="max-width:650px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
      <div style="padding:18px 24px;border-bottom:1px solid #e2e8f0">
        <div style="font-size:20px;font-weight:800"><span style="color:#16b9d4">✦</span> HotelCare</div>
      </div>
      <div style="padding:24px">
        <div style="display:inline-block;background:${alert.severity === "critical" ? "#fef2f2" : "#fff7ed"};color:${alert.severity === "critical" ? "#b91c1c" : "#9a3412"};border:1px solid ${alert.severity === "critical" ? "#fecaca" : "#fed7aa"};border-radius:999px;padding:5px 10px;font-size:12px;font-weight:800;margin-bottom:12px">${esc(severity)}</div>
        <h2 style="font-size:21px;margin:0 0 8px">${esc(alert.title)}</h2>
        <p style="margin:0 0 18px;color:#64748b;font-size:13px">Detected ${esc(formatTime(alert.detected_at))} · ${esc(alert.kind)}</p>
        <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:16px">${detailRows(details)}</table>
        ${query ? `<div style="margin-top:14px"><div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:6px">Query sample</div><pre style="white-space:pre-wrap;word-break:break-word;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;font-size:11px;line-height:1.45;max-height:240px;overflow:auto">${esc(query)}</pre></div>` : ""}
        <p style="font-size:12px;color:#64748b;line-height:1.5;margin:18px 0 0">This alert is generated automatically from PostgreSQL rollback, deadlock, query-frequency and execution-time counters. The same anomaly is rate-limited to avoid e-mail loops.</p>
      </div>
    </div>
  </div>`;

  return { subject, text, html };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceRole) return json({ error: "Supabase worker environment is incomplete" }, 500);

  const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
  const suppliedSecret = (req.headers.get("x-worker-secret") || "").trim();
  const envSecret = (Deno.env.get("SYSTEM_ANOMALY_WORKER_SECRET") || "").trim();

  let authorized = !!suppliedSecret && !!envSecret && suppliedSecret === envSecret;
  if (!authorized && suppliedSecret) {
    const { data: dbSecret, error: secretError } = await admin.rpc("get_system_anomaly_worker_secret");
    if (!secretError && typeof dbSecret === "string" && dbSecret.length > 0) {
      authorized = suppliedSecret === dbSecret;
    }
  }
  if (!authorized) return json({ error: "Unauthorized" }, 401);

  const { data: detection, error: detectionError } = await admin.rpc("detect_system_anomalies");
  if (detectionError) {
    console.error("system anomaly detection failed", detectionError.message);
    return json({ error: "System anomaly detection failed" }, 500);
  }

  const { data: settings } = await admin
    .from("system_anomaly_settings")
    .select("enabled,admin_email")
    .eq("singleton", true)
    .maybeSingle();

  if (settings && settings.enabled === false) {
    return json({ detection, sent: 0, failed: 0, enabled: false });
  }

  const recipient =
    typeof settings?.admin_email === "string" && /^\S+@\S+\.\S+$/.test(settings.admin_email)
      ? settings.admin_email
      : ADMIN_FALLBACK;

  const { data: claimed, error: claimError } = await admin.rpc("claim_system_anomaly_alerts", { p_limit: 10 });
  if (claimError) {
    console.error("system anomaly alert claim failed", claimError.message);
    return json({ error: "Unable to claim system anomaly alerts", detection }, 500);
  }

  let sent = 0;
  let failed = 0;

  for (const raw of claimed || []) {
    const alert = raw as Alert;
    const message = messageFor(alert);
    const result = await sendEmail({
      admin: admin as never,
      to: [recipient],
      subject: message.subject,
      html: message.html,
      text: message.text,
      kind: "transactional",
    });

    if (result.ok) {
      sent++;
      const { error } = await admin
        .from("system_anomaly_alerts")
        .update({
          status: "sent",
          notified_at: new Date().toISOString(),
          processing_started_at: null,
          email_message_id: result.id || null,
          last_notify_error: null,
        })
        .eq("id", alert.id)
        .eq("status", "sending");
      if (error) console.error("could not mark anomaly alert sent", alert.id, error.message);
    } else {
      failed++;
      const { error } = await admin
        .from("system_anomaly_alerts")
        .update({
          status: "pending",
          processing_started_at: null,
          last_notify_error: (result.error || "Email delivery failed").slice(0, 1000),
        })
        .eq("id", alert.id)
        .eq("status", "sending");
      if (error) console.error("could not release anomaly alert", alert.id, error.message);
    }
  }

  return json({
    detection,
    claimed: (claimed || []).length,
    sent,
    failed,
    recipient,
    checked_at: new Date().toISOString(),
  });
});
