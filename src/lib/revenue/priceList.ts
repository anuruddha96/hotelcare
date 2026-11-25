// Read-only price list for managers: room prices per date, the same numbers
// the Revenue grid shows, without any revenue figures. Data comes from the
// revenue_price_list RPC, which returns room types and prices only.
import { activePricingRoomTypes } from "@/lib/revenue/roomTypeVisibility";
import { localizedRoomTypeName } from "@/lib/revenueThresholds";

export type PriceListRoomType = {
  id: string;
  name: string;
  pms_room_id: string | null;
  num_rooms: number | string | null;
  sort_order?: number | string | null;
  is_reference?: boolean | null;
  is_sellable?: boolean | null;
  counts_toward_inventory?: boolean | null;
  name_translations?: Record<string, string> | null;
};

export type PriceListRate = {
  stay_date: string;
  obk_id: string;
  occupancy: number | string | null;
  price: number | string | null;
  currency: string | null;
};

export type PriceListResponse = {
  hotel_id: string;
  from: string;
  to: string;
  synced_at: string | null;
  room_types: PriceListRoomType[];
  rates: PriceListRate[];
};

export type PriceListRow = {
  key: string;
  roomTypeId: string;
  roomName: string;
  /** Guests the price is for; null when the room type has no prices yet. */
  guests: number | null;
  /** First row of its room type (the name is printed once). */
  firstOfRoom: boolean;
  /** Price per date (YYYY-MM-DD); null where Previo has no price. */
  prices: Record<string, number | null>;
};

export type PriceListTable = {
  dates: string[];
  rows: PriceListRow[];
  currency: string;
};

/** `days` consecutive dates from `from` (YYYY-MM-DD), calendar-safe. */
export function priceListDates(from: string, days: number): string[] {
  const [y, m, d] = from.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    out.push(new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
  }
  return out;
}

/** Shift a YYYY-MM-DD date by whole days (negative = back). */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Today in Budapest, where the hotels are. */
export function todayInBudapest(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function buildPriceList(data: PriceListResponse | null, language: string, dates: string[]): PriceListTable {
  if (!data) return { dates, rows: [], currency: "EUR" };

  const types = activePricingRoomTypes(
    data.room_types.map((rt) => ({
      ...rt,
      num_rooms: Number(rt.num_rooms ?? 0),
      is_sellable: rt.is_sellable ?? undefined,
      counts_toward_inventory: rt.counts_toward_inventory ?? undefined,
    })),
  ).sort((a, b) => (Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)) || a.name.localeCompare(b.name));

  // room (PMS id) → guests → date → price. A later row wins, as in the Revenue grid.
  const byRoom = new Map<string, Map<number, Map<string, number>>>();
  const currencies = new Map<string, number>();
  for (const rate of data.rates) {
    const price = Number(rate.price);
    const guests = Number(rate.occupancy);
    if (!rate.obk_id || rate.price === null || !Number.isFinite(price) || !Number.isFinite(guests)) continue;
    let byGuests = byRoom.get(rate.obk_id);
    if (!byGuests) byRoom.set(rate.obk_id, (byGuests = new Map()));
    let byDate = byGuests.get(guests);
    if (!byDate) byGuests.set(guests, (byDate = new Map()));
    byDate.set(rate.stay_date, price);
    const code = (rate.currency || "EUR").toUpperCase();
    currencies.set(code, (currencies.get(code) ?? 0) + 1);
  }

  const rows: PriceListRow[] = [];
  for (const type of types) {
    const roomName = localizedRoomTypeName(type.name, type.name_translations, language);
    const byGuests = type.pms_room_id ? byRoom.get(type.pms_room_id) : undefined;
    const guestLevels = byGuests ? Array.from(byGuests.keys()).sort((a, b) => a - b) : [];
    if (!guestLevels.length) {
      rows.push({
        key: `${type.id}-none`,
        roomTypeId: type.id,
        roomName,
        guests: null,
        firstOfRoom: true,
        prices: Object.fromEntries(dates.map((date) => [date, null])),
      });
      continue;
    }
    guestLevels.forEach((guests, index) => {
      const byDate = byGuests!.get(guests)!;
      rows.push({
        key: `${type.id}-${guests}`,
        roomTypeId: type.id,
        roomName,
        guests,
        firstOfRoom: index === 0,
        prices: Object.fromEntries(dates.map((date) => [date, byDate.get(date) ?? null])),
      });
    });
  }

  const currency = Array.from(currencies.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "EUR";
  return { dates, rows, currency };
}

/** Whole-number price in the hotel's currency ("€120", "33 000 Ft"). */
export function formatPrice(value: number | null, currency: string, locale: string): string {
  if (value === null || !Number.isFinite(value)) return "–";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(value);
  } catch {
    return `${Math.round(value)} ${currency}`;
  }
}
