// Mirrors restaurant/brunch reservations for one hotel + service date from the
// Sales Dashboard - RD Hotels project into public.restaurant_reservations.
// Shared by restaurant-reservations-sync and restaurant-reservations-list.

import { budapestDate, budapestDayRange, dashboardConfig, isRestaurantOutlet } from "./salesDashboard.ts";

interface DashboardReservation {
  id: string;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  party_size: number;
  starts_at: string;
  ends_at: string | null;
  status: string;
  occasion: string | null;
  special_requests: string | null;
  notes: string | null;
  source_project: string | null;
  source_reservation_id: string | null;
  updated_at: string | null;
  outlets: { slug: string | null } | null;
}

export interface SyncResult {
  synced: number;
  skipped: number;
  property: string | null;
  error?: string;
}

function dashboardHeaders(key: string, extra: Record<string, string> = {}): Record<string, string> {
  // Supabase's modern sb_secret_* keys belong in the apikey header. They are
  // not JWTs and must not be sent as `Authorization: Bearer ...`, otherwise
  // the API gateway rejects the request with 401. Keep Authorization only for
  // legacy JWT service_role keys so existing deployments remain compatible.
  const headers: Record<string, string> = { apikey: key, ...extra };
  const looksLikeJwt = key.split(".").length === 3;
  if (looksLikeJwt) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readDirectDashboard(
  propertySlug: string,
  serviceDate: string,
): Promise<{ rows?: DashboardReservation[]; error?: string }> {
  const cfg = dashboardConfig();
  if (!cfg) return { error: "Sales Dashboard direct credentials are not configured" };

  const { start, end } = budapestDayRange(serviceDate);
  const params = new URLSearchParams({
    select:
      "id,guest_name,guest_email,guest_phone,party_size,starts_at,ends_at,status,occasion,special_requests,notes,source_project,source_reservation_id,updated_at,outlets(slug),properties!inner(slug)",
    "properties.slug": `eq.${propertySlug}`,
    starts_at: `gte.${start.toISOString()}`,
    order: "starts_at.asc",
    limit: "500",
  });
  params.append("starts_at", `lt.${end.toISOString()}`);

  try {
    const res = await fetch(`${cfg.url}/rest/v1/reservations?${params.toString()}`, {
      headers: dashboardHeaders(cfg.key, { Accept: "application/json" }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`Sales Dashboard direct read failed [${res.status}]: ${body.slice(0, 400)}`);
      return { error: `direct dashboard responded ${res.status}` };
    }
    return { rows: (await res.json()) as DashboardReservation[] };
  } catch (error) {
    console.error("Sales Dashboard direct read threw", error);
    return { error: "direct dashboard request failed" };
  }
}

async function readSignedDashboard(
  propertySlug: string,
  serviceDate: string,
  secretName: string | null | undefined,
): Promise<{ rows?: DashboardReservation[]; error?: string }> {
  if (!secretName) return { error: "signed dashboard secret mapping is missing" };
  const secret = Deno.env.get(secretName);
  if (!secret) return { error: `signed dashboard secret ${secretName} is not configured` };

  const timestamp = String(Math.floor(Date.now() / 1000));
  const canonical = `hotelcare-read\n${propertySlug}\n${serviceDate}\n${timestamp}`;
  const signature = await hmacSha256Hex(secret, canonical);
  const appUrl = (Deno.env.get("SALES_DASHBOARD_APP_URL") || "https://sales.rdhotels.hu").replace(/\/+$/, "");
  // Use an already-registered TanStack API route. A newly-added standalone
  // route was not present in the generated production route tree and was being
  // treated as an HTML page, causing the BB fallback to fail with HTTP 500.
  const endpoint = `${appUrl}/api/public/webhooks/reservation-test?date=${encodeURIComponent(serviceDate)}`;

  try {
    const res = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        "x-property": propertySlug,
        "x-timestamp": timestamp,
        "x-signature": signature,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`Sales Dashboard signed read failed [${res.status}]: ${body.slice(0, 400)}`);
      return { error: `signed dashboard responded ${res.status}` };
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) return { error: "signed dashboard returned an invalid response" };
    return { rows: rows as DashboardReservation[] };
  } catch (error) {
    console.error("Sales Dashboard signed read threw", error);
    return { error: "signed dashboard request failed" };
  }
}

export async function syncHotelReservations(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  hotelId: string,
  serviceDate: string,
): Promise<SyncResult> {
  const { data: source } = await supabase
    .from("restaurant_webhook_sources")
    .select("property_slug, hotel_id, secret_name")
    .eq("hotel_id", hotelId)
    .eq("is_active", true)
    .maybeSingle();

  if (!source) {
    return { synced: 0, skipped: 0, property: null, error: "Hotel is not mapped to a Sales Dashboard property" };
  }

  // Keep the existing direct Supabase read as the fast path. If that credential
  // is stale/rotated (the current production failure is a 401), use the signed
  // Sales Dashboard application endpoint instead of falsely reporting zero.
  const direct = await readDirectDashboard(source.property_slug, serviceDate);
  let rows = direct.rows;
  let signedError: string | undefined;

  if (!rows) {
    const signed = await readSignedDashboard(source.property_slug, serviceDate, source.secret_name);
    rows = signed.rows;
    signedError = signed.error;
  }

  if (!rows) {
    return {
      synced: 0,
      skipped: 0,
      property: source.property_slug,
      error: [direct.error, signedError].filter(Boolean).join("; ") || "Sales Dashboard reservation read failed",
    };
  }

  const relevant = rows.filter((r) => isRestaurantOutlet(r.outlets?.slug));

  // Existing local rows, so a staff mark is never overwritten by a stale
  // "booked" coming back from the dashboard.
  const { data: existing } = await supabase
    .from("restaurant_reservations")
    .select("source_reservation_id, status, status_marked_at")
    .eq("hotel_id", hotelId)
    .eq("service_date", serviceDate);
  // deno-lint-ignore no-explicit-any
  const localByRef = new Map((existing ?? []).map((r: any) => [String(r.source_reservation_id), r]));

  const payload = relevant.map((r) => {
    const ref = r.source_reservation_id || `sd:${r.id}`;
    // deno-lint-ignore no-explicit-any
    const local = localByRef.get(ref) as any;
    const dashboardUpdated = r.updated_at ? new Date(r.updated_at).getTime() : 0;
    const markedAt = local?.status_marked_at ? new Date(local.status_marked_at).getTime() : 0;
    const keepLocal = Boolean(local) && markedAt > dashboardUpdated && r.status !== "cancelled";
    return {
      hotel_id: hotelId,
      source_project: source.property_slug,
      source_reservation_id: ref,
      outlet_slug: r.outlets?.slug || "brunch",
      guest_name: r.guest_name,
      guest_email: r.guest_email,
      guest_phone: r.guest_phone,
      party_size: r.party_size ?? 2,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      service_date: budapestDate(r.starts_at),
      status: keepLocal ? local.status : r.status,
      occasion: r.occasion,
      special_requests: r.special_requests,
      notes: r.notes,
      raw_payload: { dashboard_id: r.id, dashboard_status: r.status, synced_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    };
  });

  if (payload.length) {
    const { error } = await supabase
      .from("restaurant_reservations")
      .upsert(payload, { onConflict: "hotel_id,source_project,source_reservation_id" });
    if (error) {
      console.error("restaurant_reservations upsert failed", error.message);
      return { synced: 0, skipped: rows.length - relevant.length, property: source.property_slug, error: error.message };
    }
  }

  return { synced: payload.length, skipped: rows.length - relevant.length, property: source.property_slug };
}

/** Push a status change back to the Sales Dashboard reservation row. */
export async function pushStatusToDashboard(
  dashboardId: string,
  status: string,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = dashboardConfig();
  if (!cfg) return { ok: false, error: "Sales Dashboard credentials are not configured" };
  const res = await fetch(`${cfg.url}/rest/v1/reservations?id=eq.${encodeURIComponent(dashboardId)}`, {
    method: "PATCH",
    headers: dashboardHeaders(cfg.key, {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    }),
    body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `Dashboard responded ${res.status}: ${body.slice(0, 300)}` };
  }
  return { ok: true };
}
