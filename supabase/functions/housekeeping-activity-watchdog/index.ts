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

function formatLocalCutoff(cutoffAt: string, timezone: string): string {
  const date = new Date(cutoffAt);
  if (Number.isNaN(date.getTime())) return "the cutoff";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date) + " UTC";
  }
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
    // The saved alert cutoff is authoritative; live settings can differ from the trigger. 
    const cutoffTime = formatLocalCutoff(first.cutoff_at, timezone);
    const recipients = [...new Set(rows.flatMap((row) => row.recipients || []))];

    const people = rows.map((row) => {
      const profile = profileById.get(row.user_id);
      return {
        ...row,
        name: profile?.full_name || profile?.email || `Staff ${row.user_id.slice(0, 6)}`,
        email: profile?.email || "",
      };
    });

    const staffCount = people.length;
    const roomCount = people.reduce((sum, person) => sum + person.assignment_count, 0);
    const cutoffTimes = [...new Set(people.map((person) => formatLocalCutoff(person.cutoff_at, timezone)))];
    const sameCutoff = cutoffTimes.length === 1;
    const timeLabel = sameCutoff ? cutoffTime : "their individual cutoff times";
    const timezoneLabel = timezone === "Europe/Budapest" ? "Budapest time" : timezone;
    const dateLabel = new Intl.DateTimeFormat("en-GB", {
      day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    }).format(new Date(`${first.work_date}T12:00:00Z`));

    const listHtml = people.map((person) => `
      <tr>
        <td style="padding:15px 16px;border-bottom:1px solid #e9edf2">
          <div style="font-size:15px;font-weight:700;color:#152033">${escapeHtml(person.name)}</div>
          <div style="font-size:13px;line-height:20px;color:#526174;margin-top:3px">
            ${person.assignment_count} room${person.assignment_count === 1 ? "" : "s"} assigned${sameCutoff ? "" : ` · Cutoff ${escapeHtml(formatLocalCutoff(person.cutoff_at, timezone))}`}
          </div>
        </td>
      </tr>`).join("");

    const subject = `[HotelCare] No activity from ${staffCount} housekeeper${staffCount === 1 ? "" : "s"} · ${hotelName}`;
    const plainRows = people.map((person) =>
      `- ${person.name}: ${person.assignment_count} assigned room${person.assignment_count === 1 ? "" : "s"}${sameCutoff ? "" : ` (cutoff ${formatLocalCutoff(person.cutoff_at, timezone)})`}`
    ).join("\\n");
    const heading = `${staffCount} housekeeper${staffCount === 1 ? "" : "s"} need${staffCount === 1 ? "s" : ""} a check-in`;
    const explanation = `No HotelCare activity recorded by ${timeLabel} (${timezoneLabel}).`;
    const html = `
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">
        ${escapeHtml(heading)} · ${roomCount} room${roomCount === 1 ? "" : "s"} assigned · ${escapeHtml(hotelName)}
      </div>
      <div style="margin:0;padding:24px 12px;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#152033">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:580px;margin:0 auto;border-collapse:separate">
          <tr><td style="padding:18px 22px;background:#111c2e;border-radius:12px 12px 0 0">
            <div style="font-size:12px;color:#c2cee0;font-weight:700;letter-spacing:1px">HOTELCARE · HOUSEKEEPING</div>
            <div style="font-size:22px;line-height:29px;font-weight:700;color:#ffffff;margin-top:7px">Activity alert</div>
          </td></tr>
          <tr><td style="padding:23px 22px 24px;background:#ffffff;border:1px solid #e6eaf1;border-top:0;border-radius:0 0 12px 12px">
            <div style="font-size:13px;color:#526174;line-height:20px">${escapeHtml(hotelName)} · ${escapeHtml(dateLabel)}</div>
            <h1 style="margin:13px 0 12px;font-size:22px;line-height:29px;color:#152033">${escapeHtml(heading)}</h1>
            <div style="padding:12px 14px;border-left:4px solid #dd9b2b;background:#fff7e8;border-radius:4px;font-size:14px;line-height:21px;color:#5c441f">
              ${escapeHtml(explanation)}
            </div>
            <div style="font-size:13px;font-weight:700;color:#526174;margin:24px 0 8px">
              ${staffCount} staff member${staffCount === 1 ? "" : "s"} · ${roomCount} assigned room${roomCount === 1 ? "" : "s"}
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6eaf1;border-radius:9px;border-collapse:separate;border-spacing:0">
              ${listHtml}
            </table>
            <p style="margin:22px 0 16px;font-size:14px;line-height:22px;color:#334155">
              <strong>Next step:</strong> Check with the housekeeper${staffCount === 1 ? "" : "s"} and confirm they can access HotelCare.
            </p>
            <a href="https://my.hotelcare.app" style="display:inline-block;padding:12px 18px;background:#1f4d8f;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;border-radius:7px">Open HotelCare</a>
            <p style="margin:24px 0 0;padding-top:15px;border-top:1px solid #edf0f4;font-size:12px;line-height:19px;color:#64748b">
              This alert means activity was not recorded in HotelCare; it does not confirm the person is absent from work.
            </p>
          </td></tr>
        </table>
      </div>`;
    const text = `HotelCare housekeeping activity alert
${hotelName} · ${dateLabel}

${heading}
${explanation}

${plainRows}

Next step: Check with the housekeeper${staffCount === 1 ? "" : "s"} and confirm they can access HotelCare.
Open HotelCare: https://my.hotelcare.app

This alert does not confirm the person is absent from work.`;

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
