// Inbound webhook: hotel websites POST restaurant (brunch) reservation events here.
// Headers: x-property (property slug), x-signature (hex HMAC-SHA256 of the raw body).
// Secret name is resolved per property from public.restaurant_webhook_sources.
//
// Times are interpreted as wall-clock in `payload.timezone` (default Europe/Budapest)
// and stored as real UTC, matching the sales dashboard's behaviour.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-property, x-signature",
};

const DEFAULT_TZ = "Europe/Budapest";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function tzOffsetMinutes(instant: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) parts[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour === "24" ? "00" : parts.hour), Number(parts.minute), Number(parts.second),
  );
  return (asUTC - instant.getTime()) / 60000;
}

function parseWallClockToUTC(input: string, tz: string): Date {
  const cleaned = String(input).trim().replace(/(?:Z|[+-]\d{2}:?\d{2})$/i, "");
  const m = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return new Date(input);
  const guessUTC = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], Number(m[6] ?? 0));
  if (tz.toUpperCase() === "UTC") return new Date(guessUTC);
  return new Date(guessUTC - tzOffsetMinutes(new Date(guessUTC), tz) * 60000);
}

// The service date is the local calendar day of the seating, not the UTC day.
function localDate(instant: Date, tz: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return dtf.format(instant);
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function logInbound(entry: {
  property_slug: string | null;
  outcome: string;
  http_status: number;
  message?: string | null;
  source_reservation_id?: string | null;
  payload?: unknown;
}) {
  try {
    await supabase.from("restaurant_webhook_log").insert({
      property_slug: entry.property_slug,
      outcome: entry.outcome,
      http_status: entry.http_status,
      message: entry.message ?? null,
      source_reservation_id: entry.source_reservation_id ?? null,
      payload: (entry.payload ?? null) as any,
    });
  } catch (err) {
    console.warn("restaurant_webhook_log insert failed", (err as Error).message);
  }
}

const STATUS_MAP: Record<string, string> = {
  new: "booked", pending: "booked", confirmed: "booked", booked: "booked",
  seated: "seated", arrived: "seated",
  completed: "completed", done: "completed", finished: "completed",
  no_show: "no_show", noshow: "no_show",
  cancelled: "cancelled", canceled: "cancelled",
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "method not allowed" });

  const slug = (req.headers.get("x-property") ?? "").toLowerCase().trim();
  const signature = (req.headers.get("x-signature") ?? "").trim();
  const raw = await req.text();

  if (!slug || !signature) {
    await logInbound({ property_slug: slug || null, outcome: "missing_headers", http_status: 400, message: "x-property or x-signature header missing", payload: raw.slice(0, 4000) });
    return reply(400, { error: "missing headers" });
  }

  const { data: source } = await supabase
    .from("restaurant_webhook_sources")
    .select("hotel_id, secret_name, outlet_slugs, is_active")
    .eq("property_slug", slug)
    .maybeSingle();

  if (!source || !source.is_active) {
    await logInbound({ property_slug: slug, outcome: "unknown_property", http_status: 404, message: `no active source for '${slug}'`, payload: raw.slice(0, 4000) });
    return reply(404, { error: "unknown property" });
  }

  const secret = Deno.env.get(source.secret_name);
  if (!secret) {
    await logInbound({ property_slug: slug, outcome: "secret_missing", http_status: 401, message: `secret ${source.secret_name} not configured` });
    return reply(401, { error: `secret ${source.secret_name} not configured` });
  }

  const expected = await hmacHex(secret, raw);
  if (!safeEqual(signature.toLowerCase(), expected)) {
    await logInbound({ property_slug: slug, outcome: "invalid_signature", http_status: 401, message: "HMAC mismatch — sender secret is out of sync", payload: raw.slice(0, 4000) });
    return reply(401, { error: "invalid signature" });
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    await logInbound({ property_slug: slug, outcome: "bad_json", http_status: 400, payload: raw.slice(0, 4000) });
    return reply(400, { error: "bad json" });
  }

  const sourceReservationId = String(payload.source_reservation_id ?? payload.id ?? "").trim();
  if (!sourceReservationId) {
    await logInbound({ property_slug: slug, outcome: "missing_id", http_status: 400, message: "source_reservation_id missing", payload });
    return reply(400, { error: "source_reservation_id required" });
  }

  // Only restaurant/brunch outlets belong on the breakfast board. Anything else
  // (museum, transfer) is acknowledged so the sender does not retry forever.
  const outletSlug = String(payload.outlet_slug ?? payload.outlet_name ?? "brunch").toLowerCase().trim();
  const allowed: string[] = source.outlet_slugs ?? ["brunch"];
  const isRestaurant = allowed.some((a) => outletSlug.includes(a));
  if (!isRestaurant) {
    await logInbound({ property_slug: slug, outcome: "ignored_outlet", http_status: 200, message: `outlet '${outletSlug}' is not a restaurant outlet`, source_reservation_id: sourceReservationId, payload });
    return reply(200, { ok: true, ignored: true, reason: "outlet not tracked" });
  }

  if (payload.action === "delete") {
    await supabase
      .from("restaurant_reservations")
      .update({ status: "cancelled" })
      .eq("hotel_id", source.hotel_id)
      .eq("source_project", slug)
      .eq("source_reservation_id", sourceReservationId);
    await logInbound({ property_slug: slug, outcome: "deleted", http_status: 200, source_reservation_id: sourceReservationId, payload });
    return reply(200, { ok: true, action: "cancelled" });
  }

  const tz = typeof payload.timezone === "string" && payload.timezone.trim() ? payload.timezone.trim() : DEFAULT_TZ;
  if (!payload.starts_at) {
    await logInbound({ property_slug: slug, outcome: "missing_starts_at", http_status: 400, source_reservation_id: sourceReservationId, payload });
    return reply(400, { error: "starts_at required" });
  }
  const starts = parseWallClockToUTC(String(payload.starts_at), tz);
  if (Number.isNaN(starts.getTime())) {
    await logInbound({ property_slug: slug, outcome: "bad_starts_at", http_status: 400, source_reservation_id: sourceReservationId, payload });
    return reply(400, { error: "starts_at unparseable" });
  }
  const ends = payload.ends_at ? parseWallClockToUTC(String(payload.ends_at), tz) : null;

  const row = {
    hotel_id: source.hotel_id,
    source_project: slug,
    source_reservation_id: sourceReservationId,
    outlet_slug: outletSlug,
    guest_name: String(payload.guest_name ?? "Guest"),
    guest_email: payload.guest_email ? String(payload.guest_email).toLowerCase() : null,
    guest_phone: payload.guest_phone ? String(payload.guest_phone) : null,
    party_size: Number(payload.party_size ?? 2) || 2,
    starts_at: starts.toISOString(),
    ends_at: ends && !Number.isNaN(ends.getTime()) ? ends.toISOString() : null,
    service_date: localDate(starts, tz),
    status: STATUS_MAP[String(payload.status ?? "").toLowerCase()] ?? "booked",
    occasion: payload.occasion ?? null,
    special_requests: payload.special_requests ?? null,
    notes: payload.notes ?? null,
    raw_payload: payload,
  };

  const { error } = await supabase
    .from("restaurant_reservations")
    .upsert(row, { onConflict: "hotel_id,source_project,source_reservation_id" });

  if (error) {
    console.error("restaurant reservation upsert failed", error.message);
    await logInbound({ property_slug: slug, outcome: "db_error", http_status: 500, message: error.message, source_reservation_id: sourceReservationId, payload });
    return reply(500, { error: error.message });
  }

  await logInbound({ property_slug: slug, outcome: "upserted", http_status: 200, source_reservation_id: sourceReservationId, payload });
  return reply(200, { ok: true, service_date: row.service_date });
});
