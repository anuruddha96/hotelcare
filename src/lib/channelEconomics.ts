// Channel economics: what each channel really brings in.
//
// Rows come from the `revenue_channel_economics` RPC: one row per stay date and
// booking, already split into city tax, gross revenue (what the guest paid,
// excl. city tax), OTA commission and net revenue (what the hotel keeps).
//
//   Booked value in the PMS
//   − city tax
//   = revenue in the PMS excl. city tax
//   + commission the net-rate OTAs (Expedia Collect, most Agoda) already kept
//   = gross revenue
//   − OTA commission
//   = net revenue
//
// The same rows work for Previo hotels today and HotelCare-PMS hotels later;
// the database decides where the nights come from.

export type CommissionSource = "statement" | "channex" | "ota_note" | "terms" | "no_commission" | "none";
export type AmountBasis = "gross" | "net";
export type ChannelType = "ota" | "wholesale" | "direct" | "other";

/** Exact commission: from the OTA itself, not from our contract table. */
export const EXACT_SOURCES: readonly CommissionSource[] = ["statement", "channex", "ota_note"];

export interface EconomicsRow {
  stay_date: string;
  booking_ref: string;
  ota_code: string | null;
  data_source: "previo" | "hotelcare";
  channel_key: string;
  channel_type: ChannelType;
  booked_on: string | null;
  room_nights: number;
  priced_nights: number;
  amount: number;
  city_tax: number;
  revenue_ex_tax: number;
  gross_revenue: number;
  /** null = commission unknown (OTA without terms). */
  commission: number | null;
  net_revenue: number;
  amount_basis: AmountBasis;
  commission_source: CommissionSource;
  /** Rate on the commissionable room value, 0.18 = 18%. */
  commission_rate: number | null;
  rate_label: string | null;
  meal_plan: string | null;
  payout_type: string | null;
  currency: string;
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

const SOURCES: CommissionSource[] = ["statement", "channex", "ota_note", "terms", "no_commission", "none"];
const TYPES: ChannelType[] = ["ota", "wholesale", "direct", "other"];

/** PostgREST may send numerics as strings; normalise once at the edge. */
export function toEconomicsRow(raw: Record<string, unknown>): EconomicsRow {
  const source = String(raw.commission_source ?? "none") as CommissionSource;
  const type = String(raw.channel_type ?? "other") as ChannelType;
  return {
    stay_date: String(raw.stay_date ?? "").slice(0, 10),
    booking_ref: String(raw.booking_ref ?? ""),
    ota_code: str(raw.ota_code),
    data_source: raw.data_source === "hotelcare" ? "hotelcare" : "previo",
    channel_key: String(raw.channel_key ?? "other"),
    channel_type: TYPES.includes(type) ? type : "other",
    booked_on: str(raw.booked_on),
    room_nights: num(raw.room_nights),
    priced_nights: num(raw.priced_nights),
    amount: num(raw.amount),
    city_tax: num(raw.city_tax),
    revenue_ex_tax: num(raw.revenue_ex_tax),
    gross_revenue: num(raw.gross_revenue),
    commission: numOrNull(raw.commission),
    net_revenue: num(raw.net_revenue),
    amount_basis: raw.amount_basis === "net" ? "net" : "gross",
    commission_source: SOURCES.includes(source) ? source : "none",
    commission_rate: numOrNull(raw.commission_rate),
    rate_label: str(raw.rate_label),
    meal_plan: str(raw.meal_plan),
    payout_type: str(raw.payout_type),
    currency: (str(raw.currency) ?? "EUR").toUpperCase(),
  };
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export interface ChannelMeta {
  key: string;
  label: string;
  labelHu: string;
  type: ChannelType;
  /** For chart axes. */
  short?: string;
  shortHu?: string;
}

const META: ChannelMeta[] = [
  { key: "booking_com", label: "Booking.com", labelHu: "Booking.com", type: "ota" },
  { key: "expedia", label: "Expedia", labelHu: "Expedia", type: "ota" },
  { key: "agoda", label: "Agoda", labelHu: "Agoda", type: "ota" },
  { key: "hotelbeds", label: "HotelBeds", labelHu: "HotelBeds", type: "wholesale" },
  { key: "edreams", label: "eDreams", labelHu: "eDreams", type: "ota" },
  { key: "trip_com", label: "Trip.com", labelHu: "Trip.com", type: "ota" },
  // Airbnb hotel bookings reach Previo through HotelTonight (same company)
  { key: "hoteltonight", label: "Airbnb (HotelTonight)", labelHu: "Airbnb (HotelTonight)", type: "ota", short: "Airbnb (HT)", shortHu: "Airbnb (HT)" },
  { key: "airbnb", label: "Airbnb", labelHu: "Airbnb", type: "ota" },
  { key: "direct_web", label: "Website (booking engine)", labelHu: "Weboldal (foglalómotor)", type: "direct", short: "Website", shortHu: "Weboldal" },
  { key: "google", label: "Google (free booking links)", labelHu: "Google (ingyenes foglalási linkek)", type: "direct", short: "Google", shortHu: "Google" },
  { key: "direct", label: "Direct / no source", labelHu: "Közvetlen / forrás nélkül", type: "direct", short: "Direct", shortHu: "Közvetlen" },
  { key: "relocation", label: "Relocation", labelHu: "Áthelyezés", type: "other" },
  { key: "penalty", label: "No-show / penalty", labelHu: "No-show / kötbér", type: "other", short: "No-show", shortHu: "No-show" },
  { key: "other", label: "Other", labelHu: "Egyéb", type: "other" },
];

const META_BY_KEY = new Map(META.map((m) => [m.key, m]));

export function channelMeta(key: string): ChannelMeta {
  return META_BY_KEY.get(key) ?? { key, label: key, labelHu: key, type: "other" };
}

export function channelLabel(key: string, hu = false): string {
  const meta = channelMeta(key);
  return hu ? meta.labelHu : meta.label;
}

export function channelShortLabel(key: string, hu = false): string {
  const meta = channelMeta(key);
  return (hu ? meta.shortHu : meta.short) ?? (hu ? meta.labelHu : meta.label);
}

/** Channels a commission-terms row can be added for. */
export const TERMS_CHANNELS: readonly string[] = META.filter((m) => m.type === "ota" || m.type === "wholesale" || m.key === "google").map((m) => m.key);

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export interface EconomicsTotals {
  roomNights: number;
  pricedNights: number;
  bookings: number;
  amount: number;
  cityTax: number;
  revenueExTax: number;
  grossRevenue: number;
  /** Known commission (exact + estimated). */
  commission: number;
  commissionExact: number;
  commissionEstimated: number;
  /** Part of the commission the net-rate OTAs kept before paying the hotel. */
  commissionWithheld: number;
  netRevenue: number;
  /** Gross revenue of OTA bookings whose commission is unknown (no terms yet). */
  unknownGross: number;
  /** Gross revenue of OTA and wholesale channels. */
  otaGross: number;
}

export function emptyTotals(): EconomicsTotals {
  return {
    roomNights: 0, pricedNights: 0, bookings: 0, amount: 0, cityTax: 0, revenueExTax: 0, grossRevenue: 0,
    commission: 0, commissionExact: 0, commissionEstimated: 0, commissionWithheld: 0, netRevenue: 0,
    unknownGross: 0, otaGross: 0,
  };
}

function accumulate(t: EconomicsTotals, r: EconomicsRow): void {
  t.roomNights += r.room_nights;
  t.pricedNights += r.priced_nights;
  t.amount += r.amount;
  t.cityTax += r.city_tax;
  t.revenueExTax += r.revenue_ex_tax;
  t.grossRevenue += r.gross_revenue;
  t.netRevenue += r.net_revenue;
  const commission = r.commission ?? 0;
  t.commission += commission;
  if (EXACT_SOURCES.includes(r.commission_source)) t.commissionExact += commission;
  else if (r.commission_source === "terms") t.commissionEstimated += commission;
  if (r.amount_basis === "net") t.commissionWithheld += commission;
  if (r.channel_type === "ota" || r.channel_type === "wholesale") {
    t.otaGross += r.gross_revenue;
    if (r.commission === null) t.unknownGross += r.gross_revenue;
  }
}

export function totalsOf(rows: readonly EconomicsRow[]): EconomicsTotals {
  const t = emptyTotals();
  const bookings = new Set<string>();
  for (const r of rows) {
    accumulate(t, r);
    bookings.add(r.booking_ref);
  }
  t.bookings = bookings.size;
  return t;
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

/** Commission as a share of gross revenue (what distribution costs). */
export const commissionShare = (t: EconomicsTotals) => ratio(t.commission, t.grossRevenue);
export const grossAdr = (t: EconomicsTotals) => ratio(t.grossRevenue, t.pricedNights);
export const netAdr = (t: EconomicsTotals) => ratio(t.netRevenue, t.pricedNights);
/** Share of the known commission that comes straight from the OTA. */
export const exactShare = (t: EconomicsTotals) => (t.commission > 0 ? t.commissionExact / t.commission : null);
/** Share of OTA revenue with no commission terms yet. */
export const unknownShare = (t: EconomicsTotals) => ratio(t.unknownGross, t.otaGross);

// ---------------------------------------------------------------------------
// By channel
// ---------------------------------------------------------------------------

export interface ChannelEconomics extends EconomicsTotals {
  key: string;
  type: ChannelType;
  basis: AmountBasis | "mixed";
  /** Where most of this channel's commission comes from. */
  mainSource: CommissionSource;
}

export function byChannel(rows: readonly EconomicsRow[]): ChannelEconomics[] {
  const groups = new Map<string, EconomicsRow[]>();
  for (const r of rows) {
    const list = groups.get(r.channel_key);
    if (list) list.push(r);
    else groups.set(r.channel_key, [r]);
  }
  const out: ChannelEconomics[] = [];
  for (const [key, list] of groups) {
    const t = totalsOf(list);
    const bases = new Set(list.map((r) => r.amount_basis));
    const bySource = new Map<CommissionSource, number>();
    for (const r of list) bySource.set(r.commission_source, (bySource.get(r.commission_source) ?? 0) + r.gross_revenue);
    let mainSource: CommissionSource = list[0]?.commission_source ?? "none";
    let best = -Infinity;
    for (const [source, gross] of bySource) {
      if (gross > best) { best = gross; mainSource = source; }
    }
    out.push({
      ...t,
      key,
      type: list[0]?.channel_type ?? channelMeta(key).type,
      basis: bases.size > 1 ? "mixed" : (list[0]?.amount_basis ?? "gross"),
      mainSource,
    });
  }
  return out.sort((a, b) => b.grossRevenue - a.grossRevenue || a.key.localeCompare(b.key));
}

/** How exact a channel's commission is, for one badge per channel. */
export type Certainty = "exact" | "mixed" | "estimated" | "unknown" | "none";

export function certaintyOf(t: EconomicsTotals, type: ChannelType): Certainty {
  if (type === "direct" || type === "other") return t.commission > 0 ? "estimated" : "none";
  if (t.unknownGross > 0 && t.unknownGross >= t.otaGross * 0.5) return "unknown";
  if (t.commission <= 0) return t.unknownGross > 0 ? "unknown" : "none";
  const share = t.commissionExact / t.commission;
  if (share >= 0.95 && t.unknownGross === 0) return "exact";
  if (share <= 0.05) return "estimated";
  return "mixed";
}

// ---------------------------------------------------------------------------
// By day
// ---------------------------------------------------------------------------

export interface DayEconomics {
  date: string;
  grossRevenue: number;
  commission: number;
  netRevenue: number;
  roomNights: number;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Every date in [from, to], zeros where nothing was sold, so the axis never skips a day. */
export function byDay(rows: readonly EconomicsRow[], from: string, to: string): DayEconomics[] {
  const map = new Map<string, DayEconomics>();
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    map.set(d, { date: d, grossRevenue: 0, commission: 0, netRevenue: 0, roomNights: 0 });
    if (map.size > 400) break;
  }
  for (const r of rows) {
    const day = map.get(r.stay_date);
    if (!day) continue;
    day.grossRevenue += r.gross_revenue;
    day.commission += r.commission ?? 0;
    day.netRevenue += r.net_revenue;
    day.roomNights += r.room_nights;
  }
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Booking.com rate plans (discount mix)
// ---------------------------------------------------------------------------

export type RateGroup =
  | "mobile" | "genius" | "non_refundable" | "early_booker" | "last_minute" | "deal" | "standard" | "unlabelled" | "other";

export const RATE_GROUP_LABEL: Record<RateGroup, { en: string; hu: string }> = {
  mobile: { en: "Mobile rate", hu: "Mobil ár" },
  genius: { en: "Genius", hu: "Genius" },
  non_refundable: { en: "Non-refundable", hu: "Vissza nem téríthető" },
  early_booker: { en: "Early booker", hu: "Korai foglalás" },
  last_minute: { en: "Last minute", hu: "Last minute" },
  deal: { en: "Deal / promotion", hu: "Akció / promóció" },
  standard: { en: "Standard / flexible", hu: "Normál / rugalmas" },
  unlabelled: { en: "No rate plan in note", hu: "Nincs díjcsomag a megjegyzésben" },
  other: { en: "Other plans", hu: "Egyéb díjcsomagok" },
};

/** Booking.com rate-plan name from the Previo note -> discount family. */
export function rateGroupOf(label: string | null | undefined): RateGroup {
  if (!label?.trim()) return "unlabelled";
  const l = label.toLowerCase();
  if (/genius/.test(l)) return "genius";
  if (/mobile/.test(l)) return "mobile";
  if (/non[\s-]?refund/.test(l)) return "non_refundable";
  if (/early|advance|\badv\b/.test(l)) return "early_booker";
  if (/last[\s-]?minute/.test(l)) return "last_minute";
  if (/deal|promo|offer|campaign|getaway|black friday|cyber|secret|private|limited/.test(l)) return "deal";
  if (/standard|flexib|refundable|\bbar\b|basic|best available/.test(l)) return "standard";
  return "other";
}

export interface RateGroupRow {
  group: RateGroup;
  roomNights: number;
  pricedNights: number;
  grossRevenue: number;
  netRevenue: number;
  bookings: number;
  /** Share of the channel's room nights. */
  share: number;
  adr: number | null;
  /** Distinct plan names seen in this group (for the tooltip). */
  labels: string[];
}

export function byRateGroup(rows: readonly EconomicsRow[], channelKey = "booking_com"): RateGroupRow[] {
  const list = rows.filter((r) => r.channel_key === channelKey);
  const total = list.reduce((s, r) => s + r.room_nights, 0);
  const groups = new Map<RateGroup, { rows: EconomicsRow[]; labels: Set<string> }>();
  for (const r of list) {
    const g = rateGroupOf(r.rate_label);
    const entry = groups.get(g) ?? { rows: [], labels: new Set<string>() };
    entry.rows.push(r);
    if (r.rate_label) entry.labels.add(r.rate_label);
    groups.set(g, entry);
  }
  return [...groups.entries()].map(([group, { rows: rs, labels }]) => {
    const t = totalsOf(rs);
    return {
      group,
      roomNights: t.roomNights,
      pricedNights: t.pricedNights,
      grossRevenue: t.grossRevenue,
      netRevenue: t.netRevenue,
      bookings: t.bookings,
      share: total > 0 ? t.roomNights / total : 0,
      adr: grossAdr(t),
      labels: [...labels].sort(),
    };
  }).sort((a, b) => b.roomNights - a.roomNights);
}

// ---------------------------------------------------------------------------
// By booking (drill-down, export)
// ---------------------------------------------------------------------------

export interface BookingEconomics {
  bookingRef: string;
  otaCode: string | null;
  channelKey: string;
  bookedOn: string | null;
  firstNight: string;
  lastNight: string;
  roomNights: number;
  amount: number;
  cityTax: number;
  grossRevenue: number;
  commission: number | null;
  netRevenue: number;
  basis: AmountBasis;
  source: CommissionSource;
  rate: number | null;
  rateLabel: string | null;
  mealPlan: string | null;
  payoutType: string | null;
}

export function byBooking(rows: readonly EconomicsRow[]): BookingEconomics[] {
  const map = new Map<string, BookingEconomics>();
  for (const r of rows) {
    const b = map.get(r.booking_ref);
    if (!b) {
      map.set(r.booking_ref, {
        bookingRef: r.booking_ref, otaCode: r.ota_code, channelKey: r.channel_key, bookedOn: r.booked_on,
        firstNight: r.stay_date, lastNight: r.stay_date, roomNights: r.room_nights, amount: r.amount,
        cityTax: r.city_tax, grossRevenue: r.gross_revenue, commission: r.commission, netRevenue: r.net_revenue,
        basis: r.amount_basis, source: r.commission_source, rate: r.commission_rate, rateLabel: r.rate_label,
        mealPlan: r.meal_plan, payoutType: r.payout_type,
      });
      continue;
    }
    if (r.stay_date < b.firstNight) b.firstNight = r.stay_date;
    if (r.stay_date > b.lastNight) b.lastNight = r.stay_date;
    b.roomNights += r.room_nights;
    b.amount += r.amount;
    b.cityTax += r.city_tax;
    b.grossRevenue += r.gross_revenue;
    b.commission = b.commission === null && r.commission === null ? null : (b.commission ?? 0) + (r.commission ?? 0);
    b.netRevenue += r.net_revenue;
  }
  return [...map.values()].sort((a, b) => a.firstNight.localeCompare(b.firstNight) || a.bookingRef.localeCompare(b.bookingRef));
}

// ---------------------------------------------------------------------------
// Monthly summary (revenue_channel_economics_monthly)
// ---------------------------------------------------------------------------

export interface MonthlyEconomicsRow {
  month: string; // YYYY-MM-01
  channel_key: string;
  channel_type: ChannelType;
  commission_source: CommissionSource;
  amount_basis: AmountBasis;
  currency: string;
  room_nights: number;
  priced_nights: number;
  bookings: number;
  amount: number;
  city_tax: number;
  revenue_ex_tax: number;
  gross_revenue: number;
  commission: number;
  net_revenue: number;
  unknown_commission_gross: number;
}

export function toMonthlyRow(raw: Record<string, unknown>): MonthlyEconomicsRow {
  const source = String(raw.commission_source ?? "none") as CommissionSource;
  const type = String(raw.channel_type ?? "other") as ChannelType;
  return {
    month: String(raw.month ?? "").slice(0, 10),
    channel_key: String(raw.channel_key ?? "other"),
    channel_type: TYPES.includes(type) ? type : "other",
    commission_source: SOURCES.includes(source) ? source : "none",
    amount_basis: raw.amount_basis === "net" ? "net" : "gross",
    currency: (str(raw.currency) ?? "EUR").toUpperCase(),
    room_nights: num(raw.room_nights),
    priced_nights: num(raw.priced_nights),
    bookings: num(raw.bookings),
    amount: num(raw.amount),
    city_tax: num(raw.city_tax),
    revenue_ex_tax: num(raw.revenue_ex_tax),
    gross_revenue: num(raw.gross_revenue),
    commission: num(raw.commission),
    net_revenue: num(raw.net_revenue),
    unknown_commission_gross: num(raw.unknown_commission_gross),
  };
}

export interface MonthEconomics {
  month: string; // YYYY-MM
  roomNights: number;
  pricedNights: number;
  grossRevenue: number;
  commission: number;
  commissionExact: number;
  netRevenue: number;
  unknownGross: number;
}

/** One entry per month in `months` (YYYY-MM), zero-filled; only `currency` rows count. */
export function monthlySeries(rows: readonly MonthlyEconomicsRow[], months: readonly string[], currency: string): MonthEconomics[] {
  const map = new Map<string, MonthEconomics>(months.map((m) => [m, {
    month: m, roomNights: 0, pricedNights: 0, grossRevenue: 0, commission: 0, commissionExact: 0, netRevenue: 0, unknownGross: 0,
  }]));
  for (const r of rows) {
    if (r.currency !== currency) continue;
    const m = map.get(r.month.slice(0, 7));
    if (!m) continue;
    m.roomNights += r.room_nights;
    m.pricedNights += r.priced_nights;
    m.grossRevenue += r.gross_revenue;
    m.commission += r.commission;
    if (EXACT_SOURCES.includes(r.commission_source)) m.commissionExact += r.commission;
    m.netRevenue += r.net_revenue;
    m.unknownGross += r.unknown_commission_gross;
  }
  return months.map((m) => map.get(m)!);
}

// ---------------------------------------------------------------------------
// Revenue bridge (PMS value -> net revenue)
// ---------------------------------------------------------------------------

export type BridgeKind = "total" | "minus" | "plus" | "result";

export interface BridgeStep {
  key: "pms" | "city_tax" | "pms_ex_tax" | "withheld" | "gross" | "commission" | "net";
  kind: BridgeKind;
  value: number;
}

export function revenueBridge(t: EconomicsTotals): BridgeStep[] {
  const steps: BridgeStep[] = [
    { key: "pms", kind: "total", value: t.amount },
    { key: "city_tax", kind: "minus", value: t.cityTax },
    { key: "pms_ex_tax", kind: "total", value: t.revenueExTax },
  ];
  if (t.commissionWithheld > 0.005) steps.push({ key: "withheld", kind: "plus", value: t.commissionWithheld });
  steps.push(
    { key: "gross", kind: "total", value: t.grossRevenue },
    { key: "commission", kind: "minus", value: t.commission },
    { key: "net", kind: "result", value: t.netRevenue },
  );
  return steps;
}

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function shiftMonth(month: string, offset: number): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 7);
}

export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  for (let m = first; m <= last && out.length < 36; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/** Only rows in the reporting currency are summed; the rest are reported, never mixed in. */
export function splitByCurrency(rows: readonly EconomicsRow[], currency: string) {
  const inCurrency: EconomicsRow[] = [];
  let otherRows = 0;
  const otherCurrencies = new Set<string>();
  for (const r of rows) {
    if (r.currency === currency) inCurrency.push(r);
    else { otherRows += 1; otherCurrencies.add(r.currency); }
  }
  return { rows: inCurrency, otherRows, otherCurrencies: [...otherCurrencies].sort() };
}
