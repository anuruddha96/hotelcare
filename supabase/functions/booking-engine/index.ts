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
 *   wellness / wellness_book / wellness_cancel      jacuzzi & sauna slots of the stay (manage link)
 *   reminders                                       daily pre-arrival e-mails (worker secret)
 *
 * A request with the engine's test-link token ({preview}) sees the pages of a
 * switched-off engine, and its bookings are dry runs that store nothing.
 * Manage links in later e-mails use signed, expiring tokens (s1.<exp>.<sig>).
 *
 * The manage token is random, sent only to the guest, and stored as a SHA-256
 * hash. No card data is ever requested: phase 1 bookings are paid at the hotel.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from "../_shared/emailSender.ts";
import {
  WELLNESS_ERRORS, afterResponse, facilityName, notifyReception, sendGuestTicket, wellnessErrorCode, type TicketLang,
} from "../_shared/wellness.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret",
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

function guestConfirmation(config: Json, booking: Json, guest: Json, l: Lang, manageUrl: string, extras?: WellnessExtras) {
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
  const w = wellnessBlock(extras, l, color);
  const inner = `
<p style="margin:0 0 12px">${esc(fill(t.dear, { name: guest.first_name }))}</p>
${w.top}
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
${w.box}
<div style="text-align:center;margin:26px 0 8px"><a href="${esc(manageUrl)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">${esc(t.manage)}</a></div>
<p style="margin:20px 0 4px">${esc(t.closing)}</p>
${contactLine ? `<p style="margin:16px 0 0;font-size:13px;color:#6b7280">${esc(t.contact)} ${contactLine}</p>` : ""}`;
  const text = [
    fill(t.dear, { name: guest.first_name }), fill(t.intro, { hotel }), "",
    `${t.ref}: ${booking.reference}`,
    `${t.checkIn}: ${longDate(booking.check_in, l)}`, `${t.checkOut}: ${longDate(booking.check_out, l)}`,
    `${t.total}: ${money(Number(booking.total), booking.currency, l)} (${t.payAtHotel})`,
    `${t.cancellation}: ${cancellation}`, ...(w.text.length ? ["", ...w.text] : []), "", `${t.manage}: ${manageUrl}`,
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


// ------------------------------------------------------------------ v2 helpers
// Extra e-mail lines: welcome back, jacuzzi / sauna, pre-arrival reminder.
const EXTRA: Record<Lang, Record<string, string>> = {
  en: {
    welcomeBack: "Welcome back! It is lovely that you chose us again, and we look forward to having you with us once more.",
    lastTime: "Last time you enjoyed our {facility}. It is free for hotel guests, so book your slot for this stay now and it will be waiting for you.",
    bookFacility: "Book the {facility}", wellnessInvite: "Our {facilities} are free for hotel guests. Book a private slot before you arrive.",
    bookWellness: "Book a free slot", reminderSubject: "See you soon – {hotel}, {date}",
    reminderIntro: "We are looking forward to welcoming you in {days} days.", reminderTomorrow: "We are looking forward to welcoming you tomorrow.",
    transferTitle: "Arriving by plane?", transferAsk: "Here are our transfer prices. Reply to this e-mail or call us and we will arrange it.",
    and: "and", yourStay: "Your stay",
  },
  hu: {
    welcomeBack: "Örülünk, hogy ismét minket választott! Szeretettel várjuk újra.",
    lastTime: "Legutóbb Ön a {facility} szolgáltatásunkat is igénybe vette. Szállodai vendégeinknek ingyenes: foglalja le most az időpontot erre a tartózkodásra.",
    bookFacility: "{facility} foglalása", wellnessInvite: "A {facilities} szállodai vendégeinknek ingyenes. Foglaljon privát időpontot már érkezés előtt.",
    bookWellness: "Ingyenes időpont foglalása", reminderSubject: "Hamarosan találkozunk – {hotel}, {date}",
    reminderIntro: "{days} nap múlva szeretettel várjuk.", reminderTomorrow: "Holnap szeretettel várjuk.",
    transferTitle: "Repülővel érkezik?", transferAsk: "Transzferáraink alább láthatók. Válaszoljon erre az e-mailre vagy hívjon minket, és megszervezzük.",
    and: "és", yourStay: "Az Ön foglalása",
  },
  de: {
    welcomeBack: "Willkommen zurück! Wir freuen uns sehr, dass Sie sich wieder für uns entschieden haben.",
    lastTime: "Bei Ihrem letzten Aufenthalt haben Sie unser Angebot „{facility}“ genutzt. Für Hotelgäste ist es kostenlos – buchen Sie jetzt Ihren Termin für diesen Aufenthalt.",
    bookFacility: "{facility} buchen", wellnessInvite: "Unser Angebot „{facilities}“ ist für Hotelgäste kostenlos. Buchen Sie schon vor der Anreise einen privaten Termin.",
    bookWellness: "Kostenlosen Termin buchen", reminderSubject: "Bis bald – {hotel}, {date}",
    reminderIntro: "Wir freuen uns, Sie in {days} Tagen begrüßen zu dürfen.", reminderTomorrow: "Wir freuen uns, Sie morgen begrüßen zu dürfen.",
    transferTitle: "Sie reisen mit dem Flugzeug an?", transferAsk: "Hier sind unsere Transferpreise. Antworten Sie auf diese E-Mail oder rufen Sie uns an, wir organisieren alles.",
    and: "und", yourStay: "Ihr Aufenthalt",
  },
  es: {
    welcomeBack: "¡Bienvenido/a de nuevo! Nos alegra mucho que nos haya elegido otra vez.",
    lastTime: "En su última estancia utilizó el servicio de {facility}. Es gratuito para los huéspedes: reserve ya su turno para esta estancia.",
    bookFacility: "Reservar {facility}", wellnessInvite: "El servicio de {facilities} es gratuito para los huéspedes. Reserve un turno privado antes de llegar.",
    bookWellness: "Reservar un turno gratis", reminderSubject: "Hasta pronto – {hotel}, {date}",
    reminderIntro: "Le esperamos dentro de {days} días.", reminderTomorrow: "Le esperamos mañana.",
    transferTitle: "¿Llega en avión?", transferAsk: "Estos son nuestros precios de traslado. Responda a este correo o llámenos y lo organizamos.",
    and: "y", yourStay: "Su estancia",
  },
  it: {
    welcomeBack: "Bentornato/a! Siamo felici che ci abbia scelto di nuovo.",
    lastTime: "Durante l'ultimo soggiorno ha usato il servizio {facility}. È gratuito per gli ospiti: prenoti ora il suo turno per questo soggiorno.",
    bookFacility: "Prenota {facility}", wellnessInvite: "Il servizio {facilities} è gratuito per gli ospiti dell'hotel. Prenoti un turno privato prima dell'arrivo.",
    bookWellness: "Prenota un turno gratuito", reminderSubject: "A presto – {hotel}, {date}",
    reminderIntro: "La aspettiamo tra {days} giorni.", reminderTomorrow: "La aspettiamo domani.",
    transferTitle: "Arriva in aereo?", transferAsk: "Ecco i nostri prezzi per il transfer. Risponda a questa e-mail o ci chiami e lo organizziamo.",
    and: "e", yourStay: "Il suo soggiorno",
  },
  fr: {
    welcomeBack: "Bon retour parmi nous ! Nous sommes ravis que vous nous ayez choisis à nouveau.",
    lastTime: "Lors de votre dernier séjour, vous avez profité de notre {facility}. Il est gratuit pour nos clients : réservez dès maintenant votre créneau pour ce séjour.",
    bookFacility: "Réserver le {facility}", wellnessInvite: "L'accès au {facilities} est gratuit pour nos clients. Réservez un créneau privé avant votre arrivée.",
    bookWellness: "Réserver un créneau gratuit", reminderSubject: "À bientôt – {hotel}, {date}",
    reminderIntro: "Nous avons hâte de vous accueillir dans {days} jours.", reminderTomorrow: "Nous avons hâte de vous accueillir demain.",
    transferTitle: "Vous arrivez en avion ?", transferAsk: "Voici nos tarifs de transfert. Répondez à cet e-mail ou appelez-nous, nous nous en occupons.",
    and: "et", yourStay: "Votre séjour",
  },
};

const SIGNED = /^s1\.\d{10}\.[A-Za-z0-9_-]{43}$/;  // e-mail links: signed and expiring
const PREVIEW = /^[0-9a-f]{32,128}$/;              // top management's test link

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacB64(key: string, input: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(input)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const linkKey = () => `${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}:booking-engine-link:v1`;

/** Manage-link token for e-mails sent later (the original token is never stored). */
async function signedToken(publicId: string, reference: string, expiresAt: Date): Promise<string> {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  return `s1.${exp}.${await hmacB64(linkKey(), `${publicId}|${reference.toUpperCase()}|${exp}`)}`;
}

/** sha-256 of the manage token, for either kind of link; null when the link is not valid. */
async function accessHash(db: Db, publicId: string, reference: string, token: string): Promise<string | null> {
  if (TOKEN.test(token)) return await sha256Hex(token);
  if (!SIGNED.test(token)) return null;
  const [, expText, sig] = token.split(".");
  if (Number(expText) * 1000 < Date.now()) return null;
  if (!timingSafeEqual(await hmacB64(linkKey(), `${publicId}|${reference.toUpperCase()}|${expText}`), sig)) return null;
  const { data: engine } = await db.from("booking_engines").select("id").eq("public_id", publicId).maybeSingle();
  if (!engine) return null;
  const { data: row } = await db.from("booking_engine_bookings").select("manage_token_hash")
    .eq("engine_id", engine.id).eq("reference", reference.toUpperCase()).maybeSingle();
  return row?.manage_token_hash ?? null;
}

/** True when the request carries this engine's test-link token. */
async function previewOk(db: Db, publicId: string, token: unknown): Promise<boolean> {
  const t = str(token, 128);
  if (!PREVIEW.test(t)) return false;
  const { data } = await db.from("booking_engines").select("preview_token").eq("public_id", publicId).maybeSingle();
  return !!data?.preview_token && timingSafeEqual(String(data.preview_token), t);
}

const budapestToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDaysIso = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

type Facility = { kind: string; name: string };
type WellnessExtras = { returning: boolean; pastKinds: string[]; facilities: Facility[]; manageUrl: string };

const facilityWord = (kind: string, l: Lang, fallback: string) => {
  const name = facilityName(kind, l as TicketLang, fallback);
  return l === "de" ? name : name.toLowerCase();
};

/** "jacuzzi and sauna" in the guest's language. */
function facilitiesPhrase(list: Facility[], l: Lang): string {
  const names = list.map((f) => facilityWord(f.kind, l, f.name));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} ${EXTRA[l].and} ${names[names.length - 1]}` : names[0] ?? "";
}

/** Welcome-back line and the jacuzzi / sauna invitation for the guest's own e-mails. */
function wellnessBlock(extras: WellnessExtras | undefined, l: Lang, color: string): { top: string; box: string; text: string[] } {
  const x = EXTRA[l];
  const out = { top: "", box: "", text: [] as string[] };
  if (!extras) return out;
  if (extras.returning) {
    out.top = `<p style="margin:0 0 16px">${esc(x.welcomeBack)}</p>`;
    out.text.push(x.welcomeBack);
  }
  if (!extras.facilities.length) return out;
  const again = extras.facilities.filter((f) => extras.pastKinds.includes(f.kind));
  const link = (kind?: string) => `${extras.manageUrl}&tab=wellness${kind ? `&kind=${kind}` : ""}`;
  const button = (label: string, href: string) =>
    `<a href="${esc(href)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${esc(label)}</a>`;
  const line = again.length
    ? fill(x.lastTime, { facility: facilitiesPhrase(again, l) })
    : fill(x.wellnessInvite, { facilities: facilitiesPhrase(extras.facilities, l) });
  const rawLabel = again.length
    ? fill(x.bookFacility, { facility: facilitiesPhrase(again.slice(0, 1), l) })
    : x.bookWellness;
  const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
  out.box = `<div style="margin:22px 0 4px;padding:16px 18px;border-radius:12px;background:#f3f6f8">
<p style="margin:0 0 12px">${esc(line)}</p>${button(label, link(again[0]?.kind))}</div>`;
  out.text.push(line, `${label}: ${link(again[0]?.kind)}`);
  return out;
}

type TransferPrice = { label: string; price: number; currency: string; note?: string };

function guestReminder(config: Json, booking: Json, l: Lang, manageUrl: string, days: number,
                       extras: WellnessExtras, transfers: TransferPrice[]) {
  const t = MAIL[l];
  const x = EXTRA[l];
  const engine = config.engine ?? {};
  const policies = engine.policies ?? {};
  const color = safeColor(engine.theme?.primary);
  const hotel = String(engine.name ?? "");
  const first = String(booking.guest_name ?? "").split(" ")[0];
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 0;color:#6b7280;vertical-align:top;width:42%">${esc(label)}</td><td style="padding:6px 0;font-weight:600">${value}</td></tr>`;
  const checkInTime = policies.check_in_from ? ` <span style="font-weight:400;color:#6b7280">(${esc(fill(t.from, { time: policies.check_in_from }))})</span>` : "";
  const checkOutTime = policies.check_out_until ? ` <span style="font-weight:400;color:#6b7280">(${esc(fill(t.until, { time: policies.check_out_until }))})</span>` : "";
  const rooms = (booking.rooms ?? []).map((r: Json) => row(t.room, esc(roomLabel(config, r.room_type_id, r.rate_plan_id, l).room || r.room_type_name || ""))).join("");
  const w = wellnessBlock(extras, l, color);
  const intro = days <= 1 ? x.reminderTomorrow : fill(x.reminderIntro, { days: String(days) });
  const transferHtml = transfers.length
    ? `<div style="margin:22px 0 4px"><p style="margin:0 0 6px;font-weight:600">${esc(x.transferTitle)}</p>
<p style="margin:0 0 8px;color:#374151">${esc(x.transferAsk)}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${transfers.map((p) =>
      `<tr><td style="padding:4px 0">${esc(p.label)}${p.note ? ` <span style="color:#6b7280">(${esc(p.note)})</span>` : ""}</td><td style="padding:4px 0;text-align:right;font-weight:600">${esc(money(Number(p.price), p.currency, l))}</td></tr>`).join("")}</table></div>`
    : "";
  const contact = engine.contact ?? {};
  const contactLine = [contact.phone, contact.email, contact.address].filter(Boolean).map(esc).join(" · ");
  const inner = `
<p style="margin:0 0 12px">${esc(fill(t.dear, { name: first }))}</p>
${w.top}
<p style="margin:0 0 18px">${esc(intro)}</p>
<div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px">
<div style="font-size:13px;color:#6b7280">${esc(x.yourStay)} · ${esc(t.ref)} ${esc(booking.reference)}</div>
<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:6px">
${row(t.checkIn, esc(longDate(booking.check_in_date, l)) + checkInTime)}
${row(t.checkOut, esc(longDate(booking.check_out_date, l)) + checkOutTime)}
${rooms}
${row(t.payment, esc(t.payAtHotel))}
</table></div>
${w.box}
${transferHtml}
<div style="text-align:center;margin:26px 0 8px"><a href="${esc(manageUrl)}" style="color:${color};font-weight:600">${esc(t.manage)}</a></div>
${contactLine ? `<p style="margin:16px 0 0;font-size:13px;color:#6b7280">${esc(t.contact)} ${contactLine}</p>` : ""}`;
  const text = [fill(t.dear, { name: first }), ...(w.top ? [x.welcomeBack] : []), intro, "",
    `${t.checkIn}: ${longDate(booking.check_in_date, l)}`, `${t.checkOut}: ${longDate(booking.check_out_date, l)}`,
    ...w.text.slice(w.top ? 1 : 0), "", `${t.manage}: ${manageUrl}`].join("\n");
  return {
    subject: fill(x.reminderSubject, { hotel, date: longDate(booking.check_in_date, l) }),
    html: shell(config, inner), text,
  };
}

/** Bookings of the stay behind a manage link (token or signed e-mail link). */
async function manageStay(db: Db, body: Json) {
  const id = requireId(body);
  const reference = str(body.reference, 12).toUpperCase();
  const token = str(body.token, 120);
  if (!REFERENCE.test(reference)) throw new ApiError("NOT_FOUND", 404);
  const hash = await accessHash(db, id, reference, token);
  if (!hash) throw new ApiError("NOT_FOUND", 404);
  const { data: engine } = await db.from("booking_engines").select("id, hotel_id, theme").eq("public_id", id).maybeSingle();
  if (!engine) throw new ApiError("NOT_FOUND", 404);
  const { data: row } = await db.from("booking_engine_bookings").select("*")
    .eq("engine_id", engine.id).eq("reference", reference).eq("manage_token_hash", hash).maybeSingle();
  if (!row) throw new ApiError("NOT_FOUND", 404);
  const reservationIds: string[] = (row.rooms ?? []).map((r: Json) => String(r.reservation_id ?? "")).filter((v: string) => UUID.test(v));
  return { id, reference, token, row, engine, reservationIds };
}

function wellnessReply(error: { message?: string }) {
  const code = wellnessErrorCode(error);
  if (!code) throw dbError(error);
  return json({ ok: false, error: code, message: WELLNESS_ERRORS[code].message }, WELLNESS_ERRORS[code].status);
}

async function activeFacilities(db: Db, hotelId: string): Promise<Facility[]> {
  const { data } = await db.from("insuite_wellness_resources").select("kind, name")
    .eq("hotel_id", hotelId).eq("is_active", true).order("sort_order");
  return (data ?? []) as Facility[];
}

async function workerAuthorized(db: Db, req: Request): Promise<boolean> {
  const provided = req.headers.get("x-worker-secret") || "";
  if (!provided) return false;
  const { data, error } = await db.rpc("booking_engine_worker_secret");
  return !error && typeof data === "string" && data.length > 0 && timingSafeEqual(provided, data);
}

/** Daily: pre-arrival e-mails, with the welcome-back and jacuzzi / sauna lines. */
async function actionReminders(db: Db) {
  const { data: due, error } = await db.rpc("booking_engine_due_reminders", { p_limit: 200 });
  if (error) throw dbError(error);
  const today = budapestToday();
  const engines = new Map<string, Json>();
  let sent = 0, skipped = 0, failed = 0;
  for (const b of (due ?? []) as Json[]) {
    try {
      let engine: Json | undefined = engines.get(b.engine_id);
      if (!engine) {
        const { data } = await db.from("booking_engines").select("public_id, hotel_id").eq("id", b.engine_id).maybeSingle();
        const found: Json = data ?? {};
        engines.set(b.engine_id, found);
        engine = found;
      }
      const publicId = String(engine.public_id ?? "");
      if (!publicId) continue;
      const l = lang(b.language);
      const config = await loadConfig(db, publicId, true);
      const reservationIds = (b.rooms ?? []).map((r: Json) => r.reservation_id).filter(Boolean);
      const [first, ...rest] = String(b.guest_name ?? "").split(" ");
      const [{ data: history }, facilities, { data: settings }] = await Promise.all([
        db.rpc("booking_engine_guest_history", {
          p_hotel_id: b.hotel_id, p_email: b.guest_email, p_first_name: first, p_last_name: rest.join(" "), p_exclude: reservationIds,
        }),
        activeFacilities(db, b.hotel_id),
        db.from("insuite_wellness_settings").select("transfer_prices").eq("hotel_id", b.hotel_id).maybeSingle(),
      ]);
      const token = await signedToken(publicId, b.reference, new Date(`${addDaysIso(b.check_out_date, 2)}T00:00:00Z`));
      const manageUrl = `${APP_URL}/book/${publicId}/manage?ref=${encodeURIComponent(b.reference)}&token=${encodeURIComponent(token)}&lang=${l}`;
      const days = Math.max(1, Math.round((Date.parse(b.check_in_date) - Date.parse(today)) / 86400000));
      const mail = guestReminder(config, b, l, manageUrl, days, {
        returning: Number(history?.previous_stays ?? 0) > 0,
        pastKinds: Array.isArray(history?.wellness_kinds) ? history.wellness_kinds : [],
        facilities, manageUrl,
      }, Array.isArray(settings?.transfer_prices) ? settings.transfer_prices : []);
      const result = await sendEmail({ admin: db, organizationSlug: b.organization_slug, to: [b.guest_email], ...mail });
      const status = result.ok ? "sent" : `${result.skipped ? "skipped" : "failed"}: ${result.error ?? ""}`.slice(0, 300);
      if (result.ok) sent++; else if (result.skipped) skipped++; else failed++;
      // A failed send is retried tomorrow while still inside the window; sent or skipped is final.
      await db.from("booking_engine_bookings").update({
        reminder_status: status, ...(result.ok || result.skipped ? { reminder_sent_at: new Date().toISOString() } : {}),
      }).eq("id", b.id);
    } catch (e) {
      failed++;
      console.error("booking-engine reminder failed:", b.reference, e instanceof Error ? e.message : e);
    }
  }
  return { ok: true, due: (due ?? []).length, sent, skipped, failed };
}

// ------------------------------------------------------------------ actions
async function loadConfig(db: Db, id: string, preview = false): Promise<Json> {
  const { data, error } = await db.rpc("booking_engine_public_config", { p_public_id: id, p_preview: preview });
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

  const preview = await previewOk(db, id, body.preview);
  const token = randomToken();
  const { data, error } = await db.rpc("booking_engine_create_booking", {
    p_public_id: id, p_check_in: checkIn, p_check_out: checkOut, p_rooms: rooms, p_guest: guest,
    p_language: language, p_consent: { terms: true, marketing: body.consent?.marketing === true },
    p_attribution: cleanAttribution(body.attribution), p_token_hash: await sha256Hex(token),
    p_ip_hash: ipHash, p_user_agent: userAgent, p_preview: preview,
  });
  if (error) throw dbError(error);
  const result = data as Json;
  const summary = {
    ok: true, reference: result.reference, total: result.total, currency: result.currency,
    free_cancellation_until: result.free_cancellation_until, rooms: (result.rooms ?? []).map((r: Json) => ({
      room_type_id: r.room_type_id, rate_plan_id: r.rate_plan_id, adults: r.adults, children: r.children, total: r.total,
    })),
  };
  // Test link: every rule and price was checked, nothing was stored. No e-mails.
  if (result.preview) return { ...summary, preview: true };
  const manageUrl = `${APP_URL}/book/${id}/manage?ref=${encodeURIComponent(result.reference)}&token=${encodeURIComponent(token)}&lang=${language}`;

  const mail = async () => {
    try {
      const config = await loadConfig(db, id);
      const booking = { ...result, check_in: checkIn, check_out: checkOut };
      // Recognised by e-mail or name: a warm line and the jacuzzi / sauna they
      // used last time, in their own e-mail only (anyone can type an address,
      // so the booking page itself never reveals a stay history).
      const [{ data: history }, facilities] = await Promise.all([
        db.rpc("booking_engine_guest_history", {
          p_hotel_id: result.hotel_id, p_email: guest.email, p_first_name: guest.first_name, p_last_name: guest.last_name,
          p_exclude: (result.rooms ?? []).map((r: Json) => r.reservation_id).filter(Boolean),
        }),
        activeFacilities(db, result.hotel_id),
      ]);
      const toGuest = guestConfirmation(config, booking, guest, language, manageUrl, {
        returning: Number(history?.previous_stays ?? 0) > 0,
        pastKinds: Array.isArray(history?.wellness_kinds) ? history.wellness_kinds : [],
        facilities, manageUrl,
      });
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
        guest_email_status: guestSend.ok ? "sent" : `${guestSend.skipped ? "skipped" : "failed"}: ${guestSend.error ?? "unknown"}`.slice(0, 300),
        hotel_email_status: hotelSend.ok ? "sent" : `${hotelSend.skipped ? "skipped" : "failed"}: ${hotelSend.error ?? ""}`.slice(0, 300),
      }).eq("id", result.booking_id);
    } catch (e) {
      console.error("booking-engine e-mail failed:", e instanceof Error ? e.message : e);
    }
  };
  await background(mail());

  return { ...summary, manage_url: manageUrl };
}

async function actionCancel(db: Db, body: Json, ipHash: string) {
  const id = requireId(body);
  const reference = str(body.reference, 12).toUpperCase();
  const token = str(body.token, 120);
  if (!REFERENCE.test(reference)) throw new ApiError("NOT_FOUND", 404);
  if (await overLimit(db, `cancel:ip:${ipHash}`, 600, 8)) throw new ApiError("RATE_LIMITED", 429);
  const tokenHash = await accessHash(db, id, reference, token);
  if (!tokenHash) throw new ApiError("NOT_FOUND", 404);
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
        return json({ ok: true, ...(await loadConfig(db, id, await previewOk(db, id, body.preview))) });
      }
      case "calendar": {
        const id = requireId(body);
        const from = str(body.from, 10);
        const to = str(body.to, 10);
        if (!DATE.test(from) || !DATE.test(to)) throw new ApiError("INVALID_DATES");
        if (await overLimit(db, `read:ip:${ipHash}`, 60, 120)) throw new ApiError("RATE_LIMITED", 429);
        const { data, error } = await db.rpc("booking_engine_calendar", {
          p_public_id: id, p_from: from, p_to: to, p_preview: await previewOk(db, id, body.preview),
        });
        if (error) throw dbError(error);
        if (!data?.ok) throw new ApiError(String(data?.error ?? "SERVER_ERROR"), KNOWN_ERRORS[String(data?.error)] ?? 500);
        return json(data);
      }
      case "search": {
        const id = requireId(body);
        const { checkIn, checkOut } = requireDates(body);
        if (await overLimit(db, `search:ip:${ipHash}`, 60, 40)) throw new ApiError("RATE_LIMITED", 429);
        const { data, error } = await db.rpc("booking_engine_search", {
          p_public_id: id, p_check_in: checkIn, p_check_out: checkOut, p_preview: await previewOk(db, id, body.preview),
        });
        if (error) throw dbError(error);
        if (!data?.ok) throw new ApiError(String(data?.error ?? "SERVER_ERROR"), KNOWN_ERRORS[String(data?.error)] ?? 500);
        return json(data);
      }
      case "book":
        return json(await actionBook(db, body, ipHash, str(req.headers.get("user-agent"), 300)));
      case "lookup": {
        const id = requireId(body);
        const reference = str(body.reference, 12).toUpperCase();
        const token = str(body.token, 120);
        if (!REFERENCE.test(reference)) throw new ApiError("NOT_FOUND", 404);
        if (await overLimit(db, `lookup:ip:${ipHash}`, 60, 20)) throw new ApiError("RATE_LIMITED", 429);
        const tokenHash = await accessHash(db, id, reference, token);
        if (!tokenHash) throw new ApiError("NOT_FOUND", 404);
        const { data, error } = await db.rpc("booking_engine_get_booking", { p_public_id: id, p_reference: reference, p_token_hash: tokenHash });
        if (error) throw dbError(error);
        if (!data) throw new ApiError("NOT_FOUND", 404);
        // The guest's own booking keeps its room names and the hotel's look
        // even after online booking has been switched off.
        const { preview: _preview, ...config } = await loadConfig(db, id, true);
        return json({ ok: true, booking: data, config });
      }
      case "cancel":
        return json(await actionCancel(db, body, ipHash));
      // ---------------------------------------------------- jacuzzi & sauna from the manage link
      case "wellness": {
        if (await overLimit(db, `wellness:ip:${ipHash}`, 60, 40)) throw new ApiError("RATE_LIMITED", 429);
        const stay = await manageStay(db, body);
        const today = budapestToday();
        const from = stay.row.check_in_date > today ? stay.row.check_in_date : today;
        const to = stay.row.check_out_date;
        const empty = { ok: true, resources: [], bookings: [], from, to };
        if (stay.row.status !== "confirmed" || !stay.reservationIds.length || to < today) return json(empty);
        const [slots, mine] = await Promise.all([
          db.rpc("insuite_wellness_slots", { _hotel_id: stay.row.hotel_id, _from: from, _to: to, _reservation_id: stay.reservationIds[0] }),
          db.rpc("insuite_wellness_stay_bookings", { _reservation_ids: stay.reservationIds }),
        ]);
        if (slots.error) throw dbError(slots.error);
        return json({ ...(slots.data ?? empty), bookings: mine.data ?? [] });
      }
      case "wellness_book": {
        if (await overLimit(db, `wellness-book:ip:${ipHash}`, 600, 12)) throw new ApiError("RATE_LIMITED", 429);
        const stay = await manageStay(db, body);
        if (stay.row.status !== "confirmed" || !stay.reservationIds.length) throw new ApiError("NOT_FOUND", 404);
        const resourceId = str(body.resource_id, 40);
        const startsAt = Date.parse(str(body.starts_at, 40));
        const party = int(body.party_size);
        const clientId = str(body.client_request_id, 40);
        if (!UUID.test(resourceId) || !Number.isFinite(startsAt) || !(party >= 1 && party <= 8) || !UUID.test(clientId)) {
          throw new ApiError("INVALID_SLOT");
        }
        const { data: booking, error } = await db.rpc("insuite_wellness_book", {
          _resource_id: resourceId, _starts_at: new Date(startsAt).toISOString(), _party_size: party,
          _source: "booking_engine", _reservation_id: stay.reservationIds[0], _guest_email: stay.row.guest_email,
          _client_request_id: clientId,
        });
        if (error) return wellnessReply(error);
        if (!booking.repeated) {
          const manageUrl = `${APP_URL}/book/${stay.id}/manage?ref=${encodeURIComponent(stay.reference)}&token=${encodeURIComponent(stay.token)}&lang=${lang(stay.row.language)}&tab=wellness`;
          await afterResponse(Promise.all([
            notifyReception(db, booking, "booked"),
            sendGuestTicket(db, booking, stay.row.guest_email, {
              lang: lang(stay.row.language) as TicketLang, manageUrl, color: safeColor(stay.engine.theme?.primary),
            }),
          ]));
        }
        return json({ ok: true, booking });
      }
      case "wellness_cancel": {
        if (await overLimit(db, `wellness-book:ip:${ipHash}`, 600, 12)) throw new ApiError("RATE_LIMITED", 429);
        const stay = await manageStay(db, body);
        const bookingId = str(body.booking_id, 40);
        if (!UUID.test(bookingId)) throw new ApiError("NOT_FOUND", 404);
        const { data: own } = await db.from("insuite_wellness_bookings").select("reservation_id")
          .eq("id", bookingId).eq("hotel_id", stay.row.hotel_id).maybeSingle();
        if (!own || !stay.reservationIds.includes(String(own.reservation_id))) throw new ApiError("NOT_FOUND", 404);
        const { data: booking, error } = await db.rpc("insuite_wellness_change", {
          _booking_id: bookingId, _hotel_id: stay.row.hotel_id, _action: "cancel", _reservation_id: own.reservation_id,
          _reason: "Cancelled by the guest from the booking link",
        });
        if (error) return wellnessReply(error);
        await afterResponse(Promise.all([
          notifyReception(db, booking, "cancelled"),
          sendGuestTicket(db, booking, stay.row.guest_email, { lang: lang(stay.row.language) as TicketLang, event: "cancelled" }),
        ]));
        return json({ ok: true, booking });
      }
      // ---------------------------------------------------- daily job
      case "reminders": {
        if (!(await workerAuthorized(db, req))) return json({ ok: false, error: "NOT_FOUND" }, 404);
        return json(await actionReminders(db));
      }
      default:
        return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
    }
  } catch (e) {
    if (e instanceof ApiError) return json({ ok: false, error: e.code }, e.status);
    console.error("booking-engine failed:", e instanceof Error ? e.stack ?? e.message : e);
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
});
