// These are independent signals. A successful checkout poll, daily snapshot or
// rate push MUST NOT be presented as a successful reservation import or OTA sync.
export type ReceptionSyncCategory = 'reservations' | 'overview' | 'room_status' | 'rates';

export interface ReceptionSyncEvent {
  hotel_id?: string | null;
  sync_type: string;
  sync_status: string | null;
  created_at: string;
  data?: unknown;
  error_message?: string | null;
}

export interface ReceptionSyncSignal {
  category: ReceptionSyncCategory;
  label: string;
  lastAttempt: ReceptionSyncEvent | null;
  lastSuccess: ReceptionSyncEvent | null;
  state: 'ok' | 'warning' | 'missing';
  note: string;
}

const CATEGORIES: Array<{
  category: ReceptionSyncCategory;
  label: string;
  types: readonly string[];
  staleAfterMs: number | null;
}> = [
  { category: 'reservations', label: 'Previo reservations', types: ['reservations'], staleAfterMs: 24 * 60 * 60 * 1000 },
  { category: 'overview', label: 'Daily overview', types: ['daily_overview_live'], staleAfterMs: 3 * 60 * 60 * 1000 },
  { category: 'room_status', label: 'Room status push', types: ['status_update'], staleAfterMs: null },
  { category: 'rates', label: 'Rates to Previo', types: ['rate_push'], staleAfterMs: null },
];

function timestamp(event: ReceptionSyncEvent): number {
  const parsed = Date.parse(event.created_at);
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

/** Accept only events returned from a hotel-scoped query; optionally recheck the ID. */
export function buildReceptionSyncHealth(
  events: ReceptionSyncEvent[],
  nowMs: number,
  permittedHotelIds?: readonly string[],
): ReceptionSyncSignal[] {
  const allowed = permittedHotelIds ? new Set(permittedHotelIds) : null;
  const scoped = events.filter((event) => !allowed || (event.hotel_id != null && allowed.has(event.hotel_id)));
  return CATEGORIES.map(({ category, label, types, staleAfterMs }) => {
    const relevant = scoped.filter((event) => types.includes(event.sync_type)).sort((a, b) => timestamp(b) - timestamp(a));
    const lastAttempt = relevant[0] ?? null;
    const lastSuccess = relevant.find((event) => event.sync_status === 'success') ?? null;
    if (!lastAttempt) {
      return { category, label, lastAttempt: null, lastSuccess: null, state: 'missing', note: 'No recorded event for this property' };
    }
    if (lastAttempt.sync_status !== 'success') {
      return { category, label, lastAttempt, lastSuccess, state: 'warning', note: `Latest attempt: ${lastAttempt.sync_status ?? 'unknown'}` };
    }
    if (staleAfterMs !== null && (timestamp(lastAttempt) > nowMs || nowMs - timestamp(lastAttempt) > staleAfterMs)) {
      return { category, label, lastAttempt, lastSuccess, state: 'warning', note: 'Last successful event is outside the expected freshness window' };
    }
    return { category, label, lastAttempt, lastSuccess, state: 'ok', note: category === 'rates' ? 'Previo publishing only; OTA delivery is not verified' : 'Latest recorded attempt succeeded' };
  });
}

export function syncEventCount(event: ReceptionSyncEvent | null): string | null {
  if (!event || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return null;
  const data = event.data as Record<string, unknown>;
  const inserted = typeof data.inserted === 'number' ? data.inserted : null;
  const updated = typeof data.updated === 'number' ? data.updated : null;
  const unmapped = typeof data.unmapped_rooms === 'number' ? data.unmapped_rooms : null;
  const parts = [inserted === null ? null : `${inserted} new`, updated === null ? null : `${updated} updated`, unmapped === null ? null : `${unmapped} unmapped`].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
