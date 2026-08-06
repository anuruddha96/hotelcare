// Safety net for pricing mistakes.
//
// Scans every published nightly rate in the booking horizon against the
// hotel's own thresholds and emails admins + top management when a price
// looks like a human error (2 EUR instead of 200, or a fat-fingered 9000).
// Each (date × room type × occupancy × price) is only ever reported once.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { Resend } from "npm:resend@2.0.0";

const ALERT_ROLES = ["admin", "top_management", "top_management_manager"];
const HORIZON_DAYS = 120;

interface Thresholds {
  rate_warn_below_eur: number;
  rate_critical_below_eur: number;
  rate_max_sane_eur: number;
  rate_alert_emails_enabled: boolean;
}

const DEFAULTS: Thresholds = {
  rate_warn_below_eur: 60,
  rate_critical_below_eur: 40,
  rate_max_sane_eur: 900,
  rate_alert_emails_enabled: true,
};

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const only: string | null = typeof body.hotelId === "string" ? body.hotelId : null;

    const { data: hotels } = await admin
      .from("hotel_revenue_settings")
      .select("hotel_id, organization_slug, rate_warn_below_eur, rate_critical_below_eur, rate_max_sane_eur, rate_alert_emails_enabled");

    const targets = (hotels ?? []).filter((h: any) => !only || h.hotel_id === only);
    if (only && targets.length === 0) targets.push({ hotel_id: only, ...DEFAULTS } as any);

    const today = new Date().toISOString().slice(0, 10);
    const horizon = addDays(today, HORIZON_DAYS);
    const summary: Array<{ hotel_id: string; found: number; emailed: number }> = [];

    for (const h of targets as any[]) {
      const t: Thresholds = {
        rate_warn_below_eur: Number(h.rate_warn_below_eur ?? DEFAULTS.rate_warn_below_eur),
        rate_critical_below_eur: Number(h.rate_critical_below_eur ?? DEFAULTS.rate_critical_below_eur),
        rate_max_sane_eur: Number(h.rate_max_sane_eur ?? DEFAULTS.rate_max_sane_eur),
        rate_alert_emails_enabled: h.rate_alert_emails_enabled !== false,
      };

      const { data: rates } = await admin
        .from("revenue_room_type_rates")
        .select("stay_date, room_type_name, occupancy, price")
        .eq("hotel_id", h.hotel_id)
        .gte("stay_date", today)
        .lte("stay_date", horizon)
        .order("stay_date")
        .limit(20000);

      const offenders = (rates ?? []).filter((r: any) => {
        const p = Number(r.price);
        if (!Number.isFinite(p)) return false;
        return p <= 0 || p < t.rate_critical_below_eur || p > t.rate_max_sane_eur;
      });

      if (offenders.length === 0) { summary.push({ hotel_id: h.hotel_id, found: 0, emailed: 0 }); continue; }

      // Skip anything already reported with the same price.
      const { data: existing } = await admin
        .from("revenue_rate_alerts")
        .select("stay_date, room_type_name, occupancy, price")
        .eq("hotel_id", h.hotel_id)
        .gte("stay_date", today);
      const seen = new Set(
        (existing ?? []).map((e: any) => `${e.stay_date}|${e.room_type_name}|${e.occupancy}|${Number(e.price)}`),
      );

      const fresh = offenders.filter(
        (r: any) => !seen.has(`${r.stay_date}|${r.room_type_name}|${r.occupancy}|${Number(r.price)}`),
      );
      if (fresh.length === 0) { summary.push({ hotel_id: h.hotel_id, found: 0, emailed: 0 }); continue; }

      const rows = fresh.map((r: any) => ({
        hotel_id: h.hotel_id,
        organization_slug: h.organization_slug ?? null,
        stay_date: r.stay_date,
        room_type_name: r.room_type_name,
        occupancy: r.occupancy,
        price: Number(r.price),
        severity: "critical",
      }));
      const { data: inserted } = await admin
        .from("revenue_rate_alerts").insert(rows).select("id");

      let emailed = 0;
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (t.rate_alert_emails_enabled && resendKey) {
        const { data: people } = await admin
          .from("profiles")
          .select("email, full_name, role, assigned_hotel, organization_slug")
          .in("role", ALERT_ROLES);

        const recipients = (people ?? [])
          .filter((p: any) =>
            p.email &&
            (p.role === "admin" ||
              p.assigned_hotel === h.hotel_id ||
              (h.organization_slug && p.organization_slug === h.organization_slug)))
          .map((p: any) => p.email as string);

        const unique = Array.from(new Set(recipients));
        if (unique.length > 0) {
          const list = fresh.slice(0, 30).map((r: any) =>
            `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${r.stay_date}</td>` +
            `<td style="padding:6px 10px;border-bottom:1px solid #eee">${r.room_type_name}</td>` +
            `<td style="padding:6px 10px;border-bottom:1px solid #eee">${r.occupancy} guest(s)</td>` +
            `<td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${Number(r.price).toFixed(0)} EUR</td></tr>`,
          ).join("");

          const html = `
            <div style="font-family:Arial,Helvetica,sans-serif;color:#111">
              <h2 style="margin:0 0 8px">Unusual rates detected — ${h.hotel_id}</h2>
              <p style="margin:0 0 16px;color:#555">
                ${fresh.length} published price${fresh.length === 1 ? "" : "s"} fall outside the safety net
                (below ${t.rate_critical_below_eur} EUR or above ${t.rate_max_sane_eur} EUR).
                Please review them in Revenue Management before they sell.
              </p>
              <table style="border-collapse:collapse;font-size:14px">
                <thead><tr>
                  <th align="left" style="padding:6px 10px;border-bottom:2px solid #ddd">Date</th>
                  <th align="left" style="padding:6px 10px;border-bottom:2px solid #ddd">Room type</th>
                  <th align="left" style="padding:6px 10px;border-bottom:2px solid #ddd">Occupancy</th>
                  <th align="left" style="padding:6px 10px;border-bottom:2px solid #ddd">Price</th>
                </tr></thead>
                <tbody>${list}</tbody>
              </table>
              ${fresh.length > 30 ? `<p style="color:#555">…and ${fresh.length - 30} more.</p>` : ""}
              <p style="margin-top:20px;font-size:12px;color:#888">Hotel Care · Revenue safety net</p>
            </div>`;

          try {
            const resend = new Resend(resendKey);
            await resend.emails.send({
              from: "Hotel Care <onboarding@resend.dev>",
              to: unique,
              subject: `⚠️ ${fresh.length} unusual rate${fresh.length === 1 ? "" : "s"} — ${h.hotel_id}`,
              html,
            });
            emailed = unique.length;
            const ids = (inserted ?? []).map((r: any) => r.id);
            if (ids.length > 0) {
              await admin.from("revenue_rate_alerts")
                .update({ notified_at: new Date().toISOString() }).in("id", ids);
            }
          } catch (e) {
            console.error("rate alert email failed", e);
          }
        }
      }

      summary.push({ hotel_id: h.hotel_id, found: fresh.length, emailed });
    }

    return json({ ok: true, summary });
  } catch (e) {
    console.error("revenue-rate-alerts error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
