/**
 * booking-engine — public API behind the HotelCare website booking engine.
 *
 * Guests are anonymous (verify_jwt = false). Every rule that matters lives in
 * SQL (booking_engine_* functions, service role only): the booking window,
 * prices, restrictions, availability (with a per-hotel lock) and the native-PMS
 * gate. This function adds input validation, per-IP rate limits, bot checks,
 * the guest's manage-link token and the confirmation e-mails.
 *
 * Actions (POST JSON {action, id, ...}):
 *   config   {id}                                   hotel, rooms, rate plans, policies
 *   calendar {id, from, to}                         lowest nightly price per day
 *   search   {id, check_in, check_out}              offers with price + blocking rule
 *   book     {id, check_in, check_out, rooms[], guest{}, language, consent{}, attribution{}, hp, elapsed_ms}
 *   lookup   {id, reference, token}                 the guest's own booking
 *   cancel   {id, reference, token}                 free cancellation, if still allowed
 *
 * The manage token is random, sent only to the guest, and stored as a SHA-256
 * hash. No card data is ever requested: phase 1 bookings are paid at the hotel.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from "../_shared/emailSender.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const APP_URL = (Deno.env.get("HOTELCARE_APP_URL") || "https://my.hotelcare.app").replace(/\/+$/, "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PUBLIC_ID = /^[a-z0-9]{6,32}$/;
const REFERENCE = /^W[0-9A-F]{7}$/i;
const TOKEN = /^[A-Za-z0-9_-]{20,80}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const LANGS = ["en", "hu", "de", "es", "it", "fr"] as const;
type Lang = typeof LANGS[number];
const LOCALES: Record<Lang, string> = { en: "en-GB", hu: "hu-HU", de: "de-DE", es: "es-ES", it: "it-IT", fr: "fr-FR" };

const KNOWN_ERRORS: Record<string, number> = {
  ENGINE_UNAVAILABLE: 409, INVALID_DATES: 400, TOO_SOON: 400, TOO_FAR: 400, TOO_LONG: 400,
  INVALID_ROOMS: 400, INVALID_GUEST: 400, CONSENT_REQUIRED: 400, INVALID_TOKEN: 400,
  INVALID_OCCUPANCY: 400, SOLD_OUT: 409, RESTRICTED: 409, RATE_UNAVAILABLE: 409,
  NOT_FOUND: 404, NOT_CANCELLABLE: 409,
};

class ApiError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}

function serviceDb(): Db {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Maps "SOLD_OUT" (raised in SQL) to a clean API error; anything else is a server error. */
function dbError(error: { message?: string } | null | undefined): ApiError {
  const message = String(error?.message ?? "");
  const code = Object.keys(KNOWN_ERRORS).find((key) => message.includes(key));
  if (code) return new ApiError(code, KNOWN_ERRORS[code]);
  console.error("booking-engine db error:", message);
  return new ApiError("SERVER_ERROR", 500);
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(key: string, input: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(input));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(bytes = 24): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function clientIp(req: Request): string {
  return (req.headers.get("cf-connecting-ip")
    || req.headers.get("x-forwarded-for")?.split(",")[0]
    || req.headers.get("x-real-ip")
    || "unknown").trim();
}

/** True when the caller is over the limit. A failing counter never blocks guests. */
async function overLimit(db: Db, bucket: string, windowSeconds: number, limit: number): Promise<boolean> {
  const { data, error } = await db.rpc("booking_engine_hit", { p_bucket: bucket, p_window_seconds: windowSeconds, p_limit: limit });
  if (error) { console.error("rate limit check failed:", error.message); return false; }
  return data === false;
}

const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const int = (value: unknown) => (typeof value === "number" && Number.isInteger(value) ? value : NaN);
const lang = (value: unknown): Lang => (LANGS as readonly string[]).includes(String(value)) ? value as Lang : "en";

function requireId(body: Json): string {
  const id = str(body.id, 40).toLowerCase();
  if (!PUBLIC_ID.test(id)) throw new ApiError("NOT_FOUND", 404);
  return id;
}

function requireDates(body: Json): { checkIn: string; checkOut: string } {
  const checkIn = str(body.check_in, 10);
  const checkOut = str(body.check_out, 10);
  if (!DATE.test(checkIn) || !DATE.test(checkOut) || checkOut <= checkIn) throw new ApiError("INVALID_DATES");
  return { checkIn, checkOut };
}

const ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "gbraid", "wbraid", "fbclid", "msclkid", "referrer"];
function cleanAttribution(value: unknown): Json {
  const out: Json = {};
  if (!value || typeof value !== "object") return out;
  for (const key of ATTRIBUTION_KEYS) {
    const v = str((value as Json)[key], 200);
    if (!v) continue;
    if (key === "referrer") {
      try { out.referrer = new URL(v).host.slice(0, 120); } catch { /* keep nothing */ }
    } else out[key] = v;
  }
  return out;
}

// ------------------------------------------------------------------ e-mails
const MEALS: Record<string, Record<Lang, string>> = {
  room_only: { en: "Room only", hu: "Csak szállás", de: "Nur Übernachtung", es: "Solo alojamiento", it: "Solo pernottamento", fr: "Hébergement seul" },
  breakfast: { en: "Breakfast included", hu: "Reggelivel", de: "Frühstück inklusive", es: "Desayuno incluido", it: "Colazione inclusa", fr: "Petit-déjeuner inclus" },
  half_board: { en: "Half board", hu: "Félpanzió", de: "Halbpension", es: "Media pensión", it: "Mezza pensione", fr: "Demi-pension" },
  full_board: { en: "Full board", hu: "Teljes panzió", de: "Vollpension", es: "Pensión completa", it: "Pensione completa", fr: "Pension complète" },
  all_inclusive: { en: "All inclusive", hu: "All inclusive", de: "All inclusive", es: "Todo incluido", it: "All inclusive", fr: "Tout compris" },
};

const MAIL: Record<Lang, Record<string, string>> = {
  en: {
    subject: "Booking confirmed – {hotel} – {ref}", dear: "Dear {name},",
    intro: "Thank you for booking directly with {hotel}. Your booking is confirmed.",
    ref: "Booking reference", checkIn: "Check-in", checkOut: "Check-out", nights: "Nights", room: "Room", guests: "Guests",
    adults: "adults", children: "children", total: "Total", payment: "Payment", payAtHotel: "Payable at the hotel",
    cancellation: "Cancellation", freeUntil: "Free cancellation until {date}", nonRefundable: "Non-refundable",
    from: "from {time}", until: "until {time}", manage: "View or cancel your booking", closing: "We look forward to welcoming you.",
    contact: "Questions? Contact the hotel:", cancelledSubject: "Booking cancelled – {hotel} – {ref}",
    cancelledIntro: "Your booking {ref} has been cancelled. No further action is needed.",
  },
  hu: {
    subject: "Foglalás visszaigazolva – {hotel} – {ref}", dear: "Kedves {name}!",
    intro: "Köszönjük, hogy közvetlenül a(z) {hotel} szállodánál foglalt. A foglalását visszaigazoltuk.",
    ref: "Foglalási szám", checkIn: "Érkezés", checkOut: "Távozás", nights: "Éjszakák", room: "Szoba", guests: "Vendégek",
    adults: "felnőtt", children: "gyermek", total: "Összesen", payment: "Fizetés", payAtHotel: "A szállodában fizetendő",
    cancellation: "Lemondás", freeUntil: "Ingyenes lemondás eddig: {date}", nonRefundable: "Nem visszatéríthető",
    from: "{time} órától", until: "{time} óráig", manage: "Foglalás megtekintése vagy lemondása", closing: "Szeretettel várjuk!",
    contact: "Kérdése van? Keresse a szállodát:", cancelledSubject: "Foglalás lemondva – {hotel} – {ref}",
    cancelledIntro: "A(z) {ref} foglalását lemondtuk. További teendője nincs.",
  },
  de: {
    subject: "Buchung bestätigt – {hotel} – {ref}", dear: "Liebe/r {name},",
    intro: "Vielen Dank für Ihre Direktbuchung im {hotel}. Ihre Buchung ist bestätigt.",
    ref: "Buchungsnummer", checkIn: "Anreise", checkOut: "Abreise", nights: "Nächte", room: "Zimmer", guests: "Gäste",
    adults: "Erwachsene", children: "Kinder", total: "Gesamt", payment: "Zahlung", payAtHotel: "Zahlung im Hotel",
    cancellation: "Stornierung", freeUntil: "Kostenlose Stornierung bis {date}", nonRefundable: "Nicht erstattbar",
    from: "ab {time}", until: "bis {time}", manage: "Buchung ansehen oder stornieren", closing: "Wir freuen uns auf Ihren Besuch.",
    contact: "Fragen? Kontaktieren Sie das Hotel:", cancelledSubject: "Buchung storniert – {hotel} – {ref}",
    cancelledIntro: "Ihre Buchung {ref} wurde storniert. Sie müssen nichts weiter tun.",
  },
  es: {
    subject: "Reserva confirmada – {hotel} – {ref}", dear: "Estimado/a {name}:",
    intro: "Gracias por reservar directamente con {hotel}. Su reserva está confirmada.",
    ref: "Número de reserva", checkIn: "Llegada", checkOut: "Salida", nights: "Noches", room: "Habitación", guests: "Huéspedes",
    adults: "adultos", children: "niños", total: "Total", payment: "Pago", payAtHotel: "Pago en el hotel",
    cancellation: "Cancelación", freeUntil: "Cancelación gratuita hasta el {date}", nonRefundable: "No reembolsable",
    from: "desde las {time}", until: "hasta las {time}", manage: "Ver o cancelar su reserva", closing: "Esperamos darle la bienvenida.",
    contact: "¿Preguntas? Contacte con el hotel:", cancelledSubject: "Reserva cancelada – {hotel} – {ref}",
    cancelledIntro: "Su reserva {ref} ha sido cancelada. No necesita hacer nada más.",
  },
  it: {
    subject: "Prenotazione confermata – {hotel} – {ref}", dear: "Gentile {name},",
    intro: "Grazie per aver prenotato direttamente con {hotel}. La sua prenotazione è confermata.",
    ref: "Numero di prenotazione", checkIn: "Arrivo", checkOut: "Partenza", nights: "Notti", room: "Camera", guests: "Ospiti",
    adults: "adulti", children: "bambini", total: "Totale", payment: "Pagamento", payAtHotel: "Pagamento in hotel",
    cancellation: "Cancellazione", freeUntil: "Cancellazione gratuita fino al {date}", nonRefundable: "Non rimborsabile",
    from: "dalle {time}", until: "entro le {time}", manage: "Visualizza o cancella la prenotazione", closing: "Non vediamo l'ora di darle il benvenuto.",
    contact: "Domande? Contatti l'hotel:", cancelledSubject: "Prenotazione cancellata – {hotel} – {ref}",
    cancelledIntro: "La sua prenotazione {ref} è stata cancellata. Non deve fare altro.",
  },
  fr: {
    subject: "Réservation confirmée – {hotel} – {ref}", dear: "Bonjour {name},",
    intro: "Merci d'avoir réservé directement auprès de {hotel}. Votre réservation est confirmée.",
    ref: "Numéro de réservation", checkIn: "Arrivée", checkOut: "Départ", nights: "Nuits", room: "Chambre", guests: "Voyageurs",
    adults: "adultes", children: "enfants", total: "Total", payment: "Paiement", payAtHotel: "Paiement à l'hôtel",
    cancellation: "Annulation", freeUntil: "Annulation gratuite jusqu'au {date}", nonRefundable: "Non remboursable",
    from: "à partir de {time}", until: "avant {time}", manage: "Voir ou annuler votre réservation", closing: "Au plaisir de vous accueillir.",
    contact: "Des questions ? Contactez l'hôtel :", cancelledSubject: "Réservation annulée – {hotel} – {ref}",
    cancelledIntro: "Votre réservation {ref} a été annulée. Aucune autre action n'est nécessaire.",
  },
};

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
const safeColor = (value: unknown) => (/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : "#8a6a3d");

function money(amount: number, currency: string, l: Lang) {
  try { return new Intl.NumberFormat(LOCALES[l], { style: "currency", currency }).format(amount); }
  catch { return `${amount.toFixed(2)} ${currency}`; }
}
function longDate(iso: string, l: Lang) {
  return new Intl.DateTimeFormat(LOCALES[l], { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${iso}T00:00:00Z`));
}
function deadline(iso: string, l: Lang) {
  return new Intl.DateTimeFormat(LOCALES[l], { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Budapest" })
    .format(new Date(iso));
}

function roomLabel(config: Json, roomTypeId: string, ratePlanId: string, l: Lang) {
  const type = (config.room_types ?? []).find((t: Json) => t.id === roomTypeId);
  const plan = (type?.rate_plans ?? []).find((p: Json) => p.id === ratePlanId);
  return {
    room: type ? (type.names?.[l] || type.name) : "",
    plan: plan ? (plan.names?.[l] || plan.name) : "",
    meal: plan?.meal_plan && MEALS[plan.meal_plan] ? MEALS[plan.meal_plan][l] : "",
  };
}

function shell(config: Json, inner: string) {
  const engine = config.engine ?? {};
  const color = safeColor(engine.theme?.primary);
  const logo = engine.logo_url ? `<img src="${esc(engine.logo_url)}" alt="${esc(engine.name)}" style="max-height:56px;max-width:200px;margin-bottom:8px">` : "";
  return `<!doctype html><html><body style="margin:0;background:#f5f3ef;font-family:Georgia,'Times New Roman',serif;color:#1f2937">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">
<div style="text-align:center;padding:16px 0">${logo}<div style="font-size:20px;font-weight:bold;color:${color}">${esc(engine.name)}</div></div>
<div style="background:#ffffff;border-radius:12px;padding:28px 24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55">${inner}</div>
</div></body></html>`;
}

function guestConfirmation(config: Json, booking: Json, guest: Json, l: Lang, manageUrl: string) {
  const t = MAIL[l];
  const engine = config.engine ?? {};
  const policies = engine.policies ?? {};
  const color = safeColor(engine.theme?.primary);
  const hotel = String(engine.name ?? "");
  const nights = Math.round((Date.parse(booking.check_out) - Date.parse(booking.check_in)) / 86400000);
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 0;color:#6b7280;vertical-align:top;width:42%">${esc(label)}</td><td style="padding:6px 0;font-weight:600">${value}</td></tr>`;
  const rooms = (booking.rooms ?? []).map((r: Json) => {
    const label = roomLabel(config, r.room_type_id, r.rate_plan_id, l);
    const pax = `${r.adults} ${t.adults}${r.children ? `, ${r.children} ${t.children}` : ""}`;
    return row(t.room, `${esc(label.room)}<br><span style="font-weight:400;color:#6b7280">${esc([label.plan, label.meal].filter(Boolean).join(" · "))} · ${esc(pax)}</span>`);
  }).join("");
  const checkInTime = policies.check_in_from ? ` <span style="font-weight:400;color:#6b7280">(${esc(fill(t.from, { time: policies.check_in_from }))})</span>` : "";
  const checkOutTime = policies.check_out_until ? ` <span style="font-weight:400;color:#6b7280">(${esc(fill(t.until, { time: policies.check_out_until }))})</span>` : "";
  const cancellation = booking.free_cancellation_until ? fill(t.freeUntil, { date: deadline(booking.free_cancellation_until, l) }) : t.nonRefundable;
  const contact = engine.contact ?? {};
  const contactLine = [contact.phone, contact.email, contact.address].filter(Boolean).map(esc).join(" · ");
  const inner = `
<p style="margin:0 0 12px">${esc(fill(t.dear, { name: guest.first_name }))}</p>
<p style="margin:0 0 20px">${esc(fill(t.intro, { hotel }))}</p>
<div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin-bottom:20px">
<div style="font-size:13px;color:#6b7280">${esc(t.ref)}</div>
<div style="font-size:24px;font-weight:700;letter-spacing:1px;color:${color}">${esc(booking.reference)}</div>
</div>
<table style="width:100%;border-collapse:collapse;font-size:14px">
${row(t.checkIn, esc(longDate(booking.check_in, l)) + checkInTime)}
${row(t.checkOut, esc(longDate(booking.check_out, l)) + checkOutTime)}
${row(t.nights, String(nights))}
${rooms}
${row(t.total, esc(money(Number(booking.total), booking.currency, l)))}
${row(t.payment, esc(t.payAtHotel))}
${row(t.cancellation, esc(cancellation))}
</table>
<div style="text-align:center;margin:26px 0 8px"><a href="${esc(manageUrl)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">${esc(t.manage)}</a></div>
<p style="margin:20px 0 4px">${esc(t.closing)}</p>
${contactLine ? `<p style="margin:16px 0 0;font-size:13px;color:#6b7280">${esc(t.contact)} ${contactLine}</p>` : ""}`;
  const text = [
    fill(t.dear, { name: guest.first_name }), fill(t.intro, { hotel }), "",
    `${t.ref}: ${booking.reference}`,
    `${t.checkIn}: ${longDate(booking.check_in, l)}`, `${t.checkOut}: ${longDate(booking.check_out, l)}`,
    `${t.total}: ${money(Number(booking.total), booking.currency, l)} (${t.payAtHotel})`,
    `${t.cancellation}: ${cancellation}`, "", `${t.manage}: ${manageUrl}`,
  ].join("\n");
  return { subject: fill(t.subject, { hotel, ref: booking.reference }), html: shell(config, inner), text };
}

function guestCancellation(config: Json, booking: Json, l: Lang) {
  const t = MAIL[l];
  const hotel = String(config.engine?.name ?? "");
  const inner = `<p style="margin:0 0 12px">${esc(fill(t.dear, { name: String(booking.guest_name ?? "").split(" ")[0] }))}</p>
<p style="margin:0 0 12px">${esc(fill(t.cancelledIntro, { ref: booking.reference }))}</p>
<p style="margin:0;color:#6b7280">${esc(longDate(booking.check_in_date, l))} – ${esc(longDate(booking.check_out_date, l))}</p>`;
  return {
    subject: fill(t.cancelledSubject, { hotel, ref: booking.reference }),
    html: shell(config, inner),
    text: fill(t.cancelledIntro, { ref: booking.reference }),
  };
}

function hotelNotice(config: Json, booking: Json, guest: Json, kind: "new" | "cancelled", orgSlug: string) {
  const engine = config.engine ?? {};
  const lines = (booking.rooms ?? []).map((r: Json) => {
    const label = roomLabel(config, r.room_type_id, r.rate_plan_id, "en");
    const link = r.reservation_id ? `${APP_URL}/${orgSlug}/reservations/${r.reservation_id}` : "";
    return `<li>${esc(label.room)} · ${esc(label.plan)} · ${r.adults} adults${r.children ? `, ${r.children} children` : ""} · ${esc(money(Number(r.total), booking.currency, "en"))}${link ? ` · <a href="${esc(link)}">${esc(r.reservation_number ?? "open")}</a>` : ""}</li>`;
  }).join("");
  const title = kind === "new" ? "New website booking" : "Website booking cancelled by the guest";
  const inner = `<h2 style="margin:0 0 12px;font-size:18px">${title} ${esc(booking.reference)}</h2>
<p style="margin:0 0 8px"><b>${esc(guest.name)}</b>${guest.email ? ` · ${esc(guest.email)}` : ""}${guest.phone ? ` · ${esc(guest.phone)}` : ""}</p>
<p style="margin:0 0 8px">${esc(booking.check_in)} → ${esc(booking.check_out)} · ${esc(money(Number(booking.total), booking.currency, "en"))} · payable at the hotel</p>
<ul style="margin:0 0 8px;padding-left:18px">${lines}</ul>
${guest.requests ? `<p style="margin:8px 0 0;white-space:pre-wrap"><b>Guest note:</b> ${esc(guest.requests)}</p>` : ""}
<p style="margin:12px 0 0;font-size:13px;color:#6b7280">Availability was updated in HotelCare and sent to Channex automatically.</p>`;
  return {
    subject: `${title}: ${booking.reference} · ${booking.check_in} → ${booking.check_out}`,
    html: shell({ engine }, inner),
    text: `${title} ${booking.reference}: ${guest.name}, ${booking.check_in} → ${booking.check_out}`,
  };
}

function background(task: Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(task);
  return runtime?.waitUntil ? Promise.resolve() : task;
}

// ------------------------------------------------------------------ actions
async function loadConfig(db: Db, id: string): Promise<Json> {
  const { data, error } = await db.rpc("booking_engine_public_config", { p_public_id: id });
  if (error) throw dbError(error);
  if (!data) throw new ApiError("NOT_FOUND", 404);
  return data as Json;
}

async function actionBook(db: Db, body: Json, ipHash: string, userAgent: string) {
  const id = requireId(body);
  const { checkIn, checkOut } = requireDates(body);
  // Bots fill hidden fields and submit instantly; people do neither.
  if (str(body.hp, 200) !== "" || !(Number(body.elapsed_ms) >= 1500)) throw new ApiError("REJECTED");
  if (!Array.isArray(body.rooms) || body.rooms.length < 1 || body.rooms.length > 10) throw new ApiError("INVALID_ROOMS");
  const rooms = body.rooms.map((room: Json) => {
    const adults = int(room?.adults);
    const children = room?.children === undefined ? 0 : int(room.children);
    if (!UUID.test(String(room?.room_type_id)) || !UUID.test(String(room?.rate_plan_id))
      || !(adults >= 1 && adults <= 20) || !(children >= 0 && children <= 20)) throw new ApiError("INVALID_ROOMS");
    return { room_type_id: room.room_type_id, rate_plan_id: room.rate_plan_id, adults, children };
  });
  const g = body.guest ?? {};
  const guest = {
    first_name: str(g.first_name, 80), last_name: str(g.last_name, 80), email: str(g.email, 200).toLowerCase(),
    phone: str(g.phone, 40), country: str(g.country, 2).toUpperCase(), arrival_time: str(g.arrival_time, 20),
    special_requests: str(g.special_requests, 1000),
  };
  if (!guest.first_name || !guest.last_name || !EMAIL.test(guest.email) || (guest.country && !/^[A-Z]{2}$/.test(guest.country))) {
    throw new ApiError("INVALID_GUEST");
  }
  if (body.consent?.terms !== true) throw new ApiError("CONSENT_REQUIRED");
  const language = lang(body.language);

  if (await overLimit(db, `book:ip:${ipHash}`, 600, 6)) throw new ApiError("RATE_LIMITED", 429);
  if (await overLimit(db, `book:engine:${id}`, 3600, 60)) throw new ApiError("RATE_LIMITED", 429);

  const token = randomToken();
  const { data, error } = await db.rpc("booking_engine_create_booking", {
    p_public_id: id, p_check_in: checkIn, p_check_out: checkOut, p_rooms: rooms, p_guest: guest,
    p_language: language, p_consent: { terms: true, marketing: body.consent?.marketing === true },
    p_attribution: cleanAttribution(body.attribution), p_token_hash: await sha256Hex(token),
    p_ip_hash: ipHash, p_user_agent: userAgent,
  });
  if (error) throw dbError(error);
  const result = data as Json;
  const manageUrl = `${APP_URL}/book/${id}/manage?ref=${encodeURIComponent(result.reference)}&token=${encodeURIComponent(token)}&lang=${language}`;

  const mail = async () => {
    try {
      const config = await loadConfig(db, id);
      const booking = { ...result, check_in: checkIn, check_out: checkOut };
      const toGuest = guestConfirmation(config, booking, guest, language, manageUrl);
      const guestSend = await sendEmail({ admin: db, organizationSlug: result.organization_slug, to: [guest.email], ...toGuest });
      const { data: engineRow } = await db.from("booking_engines").select("notification_emails, contact").eq("public_id", id).maybeSingle();
      const hotelTo = [...(engineRow?.notification_emails ?? []), ...(engineRow?.notification_emails?.length ? [] : [engineRow?.contact?.email])]
        .filter((value: unknown) => typeof value === "string" && EMAIL.test(value));
      const hotelSend = hotelTo.length
        ? await sendEmail({
          admin: db, organizationSlug: result.organization_slug, to: hotelTo,
          ...hotelNotice(config, booking, { name: `${guest.first_name} ${guest.last_name}`, email: guest.email, phone: guest.phone, requests: [guest.arrival_time && `Expected arrival: ${guest.arrival_time}`, guest.special_requests].filter(Boolean).join("\n") }, "new", result.organization_slug),
        })
        : { ok: false, skipped: true, error: "No hotel notification address" };
      await db.from("booking_engine_bookings").update({
        guest_email_status: guestSend.ok ? "sent" : `failed: ${guestSend.error ?? "unknown"}`.slice(0, 300),
        hotel_email_status: hotelSend.ok ? "sent" : `${hotelSend.skipped ? "skipped" : "failed"}: ${hotelSend.error ?? ""}`.slice(0, 300),
      }).eq("id", result.booking_id);
    } catch (e) {
      console.error("booking-engine e-mail failed:", e instanceof Error ? e.message : e);
    }
  };
  await background(mail());

  return {
    ok: true, reference: result.reference, total: result.total, currency: result.currency,
    free_cancellation_until: result.free_cancellation_until, rooms: (result.rooms ?? []).map((r: Json) => ({
      room_type_id: r.room_type_id, rate_plan_id: r.rate_plan_id, adults: r.adults, children: r.children, total: r.total,
    })),
    manage_url: manageUrl,
  };
}

async function actionCancel(db: Db, body: Json, ipHash: string) {
  const id = requireId(body);
  const reference = str(body.reference, 12).toUpperCase();
  const token = str(body.token, 80);
  if (!REFERENCE.test(reference) || !TOKEN.test(token)) throw new ApiError("NOT_FOUND", 404);
  if (await overLimit(db, `cancel:ip:${ipHash}`, 600, 8)) throw new ApiError("RATE_LIMITED", 429);
  const tokenHash = await sha256Hex(token);
  const { data, error } = await db.rpc("booking_engine_cancel_booking", { p_public_id: id, p_reference: reference, p_token_hash: tokenHash });
  if (error) throw dbError(error);
  const { data: booking } = await db.rpc("booking_engine_get_booking", { p_public_id: id, p_reference: reference, p_token_hash: tokenHash });
  if (!(data as Json)?.already && booking) {
    const mail = async () => {
      try {
        const config = await loadConfig(db, id);
        const l = lang(booking.language);
        const { data: row } = await db.from("booking_engine_bookings").select("organization_slug, guest_email").eq("id", (data as Json).booking_id).maybeSingle();
        const org = row?.organization_slug ?? null;
        await sendEmail({ admin: db, organizationSlug: org, to: [booking.guest_email], ...guestCancellation(config, booking, l) });
        const { data: engineRow } = await db.from("booking_engines").select("notification_emails, contact").eq("public_id", id).maybeSingle();
        const hotelTo = [...(engineRow?.notification_emails ?? []), ...(engineRow?.notification_emails?.length ? [] : [engineRow?.contact?.email])]
          .filter((value: unknown) => typeof value === "string" && EMAIL.test(value));
        if (hotelTo.length) {
          await sendEmail({
            admin: db, organizationSlug: org, to: hotelTo,
            ...hotelNotice(config, { ...booking, check_in: booking.check_in_date, check_out: booking.check_out_date }, { name: booking.guest_name, email: booking.guest_email }, "cancelled", org ?? ""),
          });
        }
      } catch (e) {
        console.error("booking-engine cancellation e-mail failed:", e instanceof Error ? e.message : e);
      }
    };
    await background(mail());
  }
  return { ok: true, booking };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  let body: Json;
  try { body = await req.json(); } catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }
  const db = serviceDb();
  const ipHash = (await hmacHex(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "booking-engine", clientIp(req))).slice(0, 32);
  const action = String(body?.action ?? "");
  try {
    switch (action) {
      case "config": {
        const id = requireId(body);
        if (await overLimit(db, `read:ip:${ipHash}`, 60, 120)) throw new ApiError("RATE_LIMITED", 429);
        return json({ ok: true, ...(await loadConfig(db, id)) });
      }
      case "calendar": {
        const id = requireId(body);
        const from = str(body.from, 10);
        const to = str(body.to, 10);
        if (!DATE.test(from) || !DATE.test(to)) throw new ApiError("INVALID_DATES");
        if (await overLimit(db, `read:ip:${ipHash}`, 60, 120)) throw new ApiError("RATE_LIMITED", 429);
        const { data, error } = await db.rpc("booking_engine_calendar", { p_public_id: id, p_from: from, p_to: to });
        if (error) throw dbError(error);
        if (!data?.ok) throw new ApiError(String(data?.error ?? "SERVER_ERROR"), KNOWN_ERRORS[String(data?.error)] ?? 500);
        return json(data);
      }
      case "search": {
        const id = requireId(body);
        const { checkIn, checkOut } = requireDates(body);
        if (await overLimit(db, `search:ip:${ipHash}`, 60, 40)) throw new ApiError("RATE_LIMITED", 429);
        const { data, error } = await db.rpc("booking_engine_search", { p_public_id: id, p_check_in: checkIn, p_check_out: checkOut });
        if (error) throw dbError(error);
        if (!data?.ok) throw new ApiError(String(data?.error ?? "SERVER_ERROR"), KNOWN_ERRORS[String(data?.error)] ?? 500);
        return json(data);
      }
      case "book":
        return json(await actionBook(db, body, ipHash, str(req.headers.get("user-agent"), 300)));
      case "lookup": {
        const id = requireId(body);
        const reference = str(body.reference, 12).toUpperCase();
        const token = str(body.token, 80);
        if (!REFERENCE.test(reference) || !TOKEN.test(token)) throw new ApiError("NOT_FOUND", 404);
        if (await overLimit(db, `lookup:ip:${ipHash}`, 60, 20)) throw new ApiError("RATE_LIMITED", 429);
        const { data, error } = await db.rpc("booking_engine_get_booking", { p_public_id: id, p_reference: reference, p_token_hash: await sha256Hex(token) });
        if (error) throw dbError(error);
        if (!data) throw new ApiError("NOT_FOUND", 404);
        return json({ ok: true, booking: data });
      }
      case "cancel":
        return json(await actionCancel(db, body, ipHash));
      default:
        return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
    }
  } catch (e) {
    if (e instanceof ApiError) return json({ ok: false, error: e.code }, e.status);
    console.error("booking-engine failed:", e instanceof Error ? e.stack ?? e.message : e);
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
});
