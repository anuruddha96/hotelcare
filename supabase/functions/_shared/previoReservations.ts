// Shared Previo searchReservations XML parser.
//
// The parsing conventions here mirror the PROVEN parser in
// previo-revenue-sync (parseReservationNights): <reservation> blocks with
// <resId>, <statusId>, <term><from>/<to>, <price>, nested currency,
// <object><objId>/<name>, <objectKind><obkId>, <guest> blocks, <created>,
// channel tags and cancellation timestamps. Only fields that are actually
// present in the XML are returned — guest identity is NEVER invented.

export const PREVIO_CANCELLED_STATUS = 7;
export const PREVIO_NOSHOW_STATUS = 8;

export interface PrevioReservationRow {
  resId: string;
  /** Unique per room item of a multi-room booking: resId or `resId:objId[#n]`. */
  sourceRef: string;
  statusId: number;
  arrivalDate: string;   // YYYY-MM-DD
  departureDate: string; // YYYY-MM-DD, exclusive
  nights: number;
  objId: string | null;  // physical room id in Previo
  obkId: string | null;  // room type id in Previo
  roomName: string | null;
  guestsCount: number;
  /** Only set when the XML literally contains guest name tags. */
  guestName: string | null;
  guestEmail: string | null;
  note: string | null;
  totalPrice: number | null;
  currency: string | null;
  channel: string | null;
  createdAtIso: string | null;
  cancelledAtIso: string | null;
}

/* ---------------- XML utilities (same conventions as previo-revenue-sync) -- */

export function grab(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

export function grabAttr(block: string, tag: string, attr: string): string | null {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1].trim() : null;
}

export function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000,
  );
}

/** Previo returns "YYYY-MM-DD HH:MM:SS" in hotel-local (Budapest) time. */
export function pmsTimestampToIso(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (!m) return null;
  const naive = Date.parse(`${m[1]}T${m[2]}Z`);
  const probe = new Date(naive);
  const tzName = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Budapest",
    timeZoneName: "shortOffset",
  }).formatToParts(probe).find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const off = /GMT([+-]\d+)/.exec(tzName);
  const hours = off ? parseInt(off[1], 10) : 1;
  return new Date(naive - hours * 3600000).toISOString();
}

/** Pull the ISO 4217 code out of whatever Previo returned ("9 HUF", "<code>EUR</code>", "eur"). */
export function normaliseCurrencyCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/<[^>]*>/g, " ").toUpperCase();
  const match = cleaned.match(/\b(EUR|HUF|USD|GBP|CZK|PLN|CHF|RON|SEK|NOK|DKK)\b/);
  if (match) return match[1];
  const numeric = cleaned.replace(/[^0-9]/g, "");
  const byId: Record<string, string> = { "1": "CZK", "2": "EUR", "3": "USD", "5": "GBP", "9": "HUF" };
  if (numeric && byId[numeric]) return byId[numeric];
  const bare = cleaned.trim();
  return /^[A-Z]{3}$/.test(bare) ? bare : null;
}

function cleanText(raw: string | null): string | null {
  if (raw == null) return null;
  const t = raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return t || null;
}

/* ---------------- Reservation parser ---------------------------------- */

/**
 * Parse one searchReservations XML document into reservation rows.
 * Multi-room bookings arrive as several <reservation> blocks sharing one
 * resId — each room item gets its own stable sourceRef.
 */
export function parsePrevioReservations(xml: string): PrevioReservationRow[] {
  const out: PrevioReservationRow[] = [];
  const perRes = new Map<string, number>();
  const seenRoomKey = new Map<string, number>();

  // First pass: count blocks per resId so single-room bookings keep a plain ref.
  const rawBlocks = blocks(xml, "reservation");
  for (const r of rawBlocks) {
    const resId = grab(r, "resId");
    if (!resId) continue;
    perRes.set(resId, (perRes.get(resId) ?? 0) + 1);
  }

  for (const r of rawBlocks) {
    const resId = grab(r, "resId");
    if (!resId) continue;

    const term = grab(r, "term") ?? "";
    const from = (grab(term, "from") ?? "").slice(0, 10);
    const to = (grab(term, "to") ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) continue;
    const nights = Math.max(1, daysBetween(from, to));

    const statusId = parseInt(grab(r, "statusId") ?? "0", 10) || 0;
    const isCancelled = statusId === PREVIO_CANCELLED_STATUS || statusId === PREVIO_NOSHOW_STATUS;

    const objectBlock = grab(r, "object") ?? "";
    const objId = grab(objectBlock, "objId") ?? grab(r, "objId");
    const obkId = grab(grab(r, "objectKind") ?? "", "obkId") ?? grab(r, "obkId");
    const roomName = cleanText(grab(objectBlock, "name"));

    const total = parseFloat(grab(r, "price") ?? "");
    const currencyRaw =
      grab(r, "currency") ?? grab(r, "currencyCode") ?? grab(r, "curr") ??
      grabAttr(r, "price", "currency") ?? grabAttr(r, "price", "code") ?? null;
    const currency = normaliseCurrencyCode(currencyRaw);

    const guestBlocks = blocks(r, "guest");
    const guestsCount = guestBlocks.length || 1;
    let guestName: string | null = null;
    let guestEmail: string | null = null;
    if (guestBlocks.length > 0) {
      const g = guestBlocks[0];
      const first = cleanText(grab(g, "name") ?? grab(g, "firstName") ?? grab(g, "firstname"));
      const last = cleanText(grab(g, "surname") ?? grab(g, "lastName") ?? grab(g, "lastname"));
      const joined = [first, last].filter(Boolean).join(" ").trim();
      guestName = joined || null;
      const email = cleanText(grab(g, "email"));
      guestEmail = email && /.+@.+\..+/.test(email) ? email : null;
    }

    const note = cleanText(grab(r, "note"));
    const created = pmsTimestampToIso(grab(r, "created"));
    const sourceRaw =
      grab(r, "sourceName") ?? grab(r, "source") ?? grab(r, "partner") ??
      grab(r, "channel") ?? grab(r, "marketCode") ?? null;
    const channel = cleanText(sourceRaw);
    const cancelledAtIso = isCancelled
      ? pmsTimestampToIso(
          grab(r, "dateCanc") ?? grab(r, "canceled") ?? grab(r, "cancelled") ??
          grab(r, "changed") ?? grab(r, "modified") ?? grab(r, "created"),
        )
      : null;

    // Stable per-room-item ref for multi-room bookings.
    let sourceRef = resId;
    if ((perRes.get(resId) ?? 1) > 1) {
      const baseKey = objId ?? obkId ?? "room";
      const seen = seenRoomKey.get(`${resId}|${baseKey}`) ?? 0;
      seenRoomKey.set(`${resId}|${baseKey}`, seen + 1);
      sourceRef = seen === 0 ? `${resId}:${baseKey}` : `${resId}:${baseKey}#${seen}`;
    }

    out.push({
      resId,
      sourceRef,
      statusId,
      arrivalDate: from,
      departureDate: to,
      nights,
      objId: objId || null,
      obkId: obkId || null,
      roomName,
      guestsCount,
      guestName,
      guestEmail,
      note,
      totalPrice: Number.isFinite(total) ? total : null,
      currency,
      channel,
      createdAtIso: created,
      cancelledAtIso,
    });
  }
  return out;
}

/**
 * Map a Previo statusId to a HotelCare reservation status. Only the two
 * status ids proven in existing code (7 = cancelled, 8 = no-show) are mapped
 * to terminal states; everything else is treated as a live confirmed booking.
 * Local operational states (checked_in / checked_out) are preserved by the
 * importer and never derived here.
 */
export function mapPrevioStatus(statusId: number): "cancelled" | "no_show" | "confirmed" {
  if (statusId === PREVIO_CANCELLED_STATUS) return "cancelled";
  if (statusId === PREVIO_NOSHOW_STATUS) return "no_show";
  return "confirmed";
}
