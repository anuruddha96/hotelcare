/**
 * pci-cards — Channex card / VCC access through PCI Booking, keeping
 * HotelCare out of PCI scope.
 *
 * How compliance is preserved:
 *  - Channex's secure domain is NEVER called directly (its response carries
 *    plain card data). The capture call goes to PCI Booking's "tokenization
 *    on response" proxy, which fetches the Channex booking, swaps the card
 *    for a token, and hands us only the tokenized body + token URI header.
 *  - Card details are displayed in PCI Booking's hosted iframe in the
 *    receptionist's browser; this server only mints the 5-minute session
 *    token for it. PAN/CVV never touch HotelCare servers, DB or logs.
 *  - Every display is written to pci_card_views.
 *
 * Secrets: PCIBOOKING_API_KEY (required), PCIBOOKING_PROFILE (target profile
 * name configured in the PCI Booking portal; default "channex"),
 * CHANNEX_SECURE_BASE (default staging), HOTELCARE_CHANNEX_API (existing).
 *
 * Actions (POST, JWT):
 *   status  { hotel_id, reservation_id }   VIEW    configured? + stored tokens
 *   capture { hotel_id, reservation_id }   MANAGE  fetch + tokenize the booking's card
 *   view    { hotel_id, token_id }         VIEW*   mint display URL (logged)
 *     (*view is allowed to reception roles; the iframe is the only place the
 *      card becomes visible, in the user's own browser.)
 */
import { authorizeHotelCaller, hasRole, json, MANAGE_ROLES, serviceDb, VIEW_ROLES, type Caller } from "../_shared/channex/http.ts";

const PCIB = "https://service.pcibooking.net/api/payments/paycard";
const VIEW_CARD_ROLES = [...MANAGE_ROLES, "reception_manager", "reception", "front_office"];

// deno-lint-ignore no-explicit-any
type Db = any;

function env(name: string, fallback = ""): string {
  return Deno.env.get(name) ?? fallback;
}
function channexApiKey(): string {
  return env("HOTELCARE_CHANNEX_API") || env("CHANNEX_STAGING_API_KEY");
}

class UserError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

async function loadReservation(db: Db, hotelId: string, reservationId: string) {
  const { data, error } = await db.from("reservations")
    .select("id, hotel_id, channex_booking_id, source")
    .eq("id", reservationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.hotel_id !== hotelId) throw new UserError("Reservation not found on this hotel", 404);
  return data as { id: string; hotel_id: string; channex_booking_id: string | null };
}

/** 5-minute PCI Booking session token (the API key never leaves the server). */
async function tempSession(apiKey: string): Promise<string> {
  const res = await fetch(`${PCIB}/tempsession`, { method: "POST", headers: { Authorization: `APIKEY ${apiKey}` } });
  if (res.status !== 200) throw new UserError(`PCI Booking session failed (HTTP ${res.status})`, 502);
  return (await res.text()).trim();
}

/**
 * Fetch the Channex booking THROUGH PCI Booking so the card is tokenized in
 * transit, using PCI Booking's preset Channex profile (the target URL lives
 * in the profile; the booking id fills its :id path segment).
 * Presets on this account: ChannexStagingSecure (staging), Channex (production).
 */
async function captureCard(bookingId: string) {
  const apiKey = env("PCIBOOKING_API_KEY");
  if (!apiKey) throw new UserError("PCI Booking is not configured yet (PCIBOOKING_API_KEY secret missing).", 409);
  const channexKey = channexApiKey();
  if (!channexKey) throw new UserError("Channex API key is not configured.", 409);
  const profile = env("PCIBOOKING_PROFILE", "channex");
  const secureBase = env("CHANNEX_SECURE_BASE", "https://secure-staging.channex.io");
  const passThrough = { "user-api-key": channexKey, Accept: "application/json" };

  // Strategy 1: generic capture proxy (API-key auth) pointing the preset
  // profile at the booking URL explicitly.
  let res = await fetch(`${PCIB}/capture?${new URLSearchParams({
    profileName: profile,
    targetURI: `${secureBase}/api/v1/bookings/${encodeURIComponent(bookingId)}`,
    httpMethod: "GET",
    timeout: "25",
    ref: `channex-${bookingId}`,
  })}`, { method: "POST", headers: { "x-pcibooking-api-key": apiKey, ...passThrough } });

  // Strategy 2: preset-profile route (session-token auth; target URL comes
  // from the profile, booking id fills its :id segment).
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    const firstStatus = res.status;
    const firstBody = (await res.text()).slice(0, 150);
    const sessionToken = await tempSession(apiKey);
    res = await fetch(`https://service.pcibooking.net/api/booker/${encodeURIComponent(profile)}/reservation?${new URLSearchParams({
      sessionToken,
      pathSegments: `id=${bookingId}`,
      ref: `channex-${bookingId}`,
    })}`, { method: "POST", headers: passThrough });
    if (res.status !== 200) {
      const secondBody = (await res.text()).slice(0, 150);
      throw new UserError(`PCI capture failed: capture route HTTP ${firstStatus} (${firstBody || "no body"}); preset route HTTP ${res.status} (${secondBody || "no body"})`, 502);
    }
  }
  const tokenHeader = res.headers.get("X-token") ?? res.headers.get("X-pciBooking-cardUri") ?? "";
  const tokenizationError = res.headers.get("X-pciBooking-Tokenization-Errors");
  if (res.status !== 200) {
    const text = (await res.text()).slice(0, 200);
    throw new UserError(`Channex/PCI fetch failed (HTTP ${res.status}): ${text || "no body"}`, 502);
  }
  // Body is already tokenized: safe to inspect for a masked label only.
  let masked: string | null = null;
  let cardType: string | null = null;
  try {
    const body = await res.json();
    const guarantee = body?.data?.attributes?.guarantee ?? body?.attributes?.guarantee ?? null;
    if (guarantee) {
      masked = typeof guarantee.card_number === "string" ? String(guarantee.card_number).slice(0, 40) : null;
      cardType = typeof guarantee.card_type === "string" ? String(guarantee.card_type).slice(0, 30) : null;
    }
  } catch (_) { /* masked label is best-effort */ }
  if (!tokenHeader) {
    throw new UserError(tokenizationError === "No cards found in response content"
      ? "This booking carries no card / virtual card."
      : `No card token returned${tokenizationError ? `: ${tokenizationError}` : ""}.`, 404);
  }
  const first = tokenHeader.split(";")[0].trim();
  return { tokenUri: first, masked, cardType };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  try {
    const payload = await req.json().catch(() => ({}));
    const action = String(payload.action ?? "status");
    const hotelId = String(payload.hotel_id ?? "");
    if (!hotelId) return json({ ok: false, error: "hotel_id is required" }, 400);
    const db = serviceDb();
    const callerOr = await authorizeHotelCaller(req, db, hotelId);
    if (callerOr instanceof Response) return callerOr;
    const caller = callerOr as Caller;
    if (!hasRole(caller, VIEW_ROLES)) return json({ ok: false, error: "Forbidden" }, 403);

    switch (action) {
      case "status": {
        const reservationId = String(payload.reservation_id ?? "");
        let tokens: unknown[] = [];
        let bookingId: string | null = null;
        if (reservationId) {
          const r = await loadReservation(db, hotelId, reservationId);
          bookingId = r.channex_booking_id;
          const { data } = await db.from("pci_card_tokens")
            .select("id, masked_label, card_type, created_at")
            .eq("hotel_id", hotelId).eq("reservation_id", reservationId)
            .order("created_at", { ascending: false });
          tokens = data ?? [];
        }
        return json({
          ok: true,
          configured: !!env("PCIBOOKING_API_KEY"),
          channex_booking_id: bookingId,
          can_capture: hasRole(caller, MANAGE_ROLES),
          can_view: hasRole(caller, VIEW_CARD_ROLES),
          tokens,
        });
      }

      case "capture": {
        if (!hasRole(caller, MANAGE_ROLES)) return json({ ok: false, error: "Forbidden" }, 403);
        const r = await loadReservation(db, hotelId, String(payload.reservation_id ?? ""));
        if (!r.channex_booking_id) throw new UserError("This reservation has no Channex booking id (not an OTA booking).", 409);
        const { data: existing } = await db.from("pci_card_tokens")
          .select("id, masked_label, card_type").eq("channex_booking_id", r.channex_booking_id).maybeSingle();
        if (existing) return json({ ok: true, token: existing, already: true });
        const captured = await captureCard(r.channex_booking_id);
        const { data: row, error } = await db.from("pci_card_tokens").insert({
          hotel_id: hotelId, reservation_id: r.id, channex_booking_id: r.channex_booking_id,
          card_token_uri: captured.tokenUri, masked_label: captured.masked, card_type: captured.cardType,
          created_by: caller.userId,
        }).select("id, masked_label, card_type").single();
        if (error) throw new Error(error.message);
        return json({ ok: true, token: row });
      }

      case "view": {
        if (!hasRole(caller, VIEW_CARD_ROLES)) return json({ ok: false, error: "Forbidden" }, 403);
        const apiKey = env("PCIBOOKING_API_KEY");
        if (!apiKey) throw new UserError("PCI Booking is not configured yet.", 409);
        const { data: token } = await db.from("pci_card_tokens")
          .select("id, hotel_id, card_token_uri").eq("id", String(payload.token_id ?? "")).maybeSingle();
        if (!token || token.hotel_id !== hotelId) throw new UserError("Card token not found", 404);
        // 5-minute session token so the browser can load PCI Booking's iframe.
        const sessionToken = await tempSession(apiKey);
        const cardToken = token.card_token_uri.split("/").filter(Boolean).pop() ?? "";
        const display = new URLSearchParams({ sessionToken, language: "en", formatCardNumber: "true" });
        await db.from("pci_card_views").insert({ card_token_id: token.id, hotel_id: hotelId, viewed_by: caller.userId });
        return json({ ok: true, display_url: `${PCIB}/${encodeURIComponent(cardToken)}/display?${display}`, expires_in_seconds: 300 });
      }

      case "diagnose": {
        // Managers only: verify the PCI Booking account and list the preset
        // tokenization profiles, so the right Channex profile can be chosen.
        if (!hasRole(caller, MANAGE_ROLES)) return json({ ok: false, error: "Forbidden" }, 403);
        const apiKey = env("PCIBOOKING_API_KEY");
        if (!apiKey) return json({ ok: true, configured: false });
        const res = await fetch("https://service.pcibooking.net/api/booker", {
          headers: { Authorization: `APIKEY ${apiKey}`, Accept: "application/json" },
        });
        const text = await res.text();
        let profiles: unknown = null;
        try { profiles = JSON.parse(text); } catch { profiles = text.slice(0, 1500); }
        return json({ ok: true, configured: true, http: res.status, profiles });
      }

      case "probe": {
        // Temporary sandbox probe: which auth the preset booker route accepts.
        if (!hasRole(caller, MANAGE_ROLES)) return json({ ok: false, error: "Forbidden" }, 403);
        const apiKey = env("PCIBOOKING_API_KEY");
        const channexKey = channexApiKey();
        const bookingId = String(payload.booking_id ?? "");
        const base = `https://service.pcibooking.net/api/booker/ChannexStagingSecure/reservation`;
        const sessionToken = await tempSession(apiKey);
        const attempts: Record<string, unknown> = { sessionTokenLength: sessionToken.length };
        const tryOne = async (label: string, url: string, headers: Record<string, string>) => {
          const r = await fetch(url, { method: "POST", headers });
          attempts[label] = { status: r.status, body: (await r.text()).slice(0, 120), cardUri: r.headers.get("X-pciBooking-cardUri") ? "yes" : null, tokErr: r.headers.get("X-pciBooking-Tokenization-Errors") };
        };
        await tryOne("session_query", `${base}?${new URLSearchParams({ sessionToken, pathSegments: `id=${bookingId}` })}`, { "user-api-key": channexKey, Accept: "application/json" });
        await tryOne("apikey_header", `${base}?${new URLSearchParams({ pathSegments: `id=${bookingId}` })}`, { "x-pcibooking-api-key": apiKey, "user-api-key": channexKey, Accept: "application/json" });
        await tryOne("apikey_auth", `${base}?${new URLSearchParams({ pathSegments: `id=${bookingId}` })}`, { Authorization: `APIKEY ${apiKey}`, "x-pcibooking-thirdparty-user-api-key": channexKey, "user-api-key": channexKey, Accept: "application/json" });
        return json({ ok: true, attempts });
      }

      default:
        return json({ ok: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    if (e instanceof UserError) return json({ ok: false, error: e.message }, e.status);
    console.error("pci-cards error", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Internal error" }, 500);
  }
});
