// Pure helpers for the website booking engine (no I/O): types, guest
// distribution over rooms, totals, cancellation terms, colours and calendar
// export. The server re-checks everything; these only shape the page.
import { LOCALES, type BookingLang } from './i18n';

export interface EngineRatePlan {
  id: string;
  name: string;
  names: Partial<Record<BookingLang, string>>;
  meal_plan: string | null;
  refundable: boolean;
  free_cancellation_days: number;
}
export interface EngineRoomType {
  id: string;
  name: string;
  names: Partial<Record<BookingLang, string>>;
  max_adults: number;
  max_children: number;
  max_occupancy: number;
  size_sqm: number | null;
  beds: Partial<Record<BookingLang, string>>;
  description: Partial<Record<BookingLang, string>>;
  amenities: string[];
  photos: Array<{ url: string; path?: string }>;
  rate_plans: EngineRatePlan[];
}
export interface EngineConfig {
  engine: {
    id: string;
    enabled: boolean;
    name: string;
    logo_url: string | null;
    theme: { primary?: string; style?: 'classic' | 'modern' };
    languages: BookingLang[];
    default_language: BookingLang;
    contact: { email?: string; phone?: string; address?: string; website?: string };
    policies: {
      check_in_from?: string; check_out_until?: string; free_cancellation_days?: number;
      terms_url?: string; privacy_url?: string;
      city_tax_note?: Partial<Record<BookingLang, string>>; extra_note?: Partial<Record<BookingLang, string>>;
    };
    booking_window: { min_lead_days?: number; max_advance_days?: number; max_nights?: number; max_rooms?: number };
    today: string;
    currency: string | null;
  };
  room_types: EngineRoomType[];
}
export interface Offer {
  room_type_id: string;
  rate_plan_id: string;
  available: number;
  total: number;
  currency: string;
  nightly: Array<{ date: string; rate: number | null }>;
  min_stay: number | null;
  max_stay: number | null;
  blocked: null | 'no_rate' | 'stop_sell' | 'closed_to_arrival' | 'closed_to_departure' | 'min_stay' | 'max_stay' | 'sold_out';
}
export interface CalendarDay { date: string; open: boolean; from: number | null; cta: boolean; min_stay: number | null }
export interface Selection { roomTypeId: string; ratePlanId: string }
export interface RoomOccupancy { adults: number; children: number }

export const pick = <T extends string>(map: Partial<Record<BookingLang, T>> | undefined, lang: BookingLang, fallback = ''): string =>
  (map?.[lang] || map?.en || Object.values(map ?? {}).find(Boolean) || fallback) as string;

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.max(0, Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400000));
}

/** Local calendar date <-> ISO day, for the date picker. */
export const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fromIso = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };

export interface GuestDetails {
  first_name: string; last_name: string; email: string; phone: string; country: string;
  arrival_time: string; special_requests: string; marketing: boolean; terms: boolean;
}
export const EMPTY_GUEST: GuestDetails = {
  first_name: '', last_name: '', email: '', phone: '', country: '', arrival_time: '', special_requests: '', marketing: false, terms: false,
};

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Spread the party over the chosen rooms as evenly as the rooms allow:
 * every room gets one adult first, then adults and children round-robin
 * within each room's limits. Returns null when the party does not fit.
 */
export function distributeGuests(
  adults: number,
  children: number,
  rooms: Array<Pick<EngineRoomType, 'max_adults' | 'max_children' | 'max_occupancy'>>,
): RoomOccupancy[] | null {
  if (rooms.length === 0 || adults < rooms.length) return null;
  const out = rooms.map(() => ({ adults: 1, children: 0 }));
  if (rooms.some((room) => room.max_adults < 1 || room.max_occupancy < 1)) return null;
  const place = (count: number, kind: 'adults' | 'children') => {
    let left = count;
    while (left > 0) {
      let placed = false;
      for (let i = 0; i < rooms.length && left > 0; i++) {
        const room = rooms[i];
        const used = out[i].adults + out[i].children;
        const kindMax = kind === 'adults' ? room.max_adults : room.max_children;
        if (out[i][kind] < kindMax && used < room.max_occupancy) {
          out[i][kind] += 1;
          left -= 1;
          placed = true;
        }
      }
      if (!placed) return false;
    }
    return true;
  };
  if (!place(adults - rooms.length, 'adults')) return null;
  if (!place(children, 'children')) return null;
  return out;
}

/** The deadline shown for one rate: end of day N days before arrival, or null when non-refundable / already passed. */
export function freeCancellationDate(plan: Pick<EngineRatePlan, 'refundable' | 'free_cancellation_days'>, checkIn: string, today: string): string | null {
  if (!plan.refundable) return null;
  const date = addDaysIso(checkIn, -Math.max(0, plan.free_cancellation_days ?? 0));
  return date >= today ? date : null;
}

export function formatMoney(amount: number, currency: string, lang: BookingLang, whole = false): string {
  try {
    return new Intl.NumberFormat(LOCALES[lang], { style: 'currency', currency, ...(whole ? { maximumFractionDigits: 0, minimumFractionDigits: 0 } : {}) }).format(amount);
  } catch {
    return `${whole ? Math.round(amount) : amount.toFixed(2)} ${currency}`;
  }
}

export function formatDate(iso: string, lang: BookingLang, style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat(LOCALES[lang], style === 'long'
    ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }
    : { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

/** Hex brand colour (falls back to bronze) and a readable text colour on top of it. */
export function brandColors(primary: string | undefined): { primary: string; onPrimary: string; soft: string } {
  const hex = /^#[0-9a-f]{6}$/i.test(primary ?? '') ? primary! : '#8a6a3d';
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return { primary: hex, onPrimary: luminance > 0.45 ? '#111827' : '#ffffff', soft: `${hex}14` };
}

/** CSS hsl(...) or hex → hex, for defaults taken from hotel branding. */
export function toHex(color: string | null | undefined): string | null {
  if (!color) return null;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  const m = color.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/i);
  if (!m) return null;
  const h = Number(m[1]) / 360, s = Number(m[2]) / 100, l = Number(m[3]) / 100;
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${to(hue(p, q, h + 1 / 3))}${to(hue(p, q, h))}${to(hue(p, q, h - 1 / 3))}`;
}

/** Selections still possible: never more rooms of a type than are free. */
export function remainingOfType(offers: Offer[], selections: Selection[], roomTypeId: string): number {
  const available = Math.max(0, ...offers.filter((o) => o.room_type_id === roomTypeId).map((o) => o.available));
  return available - selections.filter((s) => s.roomTypeId === roomTypeId).length;
}

export function selectionTotal(offers: Offer[], selections: Selection[]): number {
  return selections.reduce((sum, s) => sum + (offers.find((o) => o.room_type_id === s.roomTypeId && o.rate_plan_id === s.ratePlanId)?.total ?? 0), 0);
}

/** Minimal iCalendar file so the guest can save the stay in their calendar. */
export function stayIcs(opts: { reference: string; hotel: string; address?: string; checkIn: string; checkOut: string }): string {
  const d = (iso: string) => iso.replace(/-/g, '');
  const esc = (v: string) => v.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HotelCare//Booking engine//EN', 'BEGIN:VEVENT',
    `UID:${opts.reference}@hotelcare.app`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`,
    `DTSTART;VALUE=DATE:${d(opts.checkIn)}`, `DTEND;VALUE=DATE:${d(opts.checkOut)}`,
    `SUMMARY:${esc(`${opts.hotel} · ${opts.reference}`)}`,
    ...(opts.address ? [`LOCATION:${esc(opts.address)}`] : []),
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

// ISO 3166-1 alpha-2 codes; names come from Intl.DisplayNames in the guest's language.
export const COUNTRY_CODES = (
  'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL ' +
  'NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN ' +
  'TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW'
).split(' ');

export function countryOptions(lang: BookingLang): Array<{ code: string; name: string }> {
  let names: Intl.DisplayNames | null = null;
  try { names = new Intl.DisplayNames([LOCALES[lang]], { type: 'region' }); } catch { names = null; }
  return COUNTRY_CODES
    .map((code) => ({ code, name: (code === 'XK' ? 'Kosovo' : names?.of(code)) || code }))
    .sort((a, b) => a.name.localeCompare(b.name, LOCALES[lang]));
}

/** Marketing attribution from the page URL (and the parent site's URL when embedded). */
export function readAttribution(search: string, referrer: string): Record<string, string> {
  const params = new URLSearchParams(search);
  const out: Record<string, string> = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid']) {
    const value = params.get(key);
    if (value) out[key] = value.slice(0, 200);
  }
  const ref = params.get('ref_url') || referrer;
  if (ref) out.referrer = ref.slice(0, 200);
  return out;
}
