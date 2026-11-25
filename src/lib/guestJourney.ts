/**
 * Guest journey: types and helpers shared by the guest profile page, the
 * guest directory and reception (arrivals, reservation detail, check-in).
 *
 * The data comes from pms_guest_profile / pms_guest_signals, which recognise a
 * guest across bookings by name key (case, accents, word order and titles are
 * ignored) and read stay details from minibar, breakfast and In-Suite.
 */

export interface GuestStayMinibar { name: string; qty: number }
export interface GuestStayRequest { type: string; count: number }

export interface GuestStay {
  id: string;
  reservation_number: string | null;
  status: string;
  check_in_date: string;
  check_out_date: string;
  nights: number;
  room_number: string | null;
  room_type: string | null;
  channel: string | null;
  total_amount: number | null;
  currency: string | null;
  adults: number | null;
  children: number | null;
  special_requests: string | null;
  minibar: GuestStayMinibar[];
  breakfast_days: number;
  insuite_orders: number;
  insuite_items: string[];
  requests: GuestStayRequest[];
}

export interface GuestProfile {
  key: string;
  hotel_id: string;
  guest_id: string | null;
  profile_count: number;
  has_profile: boolean;
  name: string | null;
  email: string | null;
  phone: string | null;
  nationality: string | null;
  country: string | null;
  language: string | null;
  vip: boolean;
  company_name: string | null;
  notes: string | null;
  tags: string[];
  dietary: string | null;
  marketing_consent: boolean | null;
  id_on_file: boolean;
  stats: {
    stays: number;
    reservations: number;
    nights: number;
    avg_nights: number | null;
    spend: number | null;
    currency: string | null;
    first_stay: string | null;
    last_stay: string | null;
    next_arrival: string | null;
    in_house: boolean;
    cancelled: number;
  };
  learned: {
    room_types: { name: string; stays: number }[];
    rooms: { room: string; stays: number }[];
    channels: { channel: string; stays: number }[];
    minibar: GuestStayMinibar[];
    minibar_stays: number;
    breakfast_days: number;
    breakfast_nights: number;
    insuite_orders: number;
    insuite_items: string[];
    requests: GuestStayRequest[];
    children_stays: number;
    max_party: number | null;
  };
  stays: GuestStay[];
}

export interface GuestSignal {
  reservation_id: string;
  profile_key: string | null;
  previous_stays: number;
  last_stay_end: string | null;
  group_size: number;
  vip: boolean;
  tags: string[];
  dietary: string | null;
  notes: string | null;
  guest_id: string | null;
}

export interface GuestPreferencesPatch {
  tags?: string[];
  dietary?: string;
  notes?: string;
  vip?: boolean;
  nationality?: string;
}

/** Preferences reception and housekeeping act on. Stored as these codes; anything else is a custom tag. */
export const PRESET_TAGS = [
  'quiet_room',
  'high_floor',
  'low_floor',
  'twin_beds',
  'double_bed',
  'extra_pillows',
  'hypoallergenic',
  'early_check_in',
  'late_check_out',
  'early_breakfast',
  'no_daily_cleaning',
  'parking',
  'airport_transfer',
  'business_traveller',
  'family',
  'celebration',
] as const;

export type PresetTag = (typeof PRESET_TAGS)[number];

export function isPresetTag(tag: string): tag is PresetTag {
  return (PRESET_TAGS as readonly string[]).includes(tag);
}

/** Label for a stored tag: translated for presets, as typed for custom tags. */
export function guestTagLabel(tag: string, t: (key: string) => string): string {
  return isPresetTag(tag) ? t(`pms.guestTag.${tag}`) : tag;
}

/** A group booking under one name (three or more rooms on the same day) is not a returning guest. */
export function isReturningGuest(signal: Pick<GuestSignal, 'previous_stays' | 'group_size'> | null | undefined): boolean {
  return !!signal && signal.previous_stays > 0 && signal.group_size < 3;
}

/** Route of the guest profile page. Works for profiles known only from bookings. */
export function guestProfilePath(basePath: string, hotelId: string, key: string): string {
  if (key.startsWith('g:')) return `${basePath}/guests/${key.slice(2)}`;
  return `${basePath}/guests/k/${encodeURIComponent(hotelId)}/${encodeURIComponent(key)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isReservationId(id: unknown): id is string {
  return typeof id === 'string' && UUID.test(id);
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function normalizeGuestSignal(row: Record<string, unknown>): GuestSignal {
  return {
    reservation_id: String(row.reservation_id),
    profile_key: typeof row.profile_key === 'string' ? row.profile_key : null,
    previous_stays: Number(row.previous_stays ?? 0) || 0,
    last_stay_end: typeof row.last_stay_end === 'string' ? row.last_stay_end : null,
    group_size: Number(row.group_size ?? 1) || 1,
    vip: row.vip === true,
    tags: toStringArray(row.tags),
    dietary: typeof row.dietary === 'string' && row.dietary.trim() ? row.dietary : null,
    notes: typeof row.notes === 'string' && row.notes.trim() ? row.notes : null,
    guest_id: typeof row.guest_id === 'string' ? row.guest_id : null,
  };
}

/** Clean list of tags for saving: trimmed, unique, at most 24, 40 characters each. */
export function cleanTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().slice(0, 40);
    if (tag && !out.some((existing) => existing.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, 24);
}

/** European formats: English as en-GB ("2 Oct 2026"), Hungarian as hu-HU. */
export function guestLocale(language = 'en'): string {
  if (language === 'en') return 'en-GB';
  if (language === 'hu') return 'hu-HU';
  return language;
}

/** "2026-10-02" -> "2 Oct 2026" in the reader's language. */
export function formatGuestDate(iso: string | null | undefined, language = 'en'): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  try {
    return new Intl.DateTimeFormat(guestLocale(language), { day: 'numeric', month: 'short', year: 'numeric' })
      .format(new Date(Date.UTC(y, m - 1, d)));
  } catch {
    return iso.slice(0, 10);
  }
}

/** Country name for a 2-letter code in the reader's language ("HU" -> "Hungary"). */
export function countryName(code: string | null | undefined, language = 'en'): string | null {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return code ?? null;
  try {
    return new Intl.DisplayNames([language, 'en'], { type: 'region' }).of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** Short "returning" line: "3rd stay · last stay until 2 Oct 2026". */
export function returningLine(signal: GuestSignal, t: (key: string) => string, language = 'en'): string {
  const stay = signal.previous_stays + 1;
  const base = t('pms.guest.stayNumber').replace('{n}', String(stay));
  return signal.last_stay_end
    ? `${base} · ${t('pms.guest.lastStayUntil').replace('{date}', formatGuestDate(signal.last_stay_end, language))}`
    : base;
}
