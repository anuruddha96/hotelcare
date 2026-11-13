// Shared Previo searchReservations XML parser.
//
// The parsing conventions here mirror the PROVEN parser in
// previo-revenue-sync (parseReservationNights): <reservation> blocks with
// <resId>, <statusId>, <term><from>/<to>, <price>, nested currency,
// <object><objId>/<name>, <objectKind><obkId>, <guest> blocks, <created>,
// channel tags and cancellation timestamps. Only fields that are actually
// present in the XML are returned — guest identity is NEVER invented.
//
// Two response shapes are supported, because both exist in the wild:
//   legacy:  <statusId>3</statusId>, <guest><name>/<surname>, <sourceName>
//   current: <status><statusId>3</statusId>…</status>, <guest><firstName>/<lastName>
//            …<guestCategory><name>Adult</name></guestCategory></guest>,
//            <partner><prpId>/<name>, <comId>, <voucher>, <cpsId>, <contactPerson>

export const PREVIO_OPTION_STATUS = 1;
export const PREVIO_CONFIRMED_STATUS = 2;
export const PREVIO_CHECKED_IN_STATUS = 3;
export const PREVIO_WAITING_LIST_STATUS = 6;
export const PREVIO_CANCELLED_STATUS = 7;
export const PREVIO_NOSHOW_STATUS = 8;
export const PREVIO_CHECKED_OUT_STATUS = 9;
export const PREVIO_OTHER_STATUS = 10;

export type PrevioPaymentStatus = "paid" | "unpaid" | "partial";
export type HotelCareReservationStatus =
  | "pending" | "confirmed" | "checked_in" | "checked_out" | "cancelled" | "no_show";

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
  /** Partner / sales channel name, e.g. "Booking.com". */
  channel: string | null;
  createdAtIso: string | null;
  cancelledAtIso: string | null;
  /** Previo room-reservation id (one per booked room). Stable when the room is moved. */
  comId: string | null;
  voucher: string | null;
  /** Payment state reported by Previo (cpsId): 1 paid, 2 unpaid, 3 partially paid. */
  paymentStatus: PrevioPaymentStatus | null;
  /** Previo partner id (prpId). */
  channelId: string | null;
  /** Previo rate plan id (prlId). */
  ratePlanId: string | null;
  optionExpiresAtIso: string | null;
  /** Previo "editationLocked": the reservation cannot be edited in Previo. */
  locked: boolean | null;
  groupNote: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  guestPhone: string | null;
  /** Every guest name literally present in the XML, in document order. */
  guestNames: string[];
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

/** Remove nested child blocks so a scalar lookup cannot hit a same-named tag inside them. */
export function stripBlocks(xml: string, tags: readonly string[]): string {
  let out = xml;
  for (const tag of tags) out = out.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g"), " ");
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
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return t || null;
}

function cleanId(raw: string | null): string | null {
  const t = (raw ?? "").trim();
  return /^\d{1,18}$/.test(t) ? t : null;
}

function cleanEmail(raw: string | null): string | null {
  const email = cleanText(raw);
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function parseBool(raw: string | null): boolean | null {
  const t = (raw ?? "").trim().toLowerCase();
  if (t === "1" || t === "true") return true;
  if (t === "0" || t === "false") return false;
  return null;
}

/** Child blocks of <guest> that carry their own <name>: never a person's name. */
const GUEST_NESTED_BLOCKS = ["guestCategory", "address", "identity", "country", "nationality", "tags", "tag"] as const;
/** Child blocks of <reservation> whose inner tags must not be read as reservation fields. */
const RESERVATION_NESTED_BLOCKS = ["guest", "contactPerson", "object", "objectKind", "partner"] as const;

function parseGuestBlock(block: string): { name: string | null; email: string | null; phone: string | null } {
  const flat = stripBlocks(block, GUEST_NESTED_BLOCKS);
  const first = cleanText(grab(flat, "firstName") ?? grab(flat, "firstname") ?? grab(flat, "name"));
  const last = cleanText(grab(flat, "lastName") ?? grab(flat, "lastname") ?? grab(flat, "surname"));
  const joined = [first, last].filter(Boolean).join(" ").trim();
  return { name: joined || null, email: cleanEmail(grab(flat, "email")), phone: cleanText(grab(flat, "phone")) };
}

/** Previo cpsId -> payment state. Unknown ids stay null (never guessed). */
export function mapPrevioPaymentStatus(cpsId: number | null | undefined): PrevioPaymentStatus | null {
  if (cpsId === 1) return "paid";
  if (cpsId === 2) return "unpaid";
  if (cpsId === 3) return "partial";
  return null;
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
  // resId|comId -> sourceRef already given to that room item in this response.
  const refByComId = new Map<string, string>();

  // First pass: count distinct room items per resId so single-room bookings keep
  // a plain ref. Blocks repeating the same comId are one room item, not two.
  const rawBlocks = blocks(xml, "reservation");
  const distinctItems = new Map<string, Set<string>>();
  rawBlocks.forEach((r, index) => {
    const resId = grab(r, "resId");
    if (!resId) return;
    const comId = cleanId(grab(stripBlocks(r, RESERVATION_NESTED_BLOCKS), "comId"));
    const items = distinctItems.get(resId) ?? new Set<string>();
    items.add(comId ? `c:${comId}` : `i:${index}`);
    distinctItems.set(resId, items);
  });
  for (const [resId, items] of distinctItems) perRes.set(resId, items.size);

  for (const r of rawBlocks) {
    const resId = grab(r, "resId");
    if (!resId) continue;

    // Reservation-level scalars are read from `top` so that a <note>, <email>
    // or <name> inside a guest/contact/partner block is never mistaken for one.
    const top = stripBlocks(r, RESERVATION_NESTED_BLOCKS);

    const term = grab(top, "term") ?? "";
    const from = (grab(term, "from") ?? "").slice(0, 10);
    const to = (grab(term, "to") ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) continue;
    const nights = Math.max(1, daysBetween(from, to));

    const statusId = parseInt(grab(top, "statusId") ?? "0", 10) || 0;
    const isCancelled = statusId === PREVIO_CANCELLED_STATUS || statusId === PREVIO_NOSHOW_STATUS;

    const objectBlock = grab(r, "object") ?? "";
    const objId = grab(objectBlock, "objId") ?? grab(top, "objId");
    const obkId = grab(grab(r, "objectKind") ?? "", "obkId") ?? grab(top, "obkId");
    const roomName = cleanText(grab(objectBlock, "name"));

    const total = parseFloat(grab(top, "price") ?? "");
    const currencyRaw =
      grab(top, "currency") ?? grab(top, "currencyCode") ?? grab(top, "curr") ??
      grabAttr(top, "price", "currency") ?? grabAttr(top, "price", "code") ?? null;
    const currency = normaliseCurrencyCode(currencyRaw);

    const guestBlocks = blocks(r, "guest");
    const guestsCount = guestBlocks.length || 1;
    const guests = guestBlocks.map(parseGuestBlock);
    const guestNames = guests.map((g) => g.name).filter((name): name is string => !!name);
    const guestName = guests[0]?.name ?? null;
    const guestEmail = guests[0]?.email ?? null;
    const guestPhone = guests[0]?.phone ?? null;

    const contactBlock = grab(r, "contactPerson") ?? "";
    const contactName = cleanText(grab(contactBlock, "name"));
    const contactEmail = cleanEmail(grab(contactBlock, "email"));
    const contactPhone = cleanText(grab(contactBlock, "phone"));

    const note = cleanText(grab(top, "note"));
    const groupNote = cleanText(grab(top, "gNote"));
    const created = pmsTimestampToIso(grab(top, "created"));

    // Channel: the structured <partner> block wins; legacy flat tags follow.
    const partnerBlock = grab(r, "partner");
    const partnerIsStructured = !!partnerBlock && /<[a-zA-Z]/.test(partnerBlock);
    const partnerName = partnerIsStructured ? cleanText(grab(partnerBlock!, "name")) : cleanText(partnerBlock);
    const channelId = partnerIsStructured ? cleanId(grab(partnerBlock!, "prpId")) : null;
    const channel = cleanChannelName(partnerName ?? cleanText(
      grab(top, "sourceName") ?? grab(top, "source") ?? grab(top, "channel") ?? grab(top, "marketCode") ?? null,
    ));

    const cancelledAtIso = isCancelled
      ? pmsTimestampToIso(
          grab(top, "cancellationDate") ?? grab(top, "dateCanc") ?? grab(top, "canceled") ??
          grab(top, "cancelled") ?? grab(top, "changed") ?? grab(top, "modified") ?? grab(top, "created"),
        )
      : null;

    const cpsRaw = parseInt(grab(top, "cpsId") ?? "", 10);
    const comId = cleanId(grab(top, "comId"));

    // Stable per-room-item ref for multi-room bookings. A repeated comId gets the
    // ref it already has, so the importer sees a duplicate instead of a new room.
    let sourceRef = resId;
    const knownRef = comId ? refByComId.get(`${resId}|${comId}`) : undefined;
    if (knownRef) sourceRef = knownRef;
    else if ((perRes.get(resId) ?? 1) > 1) {
      const baseKey = objId ?? obkId ?? "room";
      const seen = seenRoomKey.get(`${resId}|${baseKey}`) ?? 0;
      seenRoomKey.set(`${resId}|${baseKey}`, seen + 1);
      sourceRef = seen === 0 ? `${resId}:${baseKey}` : `${resId}:${baseKey}#${seen}`;
    }
    if (comId && !knownRef) refByComId.set(`${resId}|${comId}`, sourceRef);

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
      comId,
      voucher: cleanText(grab(top, "voucher")),
      paymentStatus: mapPrevioPaymentStatus(Number.isFinite(cpsRaw) ? cpsRaw : null),
      channelId,
      ratePlanId: cleanId(grab(top, "prlId")),
      optionExpiresAtIso: pmsTimestampToIso(grab(top, "optionExpiration")),
      locked: parseBool(grab(top, "editationLocked")),
      groupNote,
      contactName,
      contactEmail,
      contactPhone,
      guestPhone,
      guestNames,
    });
  }
  return out;
}

/**
 * Previo attaches the guests of a group booking to ONE room item; the other
 * items come back without guests. Returns resId -> first guest name found in
 * the group, so sibling rooms can show the same real name instead of nothing.
 */
export function groupGuestNames(rows: Iterable<PrevioReservationRow>): Map<string, string> {
  const names = new Map<string, string>();
  for (const row of rows) {
    if (row.guestName && !names.has(row.resId)) names.set(row.resId, row.guestName);
  }
  return names;
}

/**
 * A searchReservations range is a stay-overlap search: an extended stay may
 * appear in two adjacent chunks even though it is a single reservation.
 * Assign each booking to the chunk containing its ARRIVAL date. The first
 * chunk also admits bookings already in house at the start of the requested
 * import horizon. This prevents a duplicate booking with changed metadata in
 * an adjacent response from aborting the entire reservation refresh.
 *
 * Conflicting duplicate IDs within their owner chunk still fail closed.
 */
export function isReservationOwnedByImportChunk(
  arrivalDate: string,
  chunkFrom: string,
  chunkTo: string,
  firstChunk: boolean,
): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(arrivalDate)
    && arrivalDate < chunkTo
    && (firstChunk || arrivalDate >= chunkFrom);
}

/**
 * <term> element for Hotel.searchReservations. `termType` must sit INSIDE
 * <term>; outside of it Previo ignores it and searches by stay overlap.
 * "modified" (date of last change) is the incremental-sync search.
 */
export function buildReservationTermXml(
  from: string,
  to: string,
  termType: "overlap" | "modified" = "overlap",
): string {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(from) || !day.test(to) || from >= to) throw new Error("Invalid reservation search window");
  return termType === "overlap"
    ? `<term><from>${from}</from><to>${to}</to></term>`
    : `<term><from>${from}</from><to>${to}</to><termType>${termType}</termType></term>`;
}

/**
 * Map a Previo statusId to a HotelCare reservation status.
 *   1 option, 6 waiting list -> pending
 *   3 checked in             -> checked_in
 *   9 checked out            -> checked_out
 *   7 cancelled, 8 no-show   -> cancelled / no_show
 *   2 confirmed, 10 other and any unknown id -> confirmed (unchanged behaviour)
 * The raw id is stored alongside (pms_status_id) so option and waiting list
 * stay distinguishable in the UI.
 */
export function mapPrevioStatus(statusId: number): HotelCareReservationStatus {
  switch (statusId) {
    case PREVIO_OPTION_STATUS:
    case PREVIO_WAITING_LIST_STATUS:
      return "pending";
    case PREVIO_CHECKED_IN_STATUS:
      return "checked_in";
    case PREVIO_CHECKED_OUT_STATUS:
      return "checked_out";
    case PREVIO_CANCELLED_STATUS:
      return "cancelled";
    case PREVIO_NOSHOW_STATUS:
      return "no_show";
    default:
      return "confirmed";
  }
}

/**
 * Decide the stored status from the current HotelCare status and Previo's.
 *
 * Previo is the authority, with one protection: a check-in or check-out done
 * in HotelCare is never changed by an import, because HotelCare does not write
 * those to Previo yet and its check-out also releases the room for housekeeping.
 *
 * `checkedInByHotelCare` = the stay was checked in through HotelCare's own
 * check-in (actual_check_in is set). Such a stay stays "checked_in" until
 * reception checks it out in HotelCare. A stay that is only "checked_in"
 * because Previo said so follows Previo on to "checked_out".
 */
export function mergePrevioStatus(
  localStatus: string | null | undefined,
  statusId: number,
  checkedInByHotelCare = false,
): HotelCareReservationStatus {
  const mapped = mapPrevioStatus(statusId);
  if (localStatus === "checked_out") return "checked_out";
  if (localStatus === "checked_in") {
    return mapped === "checked_out" && !checkedInByHotelCare ? "checked_out" : "checked_in";
  }
  return mapped;
}

/* ---------------- Import merge helpers (pure, unit-tested) -------------- */

/** pms_* columns written by the importer. Kept in one place so reads, writes and change detection agree. */
export const PMS_RESERVATION_COLUMNS = [
  "pms_reservation_id",
  "pms_room_reservation_id",
  "pms_voucher",
  "pms_status_id",
  "pms_payment_status",
  "pms_channel",
  "pms_channel_id",
  "pms_rate_plan_id",
  "pms_option_expires_at",
  "pms_locked",
  "pms_group_note",
  "pms_contact_name",
  "pms_contact_email",
  "pms_contact_phone",
  "pms_paid_amount",
  "pms_missing_since",
] as const;

type StoredRow = Record<string, unknown>;

/**
 * Find the stored reservation a Previo room item belongs to.
 *
 * The Previo room-reservation id (comId) wins: it survives a room move, while
 * the legacy `resId:objId` reference of a multi-room booking does not. The
 * legacy reference is only trusted when the stored row is not already owned by
 * a different comId. `sourceRef` is the value to store in source_reservation_id.
 */
export function resolveImportTarget<T extends StoredRow>(
  row: Pick<PrevioReservationRow, "sourceRef" | "comId">,
  existingByComId: ReadonlyMap<string, T>,
  existingByRef: ReadonlyMap<string, T>,
): { existing: T | null; sourceRef: string } {
  if (row.comId) {
    const byComId = existingByComId.get(row.comId);
    if (byComId) return { existing: byComId, sourceRef: String(byComId.source_reservation_id ?? row.sourceRef) };
  }
  const byRef = existingByRef.get(row.sourceRef);
  if (!byRef) return { existing: null, sourceRef: row.sourceRef };
  const owner = String(byRef.pms_room_reservation_id ?? "").trim();
  if (!owner || !row.comId || owner === row.comId) return { existing: byRef, sourceRef: row.sourceRef };
  // The legacy reference now belongs to another room item: store this one under its own reference.
  return { existing: null, sourceRef: `${row.sourceRef}~${row.comId}` };
}

/**
 * Balance and payment status for an imported Previo booking.
 *
 * - Previo says paid -> nothing is due.
 * - Previo reported a paid amount (account check) -> balance = total - paid.
 *   When the stored balance itself came from Previo, it is not counted again.
 * - Otherwise the amount already settled in HotelCare is kept, except when the
 *   earlier "settled" state only came from Previo having reported paid before.
 */
export function mergePrevioFinancials(input: {
  total: number;
  paymentStatus: PrevioPaymentStatus | null;
  previoPaidAmount?: number | null;
  existingTotal?: number | null;
  existingBalance?: number | null;
  existingPmsPaymentStatus?: string | null;
  existingPmsPaidAmount?: number | string | null;
}): { balance: number; paymentStatus: "paid" | "partial" | "unpaid" } {
  const total = Number.isFinite(input.total) ? input.total : 0;
  if (input.paymentStatus === "paid") return { balance: 0, paymentStatus: "paid" };
  const hasExisting = input.existingTotal != null || input.existingBalance != null;
  const existingFromPrevio = input.existingPmsPaymentStatus === "paid" || input.existingPmsPaidAmount != null;
  let previouslyPaid = hasExisting
    ? Math.max(0, Number(input.existingTotal ?? 0) - Number(input.existingBalance ?? 0))
    : 0;
  if (input.existingPmsPaymentStatus === "paid") previouslyPaid = 0;
  const previoPaid = Number(input.previoPaidAmount);
  if (input.previoPaidAmount != null && Number.isFinite(previoPaid)) {
    previouslyPaid = Math.max(previoPaid, existingFromPrevio ? 0 : previouslyPaid);
  }
  const balance = Math.max(0, Math.round((total - previouslyPaid) * 100) / 100);
  const paymentStatus = balance <= 0 && total > 0
    ? "paid"
    : previouslyPaid > 0 || input.paymentStatus === "partial" ? "partial" : "unpaid";
  return { balance, paymentStatus };
}

/** Payment state from a Previo account (REST `account`): total and paid of the booking. */
export function paymentFromPrevioAccount(body: unknown): { total: number; paid: number; status: PrevioPaymentStatus } | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const account = (root.groupAccount && typeof root.groupAccount === "object" ? root.groupAccount : root) as Record<string, unknown>;
  const total = Number(account.total);
  const paid = Number(account.paid);
  if (!Number.isFinite(total) || !Number.isFinite(paid) || total < 0 || paid < 0) return null;
  const status: PrevioPaymentStatus = paid <= 0 ? "unpaid" : paid + 0.5 >= total ? "paid" : "partial";
  return { total, paid: Math.round(paid * 100) / 100, status };
}

/**
 * Previo appends technical suffixes to channel names ("Booking.com XML",
 * "AgodaXML", "HotelTonightV2XML"). Reception should read the brand.
 */
export function cleanChannelName(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const cleaned = text
    .replace(/\s*XML$/i, "")
    .replace(/V\d+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const known: Record<string, string> = { agoda: "Agoda", hoteltonight: "HotelTonight", expedia: "Expedia", airbnb: "Airbnb" };
  return known[cleaned.toLowerCase()] ?? (cleaned || text);
}

/**
 * Stored Previo bookings that a complete, successful full import did not
 * return: cancelled or deleted in Previo, or stored under an older reference
 * after a room move. They are hidden from the plan (pms_missing_since), never
 * deleted, and shown again automatically if Previo returns them later.
 *
 * Returns null when too many would be hidden at once, which means the import
 * itself is suspect rather than the bookings.
 */
export function bookingsMissingFromPrevio<T extends StoredRow>(input: {
  stored: Iterable<T>;
  returnedRefs: ReadonlySet<string>;
  setAsideRefs: ReadonlySet<string>;
  window: { from: string; to: string };
  incomingCount: number;
}): T[] | null {
  const live = new Set(["pending", "confirmed", "checked_in"]);
  const missing: T[] = [];
  let inWindow = 0;
  for (const row of input.stored) {
    const ref = String(row.source_reservation_id ?? "");
    const arrival = String(row.check_in_date ?? "");
    const departure = String(row.check_out_date ?? "");
    if (!ref || !(departure > input.window.from && arrival < input.window.to)) continue;
    inWindow++;
    if (input.returnedRefs.has(ref) || input.setAsideRefs.has(ref)) continue;
    if (!live.has(String(row.status ?? ""))) continue;
    if (row.actual_check_in != null || row.pms_missing_since != null) continue;
    missing.push(row);
  }
  const limit = Math.max(10, Math.ceil(Math.max(inWindow, input.incomingCount) * 0.2));
  return missing.length > limit ? null : missing;
}

/** True when every pms_* column of the stored row already equals the new record. */
export function pmsFieldsEqual(existing: StoredRow, record: StoredRow): boolean {
  for (const key of PMS_RESERVATION_COLUMNS) {
    const a = existing[key] ?? null;
    const b = record[key] ?? null;
    if (a === null || b === null) {
      if (a !== b) return false;
      continue;
    }
    if (key === "pms_option_expires_at" || key === "pms_missing_since") {
      if (Date.parse(String(a)) !== Date.parse(String(b))) return false;
    } else if (key === "pms_paid_amount") {
      if (Number(a) !== Number(b)) return false;
    } else if (String(a) !== String(b)) return false;
  }
  return true;
}

/** Previo answers 1030 while another call on the same API key is still running. Reads are safe to retry. */
export function isPrevioBusyResponse(result: { text?: string | null; errorMessage?: string | null }): boolean {
  return /\b1030\b|simultaneous/i.test(`${result.errorMessage ?? ""} ${(result.text ?? "").slice(0, 400)}`);
}

/* ---------------- Incoming booking triage (pure, unit-tested) ----------- */

export type RejectReason = "day_use" | "invalid" | "conflicting_duplicate";

/**
 * Collects the bookings of one import run and sets aside the few that cannot
 * be imported safely, instead of failing the whole run on one of them.
 *
 * - A zero-night booking (arrival on or after departure) has no place on a
 *   nightly room plan. Cancelled/no-show ones are ignored silently; live ones
 *   are reported as "day_use".
 * - Two copies of one booking reference with different contents: neither copy
 *   is trusted, the booking is left as currently stored and reported.
 *
 * `tooManyRejected()` keeps the old fail-closed behaviour for the case that
 * matters: many rejected rows mean the parser no longer understands Previo.
 */
export class IncomingBookingSet {
  readonly rows = new Map<string, PrevioReservationRow>();
  readonly rejected: Array<{ ref: string; reason: RejectReason; arrival: string | null }> = [];
  private readonly conflicted = new Set<string>();
  private seen = 0;

  add(row: PrevioReservationRow, sourceRef: string): void {
    this.seen++;
    if (!sourceRef || !/^\d{4}-\d{2}-\d{2}$/.test(row.arrivalDate) || !/^\d{4}-\d{2}-\d{2}$/.test(row.departureDate)) {
      this.rejected.push({ ref: sourceRef || "(blank)", reason: "invalid", arrival: row.arrivalDate || null });
      return;
    }
    if (row.arrivalDate >= row.departureDate) {
      const dead = row.statusId === PREVIO_CANCELLED_STATUS || row.statusId === PREVIO_NOSHOW_STATUS;
      if (!dead) this.rejected.push({ ref: sourceRef, reason: "day_use", arrival: row.arrivalDate });
      return;
    }
    if (this.conflicted.has(sourceRef)) return;
    const candidate = { ...row, sourceRef };
    const old = this.rows.get(sourceRef);
    if (old && JSON.stringify(old) !== JSON.stringify(candidate)) {
      this.rows.delete(sourceRef);
      this.conflicted.add(sourceRef);
      this.rejected.push({ ref: sourceRef, reason: "conflicting_duplicate", arrival: row.arrivalDate });
      return;
    }
    this.rows.set(sourceRef, candidate);
  }

  get size(): number {
    return this.rows.size;
  }

  /** More than 2% of rows (and more than 5) rejected: something is structurally wrong. */
  tooManyRejected(): boolean {
    const counted = this.rejected.filter((r) => r.reason !== "day_use").length;
    return counted > 5 && counted > this.seen * 0.02;
  }

  /** Short, privacy-safe summary for the response and the sync history (no guest data). */
  warnings(): string[] {
    const by = (reason: RejectReason) => this.rejected.filter((r) => r.reason === reason);
    const out: string[] = [];
    const dayUse = by("day_use");
    if (dayUse.length) out.push(`${dayUse.length} day-use booking(s) without an overnight stay were not imported`);
    const dup = by("conflicting_duplicate");
    if (dup.length) out.push(`${dup.length} booking(s) came back from Previo twice with different details and were left unchanged: ${dup.slice(0, 5).map((r) => r.ref).join(", ")}`);
    const invalid = by("invalid");
    if (invalid.length) out.push(`${invalid.length} booking(s) had no usable dates or reference and were not imported`);
    return out;
  }
}
