/**
 * Room-plan display options (per workstation) and the layout maths behind
 * them. Pure, so the rules are unit-tested and shared by every hotel type
 * (Previo-connected, Channex-connected, HotelCare-native).
 */

export interface CalendarOptions {
  /** Lower rows and bars: more rooms on one screen. */
  compact: boolean;
  /** Stretch or shrink the day columns to the width of the screen. */
  fitToScreen: boolean;
  /** Group rooms under a collapsible header per room type. */
  groupByType: boolean;
  /** Leave finished stays off the plan. */
  hideCheckedOut: boolean;
  /** Show "· 3n" after the guest name. */
  showNights: boolean;
}

export const DEFAULT_CALENDAR_OPTIONS: CalendarOptions = {
  compact: false, fitToScreen: true, groupByType: false, hideCheckedOut: false, showNights: true,
};

const STORAGE_KEY = 'hotelcare.reception.calendarOptions.v1';

export function parseCalendarOptions(raw: string | null | undefined): CalendarOptions {
  if (!raw) return { ...DEFAULT_CALENDAR_OPTIONS };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out = { ...DEFAULT_CALENDAR_OPTIONS };
    for (const key of Object.keys(out) as Array<keyof CalendarOptions>) {
      if (typeof parsed?.[key] === 'boolean') out[key] = parsed[key] as boolean;
    }
    return out;
  } catch {
    return { ...DEFAULT_CALENDAR_OPTIONS };
  }
}

export function loadCalendarOptions(): CalendarOptions {
  try {
    return parseCalendarOptions(globalThis.localStorage?.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_CALENDAR_OPTIONS };
  }
}

export function saveCalendarOptions(options: CalendarOptions): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Private mode / blocked storage: the options simply last for this visit.
  }
}

export const COLUMN_DEFAULT = 88;
export const COLUMN_COMPACT = 64;
export const COLUMN_MIN = 46;
export const COLUMN_MAX = 150;

/**
 * Width of one day column.
 * - Unknown or zero space (first paint, tests): the fixed default.
 * - Fit to screen: the days share the available width, but never get narrower
 *   than a readable minimum (then the plan scrolls sideways) nor absurdly wide.
 */
export function columnWidthFor(
  options: Pick<CalendarOptions, 'compact' | 'fitToScreen'>,
  availableWidth: number,
  days: number,
): number {
  const base = options.compact ? COLUMN_COMPACT : COLUMN_DEFAULT;
  if (!options.fitToScreen || !Number.isFinite(availableWidth) || availableWidth <= 0 || days <= 0) return base;
  return Math.max(COLUMN_MIN, Math.min(COLUMN_MAX, Math.floor(availableWidth / days)));
}

export interface RoomGroup<T> {
  key: string;
  /** Room type name, or null for the single ungrouped list. */
  label: string | null;
  rooms: T[];
}

/** Rooms in plan order, optionally under one header per room type (types A→Z, rooms numeric). */
export function groupRoomsByType<T extends { room_number: string; room_type?: string | null }>(
  rooms: readonly T[],
  grouped: boolean,
): RoomGroup<T>[] {
  if (!grouped) return [{ key: 'all', label: null, rooms: [...rooms] }];
  const byType = new Map<string, T[]>();
  for (const room of rooms) {
    const type = (room.room_type ?? '').trim() || '—';
    byType.set(type, [...(byType.get(type) ?? []), room]);
  }
  return [...byType.entries()]
    .sort(([a], [b]) => (a === '—' ? 1 : b === '—' ? -1 : a.localeCompare(b, undefined, { numeric: true })))
    .map(([type, list]) => ({ key: `type:${type}`, label: type, rooms: list }));
}
