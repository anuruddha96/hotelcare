// Safety net for pricing mistakes.
//
// Scans every published nightly rate in the booking horizon against the
// hotel's own thresholds and emails admins + top management when a price
// looks like a human error (2 EUR instead of 200, or a fat-fingered 9000).
// Each (date × room type × occupancy × price) is only ever reported once.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { mailClient } from "../_shared/emailSender.ts";

const ALERT_ROLES = ["admin", "top_management", "top_management_manager"];
const HORIZON_DAYS = 120;
const SLNT_ADAPTIVE_MIN_SAMPLES = 30;
const RATE_PAGE_SIZE = 1000;

interface Thresholds {
  rate_warn_below_eur: number;
  rate_critical_below_eur: number;
  rate_max_sane_eur: number;
  rate_alert_emails_enabled: boolean;
}

interface CurrencySettings {
  base_currency: string;
  eur_conversion_rate: number | null;
}

interface EffectiveBounds {
  low: number;
  high: number;
  adaptive: boolean;
  sampleSize: number;
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

function rateKey(roomTypeName: unknown, occupancy: unknown) {
  return `${String(roomTypeName ?? "")}|${String(occupancy ?? "")}`;
}

function hasResolvedRoomType(roomTypeName: unknown): boolean {
  return typeof roomTypeName === "string" && roomTypeName.trim().length > 0;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  const weight = pos - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Supabase/PostgREST enforces a server-side maximum row count. Asking for a
 * very large `.limit()` does not guarantee that many rows are returned. SLNT
 * has thousands of rate rows in the 120-day horizon, so a single query could
 * contain only the earliest ~1,000 rows. That starved each room/occupancy key
 * below the 30-sample learning threshold and silently reverted to the static
 * portfolio floor. Fetch in deterministic 1,000-row pages so the adaptive
 * safety net always learns from the complete published curve.
 */
async function fetchPublishedRates(
  admin: any,
  hotelId: string,
  today: string,
  horizon: string,
): Promise<any[]> {
  const all: any[] = [];

  for (let from = 0; ; from += RATE_PAGE_SIZE) {
    const { data, error } = await admin
      .from("revenue_room_type_rates")
      .select("id, stay_date, room_type_name, occupancy, price")
      .eq("hotel_id", hotelId)
      .gte("stay_date", today)
      .lte("stay_date", horizon)
      .order("stay_date", { ascending: true })
      .order("room_type_name", { ascending: true })
      .order("occupancy", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + RATE_PAGE_SIZE - 1);

    if (error) throw error;
    const page = data ?? [];
    all.push(...page);
    if (page.length < RATE_PAGE_SIZE) break;
  }

  return all;
}

/**
 * SLNT is a portfolio made up of very different apartments, rooms and
 * pensions. A single portfolio-wide minimum therefore creates false alarms
 * for naturally lower-priced units such as WR Pension.
 *
 * Learn a conservative range separately for each room type + occupancy from
 * the current 120-day published curve. The configured hotel thresholds remain
 * hard guardrails: the adaptive floor can only move down (never below 45% of
 * the configured floor), and the adaptive ceiling can only move down from the
 * configured maximum. Robust percentiles keep one typo from teaching the
 * detector that the typo is normal.
 */
function buildSlntAdaptiveBounds(
  rates: any[],
  configuredLow: number,
  configuredHigh: number,
): Map<string, EffectiveBounds> {
  const grouped = new Map<string, number[]>();

  for (const r of rates) {
    const p = Number(r.price);
    if (!Number.isFinite(p) || p <= 0 || !hasResolvedRoomType(r.room_type_name)) continue;
    const key = rateKey(r.room_type_name, r.occupancy);
    const prices = grouped.get(key) ?? [];
    prices.push(p);
    grouped.set(key, prices);
  }

  const bounds = new Map<string, EffectiveBounds>();
  for (const [key, prices] of grouped.entries()) {
    if (prices.length < SLNT_ADAPTIVE_MIN_SAMPLES) continue;

    const sorted = [...prices].sort((a, b) => a - b);
    const p05 = percentile(sorted, 0.05);
    const median = percentile(sorted, 0.50);
    const p95 = percentile(sorted, 0.95);

    // A legitimate low season rate is usually represented repeatedly in the
    // lower tail. 70% of P05 / 55% of median gives it breathing room while a
    // misplaced zero or 10x-too-low amount still trips the safety net.
    const learnedLow = Math.max(p05 * 0.70, median * 0.55);
    const low = Math.max(
      configuredLow * 0.45,
      Math.min(configuredLow, learnedLow),
    );

    // Keep enough headroom for Budapest event / peak-date spikes. P95 and the
    // median are robust against a single huge typo, unlike the raw maximum.
    const learnedHigh = Math.max(
      configuredHigh * 0.45,
      median * 8,
      p95 * 5,
    );
    const high = Math.max(low, Math.min(configuredHigh, learnedHigh));

    bounds.set(key, {
      low,
      high,
      adaptive: true,
      sampleSize: prices.length,
    });
  }

  return bounds;
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
      .select("hotel_id, organization_slug, base_currency, eur_conversion_rate, rate_warn_below_eur, rate_critical_below_eur, rate_max_sane_eur, rate_alert_emails_enabled");

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
      const currency: CurrencySettings = {
        base_currency: String(h.base_currency ?? "EUR").toUpperCase(),
        eur_conversion_rate: Number(h.eur_conversion_rate) > 0 ? Number(h.eur_conversion_rate) : null,
      };
      // Alert settings are intentionally configured in EUR. Stored Previo
      // prices, however, are in the property's base currency (HUF for SLNT).
      // Convert the thresholds, never the authoritative prices.
      const thresholdScale = currency.base_currency === "EUR"
        ? 1
        : currency.eur_conversion_rate;
      if (!thresholdScale) {
        console.warn(`Skipping rate alerts for ${h.hotel_id}: no EUR conversion rate for ${currency.base_currency}`);
        summary.push({ hotel_id: h.hotel_id, found: 0, emailed: 0 });
        continue;
      }
      const criticalBelow = t.rate_critical_below_eur * thresholdScale;
      const maxSane = t.rate_max_sane_eur * thresholdScale;
      const currencyLabel = currency.base_currency === "HUF" ? "Ft" : currency.base_currency;

      const rates = await fetchPublishedRates(admin, h.hotel_id, today, horizon);

      const isSlnt = h.hotel_id === "slnt-group" ||
        String(h.organization_slug ?? "").toLowerCase() === "slnt";
      const adaptiveBounds = isSlnt
        ? buildSlntAdaptiveBounds(rates, criticalBelow, maxSane)
        : new Map<string, EffectiveBounds>();

      const evaluated = rates.map((r: any) => {
        const learned = adaptiveBounds.get(rateKey(r.room_type_name, r.occupancy));
        const bounds: EffectiveBounds = learned ?? {
          low: criticalBelow,
          high: maxSane,
          adaptive: false,
          sampleSize: 0,
        };
        return {
          ...r,
          _alertLow: bounds.low,
          _alertHigh: bounds.high,
          _adaptive: bounds.adaptive,
          _sampleSize: bounds.sampleSize,
        };
      });

      // A missing SLNT room type is an incomplete sync/mapping row, not a
      // sellable rate. Never reinterpret, repair or write a price here: keep
      // those rows out of pricing alerts and leave the authoritative SLNT rate
      // data and revenue settings completely untouched.
      const unresolvedSlntRows = isSlnt
        ? evaluated.filter((r: any) => !hasResolvedRoomType(r.room_type_name))
        : [];
      if (unresolvedSlntRows.length > 0) {
        console.warn(
          `SLNT rate safety: skipped ${unresolvedSlntRows.length} unresolved room-type row(s) from price alerts; no rates or settings were changed.`,
        );
      }

      const offenders = evaluated.filter((r: any) => {
        if (isSlnt && !hasResolvedRoomType(r.room_type_name)) return false;
        const p = Number(r.price);
        if (!Number.isFinite(p)) return false;
        return p <= 0 || p < r._alertLow || p > r._alertHigh;
      });

      if (offenders.length === 0) {
        summary.push({ hotel_id: h.hotel_id, found: 0, emailed: 0 });
        continue;
      }

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
      if (fresh.length === 0) {
        summary.push({ hotel_id: h.hotel_id, found: 0, emailed: 0 });
        continue;
      }

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
          const rangeHeader = isSlnt
            ? `<th align="left" style="padding:6px 10px;border-bottom:2px solid #ddd">Safety range</th>`
            : "";
          const list = fresh.slice(0, 30).map((r: any) => {
            const rangeCell = isSlnt
              ? `<td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap">${Math.round(r._alertLow).toLocaleString("en-US")}–${Math.round(r._alertHigh).toLocaleString("en-US")} ${currencyLabel}</td>`
              : "";
            return `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${r.stay_date}</td>` +
              `<td style="padding:6px 10px;border-bottom:1px solid #eee">${r.room_type_name}</td>` +
              `<td style="padding:6px 10px;border-bottom:1px solid #eee">${r.occupancy} guest(s)</td>` +
              `<td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${Number(r.price).toLocaleString("en-US", { maximumFractionDigits: 0 })} ${currencyLabel}</td>` +
              `${rangeCell}</tr>`;
          }).join("");

          const thresholdText = isSlnt
            ? `SLNT uses an adaptive safety net calculated separately for each room type and occupancy from the complete current ${HORIZON_DAYS}-day published rate curve. The configured portfolio limits remain hard guardrails.`
            : `The safety net is below ${Math.round(criticalBelow).toLocaleString("en-US")} ${currencyLabel} or above ${Math.round(maxSane).toLocaleString("en-US")} ${currencyLabel}.`;

          const html = `
            <div style="font-family:Arial,Helvetica,sans-serif;color:#111">
              <h2 style="margin:0 0 8px">Unusual rates detected — ${h.hotel_id}</h2>
              <p style="margin:0 0 16px;color:#555">
                ${fresh.length} published price${fresh.length === 1 ? "" : "s"} fall outside the safety net. ${thresholdText}
                Please review them in Revenue Management before they sell.
              </p>
              <table style="border-collapse:collapse;font-size:14px">
                <thead><tr>
                  <th align="left" style="padding:6px 10px;border-bottom:2px solid #ddd">Date</th>
                  <th align="left" style="padding:6px 10px;border-bottom:2px solid #ddd">Room type</th>
                  <th align="left" style="padding:6px 10px;border-bottom:2px solid #ddd">Occupancy</th>
                  <th align="left" style="padding:6px 10px;border-bottom:2px solid #ddd">Price</th>
                  ${rangeHeader}
                </tr></thead>
                <tbody>${list}</tbody>
              </table>
              ${fresh.length > 30 ? `<p style="color:#555">…and ${fresh.length - 30} more.</p>` : ""}
              <p style="margin-top:20px;font-size:12px;color:#888">Hotel Care · Revenue safety net</p>
            </div>`;

          try {
            const resend = mailClient();
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
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
