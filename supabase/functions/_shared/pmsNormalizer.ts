// Shared PMS normalizer.
//
// Converts either (a) rows produced by the manual Excel PMS upload OR
// (b) a Previo REST API snapshot into a single canonical
// NormalizedSnapshot shape keyed by the PHYSICAL Previo roomId.
//
// This module is INTENTIONALLY pure and side-effect free. It has no
// Supabase, no fetch, no logging. It is safe to import from any edge
// function or from unit tests. Nothing in the existing manual-upload or
// previo-pms-sync path calls this yet — it is added now so the diff
// engine (E1) can consume a single shape regardless of source.

// ---------- Types ---------------------------------------------------------

export type StayKind = "checkout" | "daily" | "arrival" | "vacant" | "ooo";

export interface NormalizedRoom {
  /** Physical Previo roomId (string form for stable comparisons). */
  previo_room_id: string | null;
  /** Previo category / room-kind id — informational only, never the join key. */
  previo_room_kind_id: string | null;
  /** Human room number as shown to housekeepers, e.g. "305". */
  room_number: string;

  stay_kind: StayKind;

  guest_count: number;
  guest_nights_stayed: number;
  arrival_date: string | null;    // YYYY-MM-DD
  departure_date: string | null;  // YYYY-MM-DD

  linen_change_required: boolean;
  towel_change_required: boolean;

  notes: string | null;

  /** Original source row for audit / debugging. */
  raw: unknown;
}

export interface NormalizedSnapshot {
  hotel_id: string;
  business_date: string;   // YYYY-MM-DD
  source: "xlsx" | "api";
  rooms: NormalizedRoom[];
  /** Stable hash of the normalized rooms; used as an idempotency key. */
  content_hash: string;
}

// ---------- Public API ----------------------------------------------------

export interface NormalizeMeta {
  hotelId: string;
  businessDate: string;
  source: "xlsx" | "api";
}

export interface PrevioApiRow {
  roomId: number | string;
  name: string;
  roomKindId?: number | string;
  roomKindName?: string;
  roomCleanStatusId?: number;
  reservation?: {
    arrivalDate?: string;
    departureDate?: string;
    statusId?: number;
    guestsCount?: number;
    note?: string | null;
    /** Reception's internal/housekeeping note (preferred over OTA `note`). */
    internalNote?: string | null;
  } | null;
}

/** Loosely typed row emitted by the manual XLSX pipeline. */
export type XlsxRow = Record<string, unknown>;

export function normalize(
  input: XlsxRow[] | PrevioApiRow[],
  meta: NormalizeMeta,
): NormalizedSnapshot {
  const rooms = meta.source === "api"
    ? (input as PrevioApiRow[]).map((r) => normalizeApiRow(r, meta))
    : (input as XlsxRow[]).map((r) => normalizeXlsxRow(r, meta));

  // Sort by room_number for deterministic hash.
  rooms.sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));

  return {
    hotel_id: meta.hotelId,
    business_date: meta.businessDate,
    source: meta.source,
    rooms,
    content_hash: cheapHash(rooms),
  };
}

// ---------- API row → normalized ------------------------------------------

const SECTION_LABEL_RE = /\b(Syst[ée]m|Recepce|Reception|Kuchyn[ěe]|Kitchen|Housekeeping|Poznámka)\s*-\s*/gi;
const OTA_LABEL_RE = /^(Syst[ée]m)$/i;
const RESERVATION_BLOB_RE = /Booking\.com|Partner'?s room name|Commission note|Virtual [Cc]redit [Cc]ard|Cancellation Policy|Payment description|Payout type|Total price|Deposit Policy/i;
const PAYMENT_NOISE_RE = /\b(VCC\b[^.\n]*|Collect payment from guests[^.\n]*|Payment[^.\n]*|Virtual [Cc]redit [Cc]ard[^.\n]*)/gi;

function extractOperationalSections(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = String(raw)
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;039;|&#039;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const matches = Array.from(text.matchAll(SECTION_LABEL_RE));
  if (matches.length === 0) return RESERVATION_BLOB_RE.test(text) ? null : text;
  const kept: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const label = (m[1] || "").trim();
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const body = text.slice(start, end).trim();
    if (!body || OTA_LABEL_RE.test(label)) continue;
    // Trust the label — do NOT drop reception/kitchen sections just because
    // they mention "Booking.com" (common in reception CC notes).
    const cleaned = body.replace(PAYMENT_NOISE_RE, " ").replace(/\s+/g, " ").trim();
    if (cleaned) kept.push(`${label}: ${cleaned}`);
  }
  return kept.join(" • ") || null;
}


function normalizeApiRow(r: PrevioApiRow, meta: NormalizeMeta): NormalizedRoom {
  const previo_room_id = r.roomId != null ? String(r.roomId) : null;
  const previo_room_kind_id = r.roomKindId != null ? String(r.roomKindId) : null;
  const room_number = String(r.name ?? "").trim();

  const res = r.reservation ?? null;
  const arrival = res?.arrivalDate ? res.arrivalDate.slice(0, 10) : null;
  const departure = res?.departureDate ? res.departureDate.slice(0, 10) : null;
  const today = meta.businessDate;

  const isDeparting = !!departure && departure === today;
  const isCheckedOut = res?.statusId === 5 && isDeparting;
  const isArriving = !!arrival && arrival === today;
  const isStaying = !!arrival && !!departure && arrival <= today && departure > today;

  const stay_kind: StayKind = isCheckedOut || isDeparting
    ? "checkout"
    : isStaying
      ? "daily"
      : isArriving
        ? "arrival"
        : (r.roomCleanStatusId === 4 || r.roomCleanStatusId === 5)
          ? "ooo"
          : "vacant";

  const nightsTotal = arrival && departure ? diffDays(arrival, departure) : 0;
  const currentNight = arrival
    ? Math.min(nightsTotal, Math.max(1, diffDays(arrival, today) + (isDeparting ? 0 : 1)))
    : 0;

  return {
    previo_room_id,
    previo_room_kind_id,
    room_number,
    stay_kind,
    guest_count: res?.guestsCount ?? 0,
    guest_nights_stayed: currentNight,
    arrival_date: arrival,
    departure_date: departure,
    linen_change_required: requireLinen(currentNight, isDeparting),
    towel_change_required: requireTowel(currentNight, isDeparting),
    // HotelCare should display only Previo's operational housekeeping/reception
    // note. Previo concatenates all department tabs into `reservation.note`
    // with labels like `Systém -` (OTA blob), `Recepce -`, `Kuchyně -`. We
    // prefer `internalNote` when the tenant provides it, otherwise extract
    // only the non-Systém sections from the concatenated note.
    notes: (res?.internalNote && res.internalNote.trim()) || extractOperationalSections(res?.note ?? null),
    raw: r,
  };
}

// ---------- XLSX row → normalized -----------------------------------------
//
// The manual XLSX path has always been shape-flexible. We accept any of the
// canonical column names the client-side matcher already tolerates.

function pick(r: XlsxRow, ...keys: string[]): unknown {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null && r[k] !== "") return r[k];
  }
  return null;
}

function toStr(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function toNum(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function truthy(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  return s === "yes" || s === "y" || s === "true" || s === "1";
}

function parseNightsPair(v: unknown): { current: number; total: number } {
  const s = toStr(v);
  const m = s.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return { current: 0, total: 0 };
  return { current: parseInt(m[1], 10), total: parseInt(m[2], 10) };
}

function normalizeXlsxRow(r: XlsxRow, meta: NormalizeMeta): NormalizedRoom {
  const room_number = toStr(pick(r, "Room", "Room Number", "room_number"));
  const previo_room_id = toStr(pick(r, "RoomId", "roomId", "previo_room_id")) || null;
  const previo_room_kind_id = toStr(pick(r, "RoomKindId", "roomKindId")) || null;

  const departure = toStr(pick(r, "Departure", "Checkout", "CheckOut"));
  const arrival = toStr(pick(r, "Arrival", "Checkin", "CheckIn"));
  const occupied = truthy(pick(r, "Occupied"));
  const checkedOut = truthy(pick(r, "CheckedOut", "Checked Out"));
  const statusLabel = toStr(pick(r, "Status")).toLowerCase();

  const isDeparture = checkedOut || !!departure;
  const isArrival = !!arrival && !isDeparture;
  const isStaying = occupied && !isDeparture && !isArrival;

  const stay_kind: StayKind = isDeparture
    ? "checkout"
    : isStaying
      ? "daily"
      : isArrival
        ? "arrival"
        : statusLabel.includes("out of") ? "ooo" : "vacant";

  const { current, total } = parseNightsPair(pick(r, "Night / Total", "Nights", "nights"));

  const arrivalIso = arrival && meta.businessDate ? meta.businessDate : null;
  // For xlsx we usually don't have real arrival/departure dates — sentinel
  // to businessDate when the row indicates today's event, else null.
  const departureIso = isDeparture ? meta.businessDate : null;

  return {
    previo_room_id,
    previo_room_kind_id,
    room_number,
    stay_kind,
    guest_count: toNum(pick(r, "People", "Guests", "guest_count")),
    guest_nights_stayed: current,
    arrival_date: arrivalIso,
    departure_date: departureIso,
    linen_change_required: requireLinen(current, isDeparture),
    towel_change_required: requireTowel(current, isDeparture),
    notes: toStr(pick(r, "Note", "Notes", "notes")) || null,
    raw: r,
  };
}

// ---------- Rules (mirror check_towel_linen_requirements trigger) ----------

function requireTowel(currentNight: number, isCheckout: boolean): boolean {
  if (isCheckout) return currentNight >= 3;
  return currentNight === 3 || currentNight === 6 || currentNight === 9 || currentNight === 12 || currentNight === 15;
}

function requireLinen(currentNight: number, isCheckout: boolean): boolean {
  if (isCheckout) return currentNight >= 5;
  return currentNight === 5 || currentNight === 10 || currentNight === 15 || currentNight === 20;
}

// ---------- Helpers -------------------------------------------------------

function diffDays(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** Deterministic non-cryptographic hash — good enough for idempotency keys. */
function cheapHash(rooms: NormalizedRoom[]): string {
  // Pick only the fields that meaningfully change the operational picture.
  const payload = rooms.map((r) => [
    r.previo_room_id ?? "",
    r.room_number,
    r.stay_kind,
    r.guest_count,
    r.guest_nights_stayed,
    r.arrival_date ?? "",
    r.departure_date ?? "",
    r.linen_change_required ? 1 : 0,
    r.towel_change_required ? 1 : 0,
  ].join("|")).join("\n");

  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
