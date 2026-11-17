// Jacuzzi / sauna bookings: shared by insuite-api (guest in the room,
// reception) and booking-engine (guest with a manage link).
//
// The rules live in SQL (insuite_wellness_book / _change): this file maps
// their refusal codes to clean API errors and sends the two e-mails every
// booking produces: a notice to reception and, when we know the guest's
// address, the guest's ticket.
import { sendEmail } from "./emailSender.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

export const WELLNESS_ERRORS: Record<string, { status: number; message: string }> = {
  WELLNESS_UNAVAILABLE: { status: 409, message: "This facility cannot be booked right now." },
  TOO_MANY_GUESTS: { status: 400, message: "Too many guests for this facility." },
  CLOSED: { status: 409, message: "The facility is closed on that day." },
  INVALID_SLOT: { status: 400, message: "Please choose one of the listed time slots." },
  SLOT_PASSED: { status: 409, message: "That time slot has already started." },
  TOO_FAR: { status: 400, message: "That date is too far ahead." },
  STAY_NOT_ACTIVE: { status: 409, message: "This stay is not active." },
  OUTSIDE_STAY: { status: 409, message: "Please choose a time during the stay." },
  DAILY_LIMIT: { status: 409, message: "There is already a booking for this facility on that day." },
  STAY_REQUIRED: { status: 400, message: "A hotel stay is required." },
  GUEST_NAME_REQUIRED: { status: 400, message: "Enter the guest's name." },
  SLOT_TAKEN: { status: 409, message: "Sorry, that slot was just booked by someone else. Please choose another time." },
  NOT_FOUND: { status: 404, message: "Booking not found." },
  INVALID_TRANSITION: { status: 409, message: "This booking can no longer be changed." },
  TOO_LATE: { status: 409, message: "The booking has already started. Please contact reception." },
  TOO_EARLY: { status: 409, message: "The booking has not started yet." },
  INVALID_ACTION: { status: 400, message: "This action is not allowed." },
  INVALID_SOURCE: { status: 400, message: "This action is not allowed." },
};

/** The SQL refusal code in a Postgres error, or null for an unexpected error. */
export function wellnessErrorCode(error: { message?: string } | null | undefined): string | null {
  const message = String(error?.message ?? "").trim();
  if (WELLNESS_ERRORS[message]) return message;
  return Object.keys(WELLNESS_ERRORS).find((code) => new RegExp(`\\b${code}\\b`).test(message)) ?? null;
}

export const WELLNESS_KINDS = ["jacuzzi", "sauna"] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export type TicketLang = "en" | "hu" | "de" | "es" | "it" | "fr";
const LOCALES: Record<TicketLang, string> = { en: "en-GB", hu: "hu-HU", de: "de-DE", es: "es-ES", it: "it-IT", fr: "fr-FR" };

/** "Wed 18 November, 10:00–11:00" in hotel time. */
export function slotLabel(startsAt: string, endsAt: string, lang: TicketLang = "en"): string {
  const locale = LOCALES[lang] ?? "en-GB";
  const day = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "long", timeZone: "Europe/Budapest" })
    .format(new Date(startsAt));
  const time = (iso: string) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Budapest" })
    .format(new Date(iso));
  return `${day}, ${time(startsAt)}–${time(endsAt)}`;
}

/** Reception addresses: wellness settings, else booking-engine notices, else the In-Suite contact. */
export async function wellnessRecipients(db: Db, hotelId: string): Promise<string[]> {
  const clean = (list: unknown[]) =>
    [...new Set(list.filter((v): v is string => typeof v === "string").map((v) => v.trim().toLowerCase()).filter((v) => EMAIL.test(v)))];
  const { data: settings } = await db.from("insuite_wellness_settings").select("notification_emails").eq("hotel_id", hotelId).maybeSingle();
  let list = clean(settings?.notification_emails ?? []);
  if (!list.length) {
    const { data: engine } = await db.from("booking_engines").select("notification_emails, contact").eq("hotel_id", hotelId).maybeSingle();
    list = clean([...(engine?.notification_emails ?? []), engine?.contact?.email]);
  }
  if (!list.length) {
    const { data: config } = await db.from("insuite_property_configs").select("published").eq("hotel_id", hotelId).maybeSingle();
    list = clean([config?.published?.contact_email]);
  }
  return list;
}

const CHANNEL: Record<string, string> = {
  insuite: "the guest, from the In-Suite page in the room",
  booking_engine: "the guest, from the website booking link",
  reception: "reception",
};

/** Notice to reception for every booking and cancellation, whichever channel made it. */
export async function notifyReception(db: Db, booking: Json, event: "booked" | "cancelled", actorName?: string | null) {
  try {
    const to = await wellnessRecipients(db, booking.hotel_id);
    if (!to.length) return { ok: false, skipped: true, error: "No reception address configured" };
    const facility = String(booking.resource_name ?? booking.kind ?? "Wellness");
    const when = slotLabel(booking.starts_at, booking.ends_at, "en");
    const room = booking.room_number ? `Room ${booking.room_number}` : "No room";
    const who = booking.source === "reception" && actorName ? `reception (${actorName})` : CHANNEL[booking.source] ?? booking.source;
    const title = event === "booked" ? `${facility} booked` : `${facility} booking cancelled`;
    const row = (label: string, value: string) =>
      `<tr><td style="padding:5px 12px 5px 0;color:#6b7280;vertical-align:top">${esc(label)}</td><td style="padding:5px 0;font-weight:600">${value}</td></tr>`;
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#111827;max-width:560px">
<h2 style="margin:0 0 12px;font-size:18px">${esc(title)} · ${esc(booking.hotel_name ?? booking.hotel_id)}</h2>
<table style="border-collapse:collapse;font-size:14px">
${row("When", esc(when))}
${row("Guest", esc(booking.guest_name))}
${row("Room", esc(room))}
${row("People", esc(booking.party_size))}
${row("Ticket", `<span style="font-family:monospace;font-size:16px">${esc(booking.ticket_code)}</span>`)}
${row(event === "booked" ? "Booked by" : "Cancelled by", esc(who))}
${booking.notes ? row("Note", esc(booking.notes)) : ""}
${event === "cancelled" && booking.cancel_reason ? row("Reason", esc(booking.cancel_reason)) : ""}
</table>
<p style="margin:16px 0 0;color:#374151">${event === "booked"
      ? "The slot is reserved in HotelCare (In-Suite → Wellness). Hand over the key when the guest shows this ticket."
      : "The slot is free again in HotelCare (In-Suite → Wellness)."}</p></div>`;
    const subject = `${title}: ${when} · ${room} · ${booking.guest_name} (${booking.ticket_code})`;
    return await sendEmail({
      admin: db, organizationSlug: booking.organization_slug, to, subject, html,
      text: `${title}: ${when}, ${booking.guest_name}, ${room}, ${booking.party_size} people, ticket ${booking.ticket_code}.`,
    });
  } catch (e) {
    console.error("wellness reception notice failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "notice failed" };
  }
}

const TICKET: Record<TicketLang, Record<string, string>> = {
  en: { subject: "Your {facility} booking – {when}", intro: "Your {facility} is booked.", show: "Show this ticket at reception to collect the key.",
    when: "When", people: "People", room: "Room", ticket: "Ticket", free: "Free for hotel guests",
    manage: "View or cancel", cancelledSubject: "{facility} booking cancelled – {when}", cancelled: "Your {facility} booking has been cancelled." },
  hu: { subject: "{facility} foglalás – {when}", intro: "{facility} foglalását rögzítettük.", show: "A kulcsot ennek a jegynek a felmutatásával veheti át a recepción.",
    when: "Időpont", people: "Fő", room: "Szoba", ticket: "Jegy", free: "Szállodai vendégeinknek ingyenes",
    manage: "Megtekintés vagy lemondás", cancelledSubject: "{facility} foglalás lemondva – {when}", cancelled: "{facility} foglalását lemondtuk." },
  de: { subject: "Ihre Buchung: {facility} – {when}", intro: "Ihr Termin für {facility} ist gebucht.", show: "Zeigen Sie dieses Ticket an der Rezeption, um den Schlüssel zu erhalten.",
    when: "Wann", people: "Personen", room: "Zimmer", ticket: "Ticket", free: "Für Hotelgäste kostenlos",
    manage: "Ansehen oder stornieren", cancelledSubject: "Buchung storniert: {facility} – {when}", cancelled: "Ihre Buchung für {facility} wurde storniert." },
  es: { subject: "Su reserva de {facility} – {when}", intro: "Su {facility} está reservado.", show: "Muestre este ticket en recepción para recoger la llave.",
    when: "Cuándo", people: "Personas", room: "Habitación", ticket: "Ticket", free: "Gratis para huéspedes del hotel",
    manage: "Ver o cancelar", cancelledSubject: "Reserva de {facility} cancelada – {when}", cancelled: "Su reserva de {facility} ha sido cancelada." },
  it: { subject: "La sua prenotazione {facility} – {when}", intro: "{facility} prenotato.", show: "Mostri questo biglietto alla reception per ritirare la chiave.",
    when: "Quando", people: "Persone", room: "Camera", ticket: "Biglietto", free: "Gratuito per gli ospiti dell'hotel",
    manage: "Visualizza o cancella", cancelledSubject: "Prenotazione {facility} cancellata – {when}", cancelled: "La sua prenotazione {facility} è stata cancellata." },
  fr: { subject: "Votre réservation {facility} – {when}", intro: "Votre créneau {facility} est réservé.", show: "Présentez ce ticket à la réception pour récupérer la clé.",
    when: "Quand", people: "Personnes", room: "Chambre", ticket: "Ticket", free: "Gratuit pour les clients de l'hôtel",
    manage: "Voir ou annuler", cancelledSubject: "Réservation {facility} annulée – {when}", cancelled: "Votre réservation {facility} a été annulée." },
};
const FACILITY: Record<TicketLang, Record<string, string>> = {
  en: { jacuzzi: "Jacuzzi", sauna: "Sauna" }, hu: { jacuzzi: "Jakuzzi", sauna: "Szauna" },
  de: { jacuzzi: "Whirlpool", sauna: "Sauna" }, es: { jacuzzi: "Jacuzzi", sauna: "Sauna" },
  it: { jacuzzi: "Jacuzzi", sauna: "Sauna" }, fr: { jacuzzi: "Jacuzzi", sauna: "Sauna" },
};
export const facilityName = (kind: string, lang: TicketLang, fallback?: string) =>
  FACILITY[lang]?.[kind] ?? fallback ?? kind;

/** The guest's ticket (or cancellation) by e-mail, in the guest's language. */
export async function sendGuestTicket(db: Db, booking: Json, to: string, opts: {
  lang?: TicketLang; event?: "booked" | "cancelled"; manageUrl?: string; color?: string;
} = {}) {
  try {
    if (!EMAIL.test(String(to ?? ""))) return { ok: false, skipped: true, error: "No guest address" };
    const lang: TicketLang = opts.lang && TICKET[opts.lang] ? opts.lang : "en";
    const t = TICKET[lang];
    const facility = facilityName(String(booking.kind), lang, booking.resource_name);
    const when = slotLabel(booking.starts_at, booking.ends_at, lang);
    const fill = (s: string) => s.replace("{facility}", facility).replace("{when}", when);
    const color = /^#[0-9a-f]{6}$/i.test(String(opts.color)) ? String(opts.color) : "#0f766e";
    const cancelled = opts.event === "cancelled";
    const row = (label: string, value: string) =>
      `<tr><td style="padding:6px 14px 6px 0;color:#6b7280">${esc(label)}</td><td style="padding:6px 0;font-weight:600">${value}</td></tr>`;
    const html = `<!doctype html><html><body style="margin:0;background:#f5f3ef;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="text-align:center;font-size:18px;font-weight:700;color:${color};padding:8px 0 16px">${esc(booking.hotel_name ?? "")}</div>
<div style="background:#fff;border-radius:16px;padding:24px">
<p style="margin:0 0 16px;font-size:16px">${esc(fill(cancelled ? t.cancelled : t.intro))}</p>
${cancelled ? "" : `<div style="border:2px dashed ${color};border-radius:14px;padding:16px;text-align:center;margin-bottom:16px">
<div style="font-size:12px;letter-spacing:2px;color:#6b7280;text-transform:uppercase">${esc(t.ticket)}</div>
<div style="font-family:monospace;font-size:28px;font-weight:700;letter-spacing:3px;color:${color}">${esc(booking.ticket_code)}</div>
<div style="font-size:14px;margin-top:6px">${esc(facility)} · ${esc(when)}</div></div>`}
<table style="border-collapse:collapse;font-size:14px;width:100%">
${row(t.when, esc(when))}
${row(t.people, esc(booking.party_size))}
${booking.room_number ? row(t.room, esc(booking.room_number)) : ""}
${!cancelled && Number(booking.price ?? 0) === 0 ? row("", esc(t.free)) : ""}
</table>
${cancelled ? "" : `<p style="margin:16px 0 0;font-weight:600">${esc(t.show)}</p>`}
${opts.manageUrl ? `<p style="margin:20px 0 0;text-align:center"><a href="${esc(opts.manageUrl)}" style="color:${color};font-weight:600">${esc(t.manage)}</a></p>` : ""}
</div></div></body></html>`;
    return await sendEmail({
      admin: db, organizationSlug: booking.organization_slug, to: [to],
      subject: fill(cancelled ? t.cancelledSubject : t.subject), html,
      text: `${fill(cancelled ? t.cancelled : t.intro)} ${when}. ${t.ticket}: ${booking.ticket_code}. ${cancelled ? "" : t.show}`,
    });
  } catch (e) {
    console.error("wellness ticket e-mail failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "ticket failed" };
  }
}

/** Runs an e-mail task after the response without delaying the guest. */
export function afterResponse(task: Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) { runtime.waitUntil(task); return Promise.resolve(); }
  return task.then(() => undefined, () => undefined);
}
