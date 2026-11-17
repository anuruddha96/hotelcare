/**
 * Jacuzzi / sauna slots shared by every channel: the guest's In-Suite page,
 * the website booking engine's manage page and the reception board. The
 * server (insuite_wellness_* SQL) owns every rule; this file only shapes and
 * formats what it returns. Times are always shown in hotel time.
 */
export const HOTEL_TZ = "Europe/Budapest";

export type WellnessKind = "jacuzzi" | "sauna";
export type WellnessSlotStatus = "free" | "booked" | "mine" | "past";
export type WellnessSource = "insuite" | "booking_engine" | "reception";

export type WellnessSlotBooking = {
  id: string;
  party_size: number;
  ticket_code: string;
  status: string;
  starts_at: string;
  ends_at: string;
  // staff view only
  guest_name?: string;
  room_number?: string | null;
  reservation_id?: string | null;
  source?: WellnessSource;
  key_handed_at?: string | null;
  notes?: string;
  created_at?: string;
};
export type WellnessSlot = { starts_at: string; ends_at: string; status: WellnessSlotStatus; booking?: WellnessSlotBooking };
export type WellnessDay = { date: string; open: boolean; slots: WellnessSlot[] };
export type WellnessResource = {
  id: string;
  kind: WellnessKind;
  name: string;
  description: string;
  image_url: string | null;
  slot_minutes: number;
  max_guests: number;
  opens_at: string;
  closes_at: string;
  weekdays: number[];
  max_per_day: number;
  price: number;
  currency: string;
  is_active: boolean;
  sort_order: number;
  days?: WellnessDay[];
};
export type WellnessStayBooking = {
  id: string;
  resource_id: string;
  resource_name: string;
  kind: WellnessKind;
  starts_at: string;
  ends_at: string;
  party_size: number;
  status: string;
  ticket_code: string;
  source: WellnessSource;
  reservation_id: string | null;
  room_number: string | null;
  can_cancel: boolean;
};
export type WellnessCalendar = { ok: boolean; from: string; to: string; resources: WellnessResource[] };
export type TransferPrice = { label: string; price: number; currency: string; note?: string };

/** "10:00" in hotel time. */
export function hotelTime(iso: string, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: HOTEL_TZ })
    .format(new Date(iso));
}

/** "10:00–11:00" in hotel time. */
export function slotRange(startsAt: string, endsAt: string, locale = "en-GB"): string {
  return `${hotelTime(startsAt, locale)}–${hotelTime(endsAt, locale)}`;
}

/** "Wed 18 Nov" for a YYYY-MM-DD hotel date (no time-zone drift). */
export function hotelDayLabel(date: string, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));
}

/** "Wed 18 Nov, 10:00–11:00" for a booking. */
export function bookingWhen(startsAt: string, endsAt: string, locale = "en-GB"): string {
  const day = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: HOTEL_TZ })
    .format(new Date(startsAt));
  return `${day}, ${slotRange(startsAt, endsAt, locale)}`;
}

/** Today's date in hotel time, YYYY-MM-DD. */
export function hotelToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: HOTEL_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const freeSlots = (day: WellnessDay | undefined) => (day?.slots ?? []).filter((s) => s.status === "free");

/** First day (from the list) that still has a free slot, else the first day. */
export function firstUsefulDay(resource: WellnessResource | undefined): string | null {
  const days = resource?.days ?? [];
  return (days.find((d) => freeSlots(d).length > 0) ?? days[0])?.date ?? null;
}

export function priceLabel(price: number, currency: string, freeLabel: string, locale = "en-GB"): string {
  if (!Number(price)) return freeLabel;
  try { return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(price)); }
  catch { return `${price} ${currency}`; }
}

export const SOURCE_LABEL: Record<WellnessSource, string> = {
  insuite: "Guest · In-Suite",
  booking_engine: "Guest · website link",
  reception: "Reception",
};

/** Server refusal codes the guest should see in plain words. */
export const WELLNESS_RETRY_CODES = new Set(["SLOT_TAKEN", "SLOT_PASSED"]);

// ---------------------------------------------------------------- words
export type WellnessLang = "en" | "hu" | "de" | "es" | "it" | "fr";
export const WELLNESS_LOCALES: Record<WellnessLang, string> = {
  en: "en-GB", hu: "hu-HU", de: "de-DE", es: "es-ES", it: "it-IT", fr: "fr-FR",
};

type Words = {
  title: string; subtitle: string; free: string; upTo: string; minutes: string; chooseDay: string; chooseTime: string;
  guests: string; book: string; confirming: string; taken: string; yours: string; closed: string; noSlots: string;
  ticket: string; showTicket: string; yourBookings: string; cancel: string; cancelConfirm: string; cancelled: string;
  slotTaken: string; when: string; people: string; room: string; booked: string; onePerDay: string; done: string;
  bookAnother: string; refresh: string; jacuzzi: string; sauna: string; pastSlots: string;
  today: string; slotsFree: string; partyOne: string; partyMany: string;
};

export const WELLNESS_WORDS: Record<WellnessLang, Words> = {
  en: {
    title: "Jacuzzi & sauna", subtitle: "Book a private slot. Free for hotel guests.", free: "Free", upTo: "Up to {n} guests",
    minutes: "{n} min", chooseDay: "Choose a day", chooseTime: "Choose a time", guests: "Guests", book: "Book {time}",
    confirming: "Confirming your slot…", taken: "Booked", yours: "Yours", closed: "Closed this day",
    noSlots: "No free slots left on this day.", ticket: "Ticket", showTicket: "Show this ticket at reception to collect the key.",
    yourBookings: "Your bookings", cancel: "Cancel booking", cancelConfirm: "Cancel this booking?", cancelled: "Booking cancelled",
    slotTaken: "Sorry, someone has just booked that slot. Please choose another time.", when: "When", people: "People",
    room: "Room", booked: "Booked! Your ticket is ready.", onePerDay: "One booking per facility per day.", done: "Done",
    bookAnother: "Book another slot", refresh: "Refresh", jacuzzi: "Jacuzzi", sauna: "Sauna", pastSlots: "Earlier slots have passed.", today: "Today", slotsFree: "{n} free", partyOne: "1 guest", partyMany: "{n} guests",
  },
  hu: {
    title: "Jakuzzi és szauna", subtitle: "Foglaljon privát időpontot. Szállodai vendégeinknek ingyenes.", free: "Ingyenes",
    upTo: "Legfeljebb {n} fő", minutes: "{n} perc", chooseDay: "Válasszon napot", chooseTime: "Válasszon időpontot",
    guests: "Fő", book: "Foglalás: {time}", confirming: "Időpont rögzítése…", taken: "Foglalt", yours: "Az Öné",
    closed: "Ezen a napon zárva", noSlots: "Erre a napra nincs több szabad időpont.", ticket: "Jegy",
    showTicket: "A kulcsot ennek a jegynek a felmutatásával veheti át a recepción.", yourBookings: "Foglalásai",
    cancel: "Foglalás lemondása", cancelConfirm: "Lemondja ezt a foglalást?", cancelled: "Foglalás lemondva",
    slotTaken: "Sajnáljuk, ezt az időpontot épp most foglalták le. Kérjük, válasszon másikat.", when: "Időpont",
    people: "Fő", room: "Szoba", booked: "Lefoglalva! A jegye elkészült.", onePerDay: "Létesítményenként naponta egy foglalás.",
    done: "Kész", bookAnother: "Újabb időpont", refresh: "Frissítés", jacuzzi: "Jakuzzi", sauna: "Szauna",
    pastSlots: "A korábbi időpontok elmúltak.", today: "Ma", slotsFree: "{n} szabad", partyOne: "1 fő", partyMany: "{n} fő",
  },
  de: {
    title: "Whirlpool & Sauna", subtitle: "Buchen Sie einen privaten Termin. Für Hotelgäste kostenlos.", free: "Kostenlos",
    upTo: "Bis zu {n} Gäste", minutes: "{n} Min.", chooseDay: "Tag wählen", chooseTime: "Uhrzeit wählen", guests: "Gäste",
    book: "{time} buchen", confirming: "Ihr Termin wird bestätigt…", taken: "Belegt", yours: "Ihr Termin",
    closed: "An diesem Tag geschlossen", noSlots: "An diesem Tag sind keine Termine mehr frei.", ticket: "Ticket",
    showTicket: "Zeigen Sie dieses Ticket an der Rezeption, um den Schlüssel zu erhalten.", yourBookings: "Ihre Buchungen",
    cancel: "Buchung stornieren", cancelConfirm: "Diese Buchung stornieren?", cancelled: "Buchung storniert",
    slotTaken: "Dieser Termin wurde gerade von jemand anderem gebucht. Bitte wählen Sie eine andere Zeit.", when: "Wann",
    people: "Personen", room: "Zimmer", booked: "Gebucht! Ihr Ticket ist bereit.", onePerDay: "Eine Buchung pro Einrichtung und Tag.",
    done: "Fertig", bookAnother: "Weiteren Termin buchen", refresh: "Aktualisieren", jacuzzi: "Whirlpool", sauna: "Sauna",
    pastSlots: "Frühere Termine sind vorbei.", today: "Heute", slotsFree: "{n} frei", partyOne: "1 Gast", partyMany: "{n} Gäste",
  },
  es: {
    title: "Jacuzzi y sauna", subtitle: "Reserve un turno privado. Gratis para huéspedes del hotel.", free: "Gratis",
    upTo: "Hasta {n} personas", minutes: "{n} min", chooseDay: "Elija un día", chooseTime: "Elija una hora", guests: "Personas",
    book: "Reservar {time}", confirming: "Confirmando su turno…", taken: "Ocupado", yours: "Suyo",
    closed: "Cerrado este día", noSlots: "No quedan turnos libres este día.", ticket: "Ticket",
    showTicket: "Muestre este ticket en recepción para recoger la llave.", yourBookings: "Sus reservas",
    cancel: "Cancelar reserva", cancelConfirm: "¿Cancelar esta reserva?", cancelled: "Reserva cancelada",
    slotTaken: "Lo sentimos, alguien acaba de reservar ese turno. Elija otra hora.", when: "Cuándo", people: "Personas",
    room: "Habitación", booked: "¡Reservado! Su ticket está listo.", onePerDay: "Una reserva por instalación y día.",
    done: "Listo", bookAnother: "Reservar otro turno", refresh: "Actualizar", jacuzzi: "Jacuzzi", sauna: "Sauna",
    pastSlots: "Los turnos anteriores ya han pasado.", today: "Hoy", slotsFree: "{n} libres", partyOne: "1 persona", partyMany: "{n} personas",
  },
  it: {
    title: "Jacuzzi e sauna", subtitle: "Prenoti un turno privato. Gratuito per gli ospiti dell'hotel.", free: "Gratis",
    upTo: "Fino a {n} persone", minutes: "{n} min", chooseDay: "Scelga un giorno", chooseTime: "Scelga un orario",
    guests: "Persone", book: "Prenota {time}", confirming: "Conferma del turno…", taken: "Occupato", yours: "Suo",
    closed: "Chiuso in questo giorno", noSlots: "Nessun turno libero in questo giorno.", ticket: "Biglietto",
    showTicket: "Mostri questo biglietto alla reception per ritirare la chiave.", yourBookings: "Le sue prenotazioni",
    cancel: "Cancella prenotazione", cancelConfirm: "Cancellare questa prenotazione?", cancelled: "Prenotazione cancellata",
    slotTaken: "Ci dispiace, qualcuno ha appena prenotato quel turno. Scelga un altro orario.", when: "Quando",
    people: "Persone", room: "Camera", booked: "Prenotato! Il suo biglietto è pronto.", onePerDay: "Una prenotazione per struttura al giorno.",
    done: "Fatto", bookAnother: "Prenota un altro turno", refresh: "Aggiorna", jacuzzi: "Jacuzzi", sauna: "Sauna",
    pastSlots: "I turni precedenti sono passati.", today: "Oggi", slotsFree: "{n} liberi", partyOne: "1 persona", partyMany: "{n} persone",
  },
  fr: {
    title: "Jacuzzi et sauna", subtitle: "Réservez un créneau privé. Gratuit pour les clients de l'hôtel.", free: "Gratuit",
    upTo: "Jusqu'à {n} personnes", minutes: "{n} min", chooseDay: "Choisissez un jour", chooseTime: "Choisissez une heure",
    guests: "Personnes", book: "Réserver {time}", confirming: "Confirmation de votre créneau…", taken: "Réservé",
    yours: "Le vôtre", closed: "Fermé ce jour-là", noSlots: "Plus de créneau libre ce jour-là.", ticket: "Ticket",
    showTicket: "Présentez ce ticket à la réception pour récupérer la clé.", yourBookings: "Vos réservations",
    cancel: "Annuler la réservation", cancelConfirm: "Annuler cette réservation ?", cancelled: "Réservation annulée",
    slotTaken: "Désolé, quelqu'un vient de réserver ce créneau. Choisissez une autre heure.", when: "Quand",
    people: "Personnes", room: "Chambre", booked: "Réservé ! Votre ticket est prêt.", onePerDay: "Une réservation par installation et par jour.",
    done: "Terminé", bookAnother: "Réserver un autre créneau", refresh: "Actualiser", jacuzzi: "Jacuzzi", sauna: "Sauna",
    pastSlots: "Les créneaux précédents sont passés.", today: "Aujourd'hui", slotsFree: "{n} libres", partyOne: "1 personne", partyMany: "{n} personnes",
  },
};

export function wellnessWords(lang: string | undefined): Words {
  return WELLNESS_WORDS[(lang as WellnessLang) in WELLNESS_WORDS ? (lang as WellnessLang) : "en"];
}

export const fillWord = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));

export function facilityLabel(kind: string, lang: string | undefined, fallback?: string): string {
  const w = wellnessWords(lang);
  return kind === "jacuzzi" ? w.jacuzzi : kind === "sauna" ? w.sauna : fallback ?? kind;
}
