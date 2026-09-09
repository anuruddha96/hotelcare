import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.0";
import { sendEmail } from "../_shared/emailSender.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-worker-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

type AlertRow = {
  id: string;
  organization_slug: string;
  hotel_id: string;
  work_date: string;
  user_id: string;
  recipients: string[];
  assignment_count: number;
  cutoff_at: string;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) return json({ error: "Server configuration is incomplete" }, 500);

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const providedSecret = req.headers.get("x-worker-secret") || "";
  const { data: expectedSecret, error: secretError } = await admin.rpc(
    "get_housekeeping_activity_worker_secret",
  );
  if (secretError || !safeEqual(providedSecret, String(expectedSecret || ""))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { data: prepared, error: prepareError } = await admin.rpc(
    "prepare_due_housekeeping_activity_alerts",
  );
  if (prepareError) return json({ error: prepareError.message }, 500);

  const { data: claimedData, error: claimError } = await admin.rpc(
    "claim_housekeeping_activity_alerts",
    { p_limit: 100 },
  );
  if (claimError) return json({ error: claimError.message }, 500);

  const claimed = (claimedData || []) as AlertRow[];
  if (!claimed.length) {
    return json({ ok: true, prepared: Number(prepared || 0), claimed: 0, emails_sent: 0 });
  }

  const profileIds = [...new Set(claimed.map((row) => row.user_id))];
  const hotelIds = [...new Set(claimed.map((row) => row.hotel_id))];
  const [{ data: profiles }, { data: hotels }, { data: settings }] = await Promise.all([
    admin.from("profiles").select("id,full_name,email").in("id", profileIds),
    admin.from("hotel_configurations").select("hotel_id,hotel_name").in("hotel_id", hotelIds),
    admin
      .from("housekeeping_automation_settings")
      .select("organization_slug,hotel_id,timezone,inactivity_alert_time")
      .in("hotel_id", hotelIds),
  ]);

  const profileById = new Map<string, ProfileRow>(
    ((profiles || []) as ProfileRow[]).map((profile) => [profile.id, profile]),
  );
  const hotelNameById = new Map<string, string>(
    (hotels || []).map((hotel: any) => [hotel.hotel_id, hotel.hotel_name || hotel.hotel_id]),
  );
  const settingByKey = new Map<string, any>(
    (settings || []).map((setting: any) => [
      `${setting.organization_slug}|${setting.hotel_id}`,
      setting,
    ]),
  );

  // One concise e-mail per hotel/day, even if several housekeepers are late.
  const groups = new Map<string, AlertRow[]>();
  for (const row of claimed) {
    const recipientsKey = [...(row.recipients || [])].sort().join(",");
    const key = `${row.organization_slug}|${row.hotel_id}|${row.work_date}|${recipientsKey}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }

  let emailsSent = 0;
  let failedGroups = 0;
  const errors: Array<{ hotel_id: string; work_date: string; error: string }> = [];

  for (const rows of groups.values()) {
    const first = rows[0];
    const hotelName = hotelNameById.get(first.hotel_id) || first.hotel_id;
    const setting = settingByKey.get(`${first.organization_slug}|${first.hotel_id}`);
    const timezone = setting?.timezone || "Europe/Budapest";
    const cutoffTime = String(setting?.inactivity_alert_time || "08:45:00").slice(0, 5);
    const recipients = [...new Set(rows.flatMap((row) => row.recipients || []))];

    const people = rows.map((row) => {
      const profile = profileById.get(row.user_id);
      return {
        ...row,
        name: profile?.full_name || profile?.email || `Staff ${row.user_id.slice(0, 6)}`,
        email: profile?.email || "",
      };
    });

    const listHtml = people
      .map((person) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb"><strong>${escapeHtml(person.name)}</strong>${person.email ? `<br><span style="color:#6b7280;font-size:12px">${escapeHtml(person.email)}</span>` : ""}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${person.assignment_count}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb">No HotelCare activity by ${escapeHtml(cutoffTime)}</td>
        </tr>`)
      .join("");

    const namesText = people
      .map((person) => `- ${person.name}: ${person.assignment_count} assigned room${person.assignment_count === 1 ? "" : "s"}; no HotelCare activity by ${cutoffTime}`)
      .join("\n");

    const subject = `[Hotel Care] Housekeeping activity alert – ${hotelName} – ${first.work_date}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#111827">
        <div style="padding:18px 20px;background:#111827;color:#fff;border-radius:12px 12px 0 0">
          <div style="font-size:12px;opacity:.75;text-transform:uppercase;letter-spacing:.08em">Hotel Care · Housekeeping</div>
          <h2 style="margin:6px 0 0;font-size:20px">Housekeeper activity check</h2>
        </div>
        <div style="padding:20px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 12px 12px">
          <p style="margin-top:0"><strong>${escapeHtml(hotelName)}</strong> · ${escapeHtml(first.work_date)}</p>
          <p>The following housekeeper${people.length === 1 ? " was" : "s were"} assigned rooms this morning but had no HotelCare activity recorded by <strong>${escapeHtml(cutoffTime)}</strong> (${escapeHtml(timezone)}).</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <thead><tr style="background:#f9fafb"><th style="padding:9px 12px;text-align:left">Housekeeper</th><th style="padding:9px 12px">Rooms</th><th style="padding:9px 12px;text-align:left">Status</th></tr></thead>
            <tbody>${listHtml}</tbody>
          </table>
          <p style="margin-bottom:0;color:#6b7280;font-size:12px">HotelCare considers a staff member active if a housekeeping heartbeat, HotelCare attendance check-in, or room-start action was recorded by the cutoff. This alert is sent once per late housekeeper/day.</p>
        </div>
      </div>`;
    const text = `Hotel Care housekeeping activity alert\n${hotelName} · ${first.work_date}\n\n${namesText}\n\nCutoff timezone: ${timezone}`;

    const send = await sendEmail({
      admin: admin as any,
      organizationSlug: first.organization_slug,
      to: recipients,
      subject,
      html,
      text,
      kind: "transactional",
    });

    const ids = rows.map((row) => row.id);
    if (send.ok) {
      emailsSent += 1;
      await admin
        .from("housekeeping_automation_alerts")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          provider_message_id: send.id || null,
          last_error: null,
        })
        .in("id", ids);
    } else if (send.skipped) {
      await admin
        .from("housekeeping_automation_alerts")
        .update({ status: "skipped", last_error: send.error || "Email disabled" })
        .in("id", ids);
    } else {
      failedGroups += 1;
      const message = send.error || "Email send failed";
      errors.push({ hotel_id: first.hotel_id, work_date: first.work_date, error: message });
      await admin
        .from("housekeeping_automation_alerts")
        .update({ status: "failed", last_error: message })
        .in("id", ids);
    }
  }

  return json({
    ok: failedGroups === 0,
    prepared: Number(prepared || 0),
    claimed: claimed.length,
    groups: groups.size,
    emails_sent: emailsSent,
    failed_groups: failedGroups,
    errors,
  }, failedGroups > 0 ? 207 : 200);
});
