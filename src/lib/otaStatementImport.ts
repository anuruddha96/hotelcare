// Reading OTA statements into ota_statement_lines.
//
// Supported files (first sheet, as exported by the extranets):
//   * Booking.com  Finance > Reservation statements (English export):
//       Reservation number | Booked on | Arrival | Departure | ... | Room nights |
//       Commission % | Original amount | Final amount | Commission amount | Status |
//       Currency | Hotel id | ...
//   * Agoda        earnings / payout report, English or Hungarian headers:
//       Booking ID | Lead guest name | Check-in | Check-out | Booking status | Currency |
//       Reference sell inclusive | Owed to Agoda | Payout amount | Invoice
//
// Guest and booker names are never read: only codes, dates, statuses and amounts.

export type StatementChannel = "booking_com" | "agoda";

export interface StatementLine {
  channel_key: StatementChannel;
  listing_ref: string;
  ota_reservation_code: string;
  booked_at: string | null;
  check_in: string | null;
  check_out: string | null;
  status: string | null;
  room_nights: number | null;
  commission_pct: number | null;
  original_amount: number | null;
  gross_amount: number | null;
  commission_amount: number | null;
  payout_amount: number | null;
  currency: string;
}

export interface ParsedStatement {
  channel: StatementChannel;
  lines: StatementLine[];
  /** Booking.com "Hotel id" values (OTA property ids) found in the file. */
  listingRefs: string[];
  /** Suggested statement period (YYYY-MM-DD): checkout month for Booking.com, payout date for Agoda. */
  period: string | null;
  skippedRows: number;
  currencies: string[];
}

export type ParseResult = { ok: true; statement: ParsedStatement } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** "1061.47", "1,061.47", "1.061,47", "1061,47", 1061.47 -> 1061.47 */
export function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let v = String(value).replace(/[^0-9.,-]/g, "");
  if (!v || v === "-") return null;
  const negative = v.startsWith("-");
  v = v.replace(/-/g, "");
  const lastComma = v.lastIndexOf(",");
  const lastDot = v.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    v = lastComma > lastDot ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  } else if (lastComma >= 0) {
    v = /^\d{1,3}(,\d{3})+$/.test(v) ? v.replace(/,/g, "") : v.replace(",", ".");
  }
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

const HU_MONTHS: Record<string, number> = {
  jan: 1, febr: 2, feb: 2, "márc": 3, marc: 3, "ápr": 4, apr: 4, "máj": 5, maj: 5, "jún": 6, jun: 6,
  "júl": 7, jul: 7, aug: 8, szept: 9, szep: 9, okt: 10, nov: 11, dec: 12,
};
const EN_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) =>
  y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null;

/** Excel serial, Date, ISO, "Oct 5, 2026", "2026. szept. 21.", "2026.10.20." -> YYYY-MM-DD */
export function parseDay(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : iso(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number") {
    if (value < 20000 || value > 80000) return null; // Excel serial day range 1954..2119
    const d = new Date(Math.round((value - 25569) * 86_400_000));
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})\.\s*([a-záéíóöőúüű]+)\.?\s*(\d{1,2})\.?/i);
  if (m) {
    const month = HU_MONTHS[m[2].toLowerCase()];
    return month ? iso(+m[1], month, +m[3]) : null;
  }
  m = s.match(/^([a-z]{3,4})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i);
  if (m) {
    const month = EN_MONTHS[m[1].toLowerCase()];
    return month ? iso(+m[3], month, +m[2]) : null;
  }
  m = s.match(/^(\d{1,2})\s+([a-z]{3,4})[a-z]*\.?\s+(\d{4})/i);
  if (m) {
    const month = EN_MONTHS[m[2].toLowerCase()];
    return month ? iso(+m[3], month, +m[1]) : null;
  }
  return null;
}

/** Booking.com "Booked on" keeps its time of day; everything else is a calendar day. */
function parseTimestamp(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const day = parseDay(value);
    return day ? `${day}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}` : null;
  }
  if (typeof value === "string") {
    const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/);
    if (m) return `${m[1]}T${m[2].length === 5 ? m[2] + ":00" : m[2]}`;
  }
  const day = parseDay(value);
  return day ? `${day}T00:00:00` : null;
}

function code(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = typeof value === "number" ? (Number.isInteger(value) ? String(value) : "") : String(value).trim();
  // Reservation codes carry digits; this also drops "Total" rows
  return /^[A-Za-z0-9-]{5,40}$/.test(s) && /\d{4}/.test(s) ? s : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Header maps
// ---------------------------------------------------------------------------

type Field =
  | "code" | "booked_at" | "check_in" | "check_out" | "status" | "room_nights" | "commission_pct"
  | "original_amount" | "gross_amount" | "commission_amount" | "payout_amount" | "owed" | "currency" | "listing_ref";

const BOOKING_HEADERS: Record<string, Field> = {
  "reservation number": "code",
  "booked on": "booked_at",
  arrival: "check_in",
  departure: "check_out",
  status: "status",
  "room nights": "room_nights",
  "commission %": "commission_pct",
  "original amount": "original_amount",
  "final amount": "gross_amount",
  "commission amount": "commission_amount",
  currency: "currency",
  "hotel id": "listing_ref",
};

const AGODA_HEADERS: Record<string, Field> = {
  "booking id": "code",
  "check-in": "check_in",
  "check-out": "check_out",
  "booking status": "status",
  currency: "currency",
  "reference sell inclusive": "gross_amount",
  "owed to agoda": "owed",
  "payout amount": "payout_amount",
  // Hungarian extranet / Excel copies
  "foglalási azonosító": "code",
  "bejelentkezés": "check_in",
  "kijelentkezés": "check_out",
  "a foglalás státusza": "status",
  "pénznem": "currency",
  "inkluzív értékesítési refenciaár": "gross_amount",
  "inkluzív értékesítési referenciaár": "gross_amount",
  "tartozás az agoda felé": "owed",
  "kifizetés összege": "payout_amount",
};

function headerMap(row: unknown[], dict: Record<string, Field>): Map<Field, number> {
  const map = new Map<Field, number>();
  row.forEach((cell, i) => {
    const field = dict[norm(cell)];
    if (field && !map.has(field)) map.set(field, i);
  });
  return map;
}

function findHeader(rows: unknown[][], dict: Record<string, Field>, required: Field[]) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const map = headerMap(rows[i] ?? [], dict);
    if (required.every((f) => map.has(f))) return { index: i, map };
  }
  return null;
}

function mode(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) if (c > bestCount || (c === bestCount && best !== null && v > best)) { best = v; bestCount = c; }
  return best;
}

function periodFromFileName(fileName: string): string | null {
  const m = fileName.match(/(20\d{2})[-_.](\d{2})(?:[-_.](\d{2}))?/);
  return m ? iso(+m[1], +m[2], m[3] ? +m[3] : 1) : null;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseBooking(rows: unknown[][], header: { index: number; map: Map<Field, number> }, fileName: string): ParsedStatement {
  const get = (row: unknown[], f: Field) => (header.map.has(f) ? row[header.map.get(f)!] : undefined);
  const lines: StatementLine[] = [];
  let skipped = 0;
  for (const row of rows.slice(header.index + 1)) {
    if (!row || row.every((c) => c === null || c === undefined || c === "")) continue;
    const ref = code(get(row, "code"));
    if (!ref) { skipped += 1; continue; }
    const gross = parseAmount(get(row, "gross_amount"));
    const commission = parseAmount(get(row, "commission_amount"));
    const pct = parseAmount(get(row, "commission_pct"));
    const listing = get(row, "listing_ref");
    lines.push({
      channel_key: "booking_com",
      listing_ref: listing === null || listing === undefined ? "" : String(typeof listing === "number" ? Math.round(listing) : listing).trim(),
      ota_reservation_code: ref,
      booked_at: parseTimestamp(get(row, "booked_at")),
      check_in: parseDay(get(row, "check_in")),
      check_out: parseDay(get(row, "check_out")),
      status: String(get(row, "status") ?? "").trim() || null,
      room_nights: (() => { const n = parseAmount(get(row, "room_nights")); return n === null ? null : Math.round(n); })(),
      commission_pct: pct,
      original_amount: parseAmount(get(row, "original_amount")),
      gross_amount: gross,
      commission_amount: commission,
      payout_amount: null,
      currency: (String(get(row, "currency") ?? "").trim() || "EUR").toUpperCase(),
    });
  }
  const checkoutMonths = lines.map((l) => l.check_out?.slice(0, 7)).filter((m): m is string => !!m);
  const periodMonth = mode(checkoutMonths);
  return {
    channel: "booking_com",
    lines,
    listingRefs: [...new Set(lines.map((l) => l.listing_ref).filter(Boolean))].sort(),
    period: periodMonth ? `${periodMonth}-01` : periodFromFileName(fileName),
    skippedRows: skipped,
    currencies: [...new Set(lines.map((l) => l.currency))].sort(),
  };
}

function parseAgoda(rows: unknown[][], header: { index: number; map: Map<Field, number> }, fileName: string): ParsedStatement {
  const get = (row: unknown[], f: Field) => (header.map.has(f) ? row[header.map.get(f)!] : undefined);
  const lines: StatementLine[] = [];
  let skipped = 0;
  for (const row of rows.slice(header.index + 1)) {
    if (!row || row.every((c) => c === null || c === undefined || c === "")) continue;
    const ref = code(get(row, "code"));
    const gross = parseAmount(get(row, "gross_amount"));
    if (!ref || gross === null) { skipped += 1; continue; }
    const payout = parseAmount(get(row, "payout_amount")) ?? 0;
    const owed = parseAmount(get(row, "owed")) ?? 0;
    // Agoda collects: payout = sell - commission. Hotel collects: the hotel owes the commission.
    const commission = round2(owed + (payout > 0 ? gross - payout : 0));
    lines.push({
      channel_key: "agoda",
      listing_ref: "",
      ota_reservation_code: ref,
      booked_at: null,
      check_in: parseDay(get(row, "check_in")),
      check_out: parseDay(get(row, "check_out")),
      status: String(get(row, "status") ?? "").replace(/\s+/g, " ").trim() || null,
      room_nights: null,
      commission_pct: gross > 0 ? round2((commission / gross) * 100) : null,
      original_amount: null,
      gross_amount: gross,
      commission_amount: commission,
      payout_amount: payout,
      currency: (String(get(row, "currency") ?? "").trim() || "EUR").toUpperCase(),
    });
  }
  // Payout date: the title row above the header ("2026.10.20. Agoda Gozsdu"), else the file name
  let period: string | null = null;
  for (const row of rows.slice(0, header.index)) {
    for (const cell of row ?? []) {
      const day = parseDay(typeof cell === "string" ? cell.trim() : cell);
      if (day) { period = day; break; }
    }
    if (period) break;
  }
  return {
    channel: "agoda",
    lines,
    listingRefs: [],
    period: period ?? periodFromFileName(fileName),
    skippedRows: skipped,
    currencies: [...new Set(lines.map((l) => l.currency))].sort(),
  };
}

/** `rows`: the first sheet as an array of rows (SheetJS sheet_to_json with header: 1). */
export function parseStatementRows(rows: unknown[][], fileName = ""): ParseResult {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "empty" };
  const booking = findHeader(rows, BOOKING_HEADERS, ["code", "gross_amount", "commission_amount"]);
  if (booking) {
    const statement = parseBooking(rows, booking, fileName);
    return statement.lines.length ? { ok: true, statement } : { ok: false, error: "no_lines" };
  }
  const agoda = findHeader(rows, AGODA_HEADERS, ["code", "gross_amount"]);
  if (agoda && (agoda.map.has("payout_amount") || agoda.map.has("owed"))) {
    const statement = parseAgoda(rows, agoda, fileName);
    return statement.lines.length ? { ok: true, statement } : { ok: false, error: "no_lines" };
  }
  return { ok: false, error: "unrecognised" };
}

export interface StatementTotals {
  lines: number;
  gross: number;
  commission: number;
  cancelled: number;
}

const CANCELLED = /cancel|lemond|töröl|no.?show/i;

export function isCancelledStatus(status: string | null | undefined): boolean {
  return !!status && CANCELLED.test(status);
}

export function statementTotals(lines: readonly StatementLine[]): StatementTotals {
  return lines.reduce<StatementTotals>((t, l) => ({
    lines: t.lines + 1,
    gross: t.gross + (l.gross_amount ?? 0),
    commission: t.commission + (l.commission_amount ?? 0),
    cancelled: t.cancelled + (isCancelledStatus(l.status) ? 1 : 0),
  }), { lines: 0, gross: 0, commission: 0, cancelled: 0 });
}

// ---------------------------------------------------------------------------
// Statement check (rows from revenue_ota_statement_check)
// ---------------------------------------------------------------------------

export interface StatementCheckRow {
  channel_key: string;
  listing_ref: string;
  statement_period: string;
  ota_reservation_code: string;
  status: string | null;
  booked_at: string | null;
  check_in: string | null;
  check_out: string | null;
  room_nights: number | null;
  statement_gross: number | null;
  statement_commission: number | null;
  statement_pct: number | null;
  payout_amount: number | null;
  currency: string;
  in_pms: boolean;
  pms_booking_ref: string | null;
  pms_status: string | null;
  note_total: number | null;
  note_commission: number | null;
  terms_pct: number | null;
  expected_commission: number | null;
}

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
};

export function toStatementCheckRow(raw: Record<string, unknown>): StatementCheckRow {
  return {
    channel_key: String(raw.channel_key ?? ""),
    listing_ref: String(raw.listing_ref ?? ""),
    statement_period: String(raw.statement_period ?? "").slice(0, 10),
    ota_reservation_code: String(raw.ota_reservation_code ?? ""),
    status: raw.status == null ? null : String(raw.status),
    booked_at: raw.booked_at == null ? null : String(raw.booked_at),
    check_in: raw.check_in == null ? null : String(raw.check_in).slice(0, 10),
    check_out: raw.check_out == null ? null : String(raw.check_out).slice(0, 10),
    room_nights: n(raw.room_nights),
    statement_gross: n(raw.statement_gross),
    statement_commission: n(raw.statement_commission),
    statement_pct: n(raw.statement_pct),
    payout_amount: n(raw.payout_amount),
    currency: String(raw.currency ?? "EUR").toUpperCase(),
    in_pms: raw.in_pms === true,
    pms_booking_ref: raw.pms_booking_ref == null ? null : String(raw.pms_booking_ref),
    pms_status: raw.pms_status == null ? null : String(raw.pms_status),
    note_total: n(raw.note_total),
    note_commission: n(raw.note_commission),
    terms_pct: n(raw.terms_pct),
    expected_commission: n(raw.expected_commission),
  };
}

export type CheckStatus = "ok" | "differs" | "rate_differs" | "cancelled_charged" | "not_in_pms" | "no_reference" | "no_charge";

export interface CheckResult {
  status: CheckStatus;
  /** What we expected: the Booking.com note, else the contract terms. */
  reference: number | null;
  referenceKind: "note" | "terms" | null;
  difference: number | null;
}

/** Tolerance: €1 or 1% of the expected commission, whichever is larger. */
export function checkStatementRow(r: StatementCheckRow): CheckResult {
  const charged = r.statement_commission ?? 0;
  const cancelled = isCancelledStatus(r.status);
  const noteRef = r.note_commission !== null && r.note_commission >= 0 ? r.note_commission : null;
  const reference = !cancelled ? (noteRef ?? r.expected_commission) : null;
  const referenceKind = !cancelled ? (noteRef !== null ? "note" : r.expected_commission !== null ? "terms" : null) : null;
  const difference = reference === null ? null : round2(charged - reference);
  if (cancelled) return { status: charged > 0.005 ? "cancelled_charged" : "no_charge", reference: null, referenceKind: null, difference: null };
  if (!r.in_pms) return { status: "not_in_pms", reference, referenceKind, difference };
  if (reference === null) return { status: "no_reference", reference, referenceKind, difference };
  const tolerance = Math.max(1, Math.abs(reference) * 0.01);
  if (Math.abs(charged - reference) > tolerance) return { status: "differs", reference, referenceKind, difference };
  if (r.statement_pct !== null && r.terms_pct !== null && Math.abs(r.statement_pct - r.terms_pct) > 0.5) {
    return { status: "rate_differs", reference, referenceKind, difference };
  }
  return { status: "ok", reference, referenceKind, difference };
}

export interface StatementSummary {
  key: string;
  channel_key: string;
  statement_period: string;
  listingRefs: string[];
  lines: number;
  charged: number;
  expected: number;
  flagged: number;
  notInPms: number;
  cancelledCharged: number;
}

export function summariseStatements(rows: readonly StatementCheckRow[]): StatementSummary[] {
  const map = new Map<string, StatementSummary>();
  for (const r of rows) {
    const key = `${r.channel_key}|${r.statement_period}`;
    const s = map.get(key) ?? {
      key, channel_key: r.channel_key, statement_period: r.statement_period, listingRefs: [],
      lines: 0, charged: 0, expected: 0, flagged: 0, notInPms: 0, cancelledCharged: 0,
    };
    const check = checkStatementRow(r);
    s.lines += 1;
    s.charged += r.statement_commission ?? 0;
    s.expected += check.reference ?? 0;
    if (check.status === "differs" || check.status === "rate_differs" || check.status === "cancelled_charged") s.flagged += 1;
    if (check.status === "not_in_pms") s.notInPms += 1;
    if (check.status === "cancelled_charged") s.cancelledCharged += 1;
    if (r.listing_ref && !s.listingRefs.includes(r.listing_ref)) s.listingRefs.push(r.listing_ref);
    map.set(key, s);
  }
  return [...map.values()].sort((a, b) => b.statement_period.localeCompare(a.statement_period) || a.channel_key.localeCompare(b.channel_key));
}
