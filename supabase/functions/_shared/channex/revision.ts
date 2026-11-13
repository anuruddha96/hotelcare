/**
 * Pure mapping of a Channex booking revision to a HotelCare action.
 * No I/O, so it is unit-tested with Vitest and reused by the webhook and feed worker.
 *
 * Rules (see docs/integrations/channex/SKILL_REVIEW.md):
 *   new        -> create reservation(s) (one per booked room). Unmapped room: still create and
 *                 block the calendar, plus a review case. An OTA booking is never dropped.
 *   cancelled  -> cancel the linked reservation(s); unknown booking -> review case.
 *   modified   -> durable review case for a person (no blind auto-apply to a live calendar).
 *
 * Hungarian / GDPR notes:
 *   - Only name, e-mail, phone and country are copied to the guest record (data minimisation).
 *     ID document data for VIZA is captured with the document reader at check-in, never from the OTA.
 *   - Card / guarantee data is removed before anything is stored.
 *   - OTA tax lines are kept for reference only; VAT (5% accommodation), IFA and TFH are calculated
 *     by HotelCare invoicing.
 */

export type RoomTypeMapping = { localRoomTypeId: string; name: string };
export type PlanContext = {
  hotelId: string;
  propertyId: string;
  currency: string;
  /** Channex room type UUID -> HotelCare room type */
  roomTypes: Map<string, RoomTypeMapping>;
};

export type PlannedRoom = {
  room_index: number;
  room_type_name: string | null;
  check_in_date: string;
  check_out_date: string;
  adults: number;
  children: number;
  total_amount: string;
  rate_per_night: string;
  currency: string;
  ota_taxes: unknown;
  notes: string | null;
};

export type PlannedGuest = {
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  payment_collect: string | null;
};

export type RevisionPlan =
  | { action: "new"; guest: PlannedGuest; rooms: PlannedRoom[]; reviewReason: string | null; reviewDetails: Record<string, unknown> }
  | { action: "cancelled"; reviewDetails: Record<string, unknown> }
  | { action: "review"; reviewReason: string; reviewDetails: Record<string, unknown> };

export type RevisionSummary = {
  revisionId: string;
  bookingId: string | null;
  propertyId: string | null;
  status: "new" | "modified" | "cancelled" | null;
  otaName: string | null;
  otaReservationCode: string | null;
  arrivalDate: string | null;
  departureDate: string | null;
};

const SENSITIVE_KEY = /(card|cvv|cvc|pan$|expir|guarantee|iban|account_number|security_code)/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Deep copy without card/guarantee data. Safe to persist. */
export function sanitizeRevisionPayload<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => sanitizeRevisionPayload(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) continue;
      out[k] = sanitizeRevisionPayload(v);
    }
    return out as T;
  }
  return value;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const date = (v: unknown): string | null => { const s = str(v); return s && DATE.test(s.slice(0, 10)) ? s.slice(0, 10) : null; };
const int = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

/** Revision API item {id, attributes} or a bare attributes object. */
export function revisionAttributes(rev: any): Record<string, any> {
  return (rev && typeof rev === "object" && rev.attributes && typeof rev.attributes === "object") ? rev.attributes : (rev ?? {});
}

export function summarizeRevision(rev: any): RevisionSummary {
  const a = revisionAttributes(rev);
  const status = str(a.status);
  return {
    revisionId: str(rev?.id) ?? str(a.id) ?? str(a.revision_id) ?? "",
    bookingId: str(a.booking_id),
    propertyId: str(a.property_id),
    status: status === "new" || status === "modified" || status === "cancelled" ? status : null,
    otaName: str(a.ota_name),
    otaReservationCode: str(a.ota_reservation_code),
    arrivalDate: date(a.arrival_date),
    departureDate: date(a.departure_date),
  };
}

/** "230.00" -> "230.00"; tolerant of numbers and >2 decimals (rounded half-up). */
export function moneyString(v: unknown): string {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return "0.00";
  return (Math.round(n * 100) / 100).toFixed(2);
}

const nights = (from: string, to: string) => Math.max(1, Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000));

export function planGuest(a: Record<string, any>): PlannedGuest {
  const c = (a.customer && typeof a.customer === "object") ? a.customer : {};
  let first = str(c.name);
  let last = str(c.surname);
  if (first && !last && first.includes(" ")) {
    const parts = first.split(/\s+/);
    last = parts.pop() ?? null;
    first = parts.join(" ");
  }
  const country = str(c.country);
  return {
    first_name: first ?? "OTA",
    last_name: last ?? "Guest",
    email: str(c.mail) ?? str(c.email),
    phone: str(c.phone),
    country: country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null,
    payment_collect: str(a.payment_collect),
  };
}

export function planRevision(rev: any, ctx: PlanContext): RevisionPlan {
  const a = revisionAttributes(rev);
  const s = summarizeRevision(rev);
  const base = {
    ota_name: s.otaName,
    ota_reservation_code: s.otaReservationCode,
    arrival_date: s.arrivalDate,
    departure_date: s.departureDate,
    amount: str(a.amount),
    currency: str(a.currency),
  };

  if (s.propertyId !== ctx.propertyId) {
    return { action: "review", reviewReason: "property_mismatch", reviewDetails: base };
  }

  if (s.status === "cancelled") return { action: "cancelled", reviewDetails: base };

  if (s.status === "modified") {
    return {
      action: "review",
      reviewReason: "ota_modification",
      reviewDetails: { ...base, rooms: roomSummaries(a, ctx) },
    };
  }

  if (s.status !== "new") {
    return { action: "review", reviewReason: "unknown_revision_status", reviewDetails: { ...base, status: str(a.status) } };
  }

  const rawRooms: any[] = Array.isArray(a.rooms) ? a.rooms : [];
  const currency = (str(a.currency) ?? ctx.currency).toUpperCase();
  const unmapped: string[] = [];
  const rooms: PlannedRoom[] = [];

  rawRooms.forEach((r, i) => {
    const checkIn = date(r?.checkin_date) ?? s.arrivalDate;
    const checkOut = date(r?.checkout_date) ?? s.departureDate;
    if (!checkIn || !checkOut || checkOut <= checkIn) return;
    const mapping = str(r?.room_type_id) ? ctx.roomTypes.get(String(r.room_type_id)) : undefined;
    if (!mapping) unmapped.push(str(r?.room_type_id) ?? `room ${i + 1}`);
    const total = moneyString(r?.amount ?? (rawRooms.length === 1 ? a.amount : 0));
    const occ = (r?.occupancy && typeof r.occupancy === "object") ? r.occupancy : {};
    rooms.push({
      room_index: i,
      room_type_name: mapping?.name ?? null,
      check_in_date: checkIn,
      check_out_date: checkOut,
      adults: Math.max(1, int(occ.adults, 1)),
      children: int(occ.children, 0) + int(occ.infants, 0),
      total_amount: total,
      rate_per_night: moneyString(Number(total) / nights(checkIn, checkOut)),
      currency,
      ota_taxes: sanitizeRevisionPayload(r?.taxes ?? null),
      notes: null,
    });
  });

  // No usable room lines: still hold the booking as one reservation on the booking dates.
  if (!rooms.length) {
    if (!s.arrivalDate || !s.departureDate || s.departureDate <= s.arrivalDate) {
      return { action: "review", reviewReason: "booking_without_dates", reviewDetails: base };
    }
    unmapped.push("no room lines");
    rooms.push({
      room_index: 0, room_type_name: null, check_in_date: s.arrivalDate, check_out_date: s.departureDate,
      adults: 1, children: 0, total_amount: moneyString(a.amount),
      rate_per_night: moneyString(Number(moneyString(a.amount)) / nights(s.arrivalDate, s.departureDate)),
      currency, ota_taxes: null, notes: null,
    });
  }

  const notes = str(a.notes);
  if (notes) rooms[0].notes = notes.slice(0, 2000);

  const currencyMismatch = currency !== ctx.currency.toUpperCase();
  const reasons = [
    unmapped.length ? "unmapped_room_type" : null,
    currencyMismatch ? "currency_mismatch" : null,
  ].filter(Boolean) as string[];

  return {
    action: "new",
    guest: planGuest(a),
    rooms,
    reviewReason: reasons.length ? reasons.join("+") : null,
    reviewDetails: { ...base, unmapped_room_types: unmapped, expected_currency: ctx.currency },
  };
}

function roomSummaries(a: Record<string, any>, ctx: PlanContext) {
  const rooms: any[] = Array.isArray(a.rooms) ? a.rooms : [];
  return rooms.map((r) => ({
    room_type: ctx.roomTypes.get(String(r?.room_type_id))?.name ?? null,
    checkin_date: date(r?.checkin_date),
    checkout_date: date(r?.checkout_date),
    amount: str(r?.amount),
    adults: r?.occupancy?.adults ?? null,
    children: r?.occupancy?.children ?? null,
  }));
}

/** Webhook body {event, payload: {booking_id, property_id, revision_id}, user_id, timestamp}. */
export function parseWebhook(body: any): { event: string; revisionId: string | null; propertyId: string | null; bookingId: string | null } {
  const payload = (body?.payload && typeof body.payload === "object") ? body.payload : {};
  return {
    event: str(body?.event) ?? "",
    revisionId: str(payload.revision_id),
    propertyId: str(payload.property_id),
    bookingId: str(payload.booking_id),
  };
}

export const BOOKING_EVENTS = new Set(["booking", "booking_new", "booking_modification", "booking_cancellation"]);
