/**
 * Narrowly scoped, session-isolated read-through guard for known hot PMS queries.
 * PostgREST remains authoritative. Room-state/status reads, RPCs, auth and
 * writes are never served from this cache.
 */
const STATIC_PMS_SELECTS = new Map([
  ['/rest/v1/pms_configurations', 'hotel_id,pms_type'],
  ['/rest/v1/pms_accounts', 'hotel_id,pms_type,is_active'],
]);
const ROOM_METADATA_SELECT =
  'id,hotel,room_number,pms_metadata,guest_nights_stayed,towel_change_required,linen_change_required';
const MAX_CACHE_ENTRIES = 32;

export function hotelCareReadTtlMs(url: URL): number {
  const selected = url.searchParams.get('select');
  if (!selected || (!url.searchParams.has('hotel_id') && !url.searchParams.has('hotel'))) return 0;
  if (url.pathname === '/rest/v1/rooms'
      && selected === ROOM_METADATA_SELECT
      && url.searchParams.has('hotel')) return 3_000;
  if (STATIC_PMS_SELECTS.get(url.pathname) === selected
      && url.searchParams.has('hotel_id')
      && url.searchParams.get('pms_type') === 'eq.previo') return 30_000;
  return 0;
}

/** Cache is private to one Supabase client; nothing is written to browser storage. */
export function createSupabaseEgressGuard(
  transport: typeof fetch,
  clock: () => number = () => Date.now(),
): typeof fetch {
  type Entry = { response: Response; expiresAt: number; table: string; generation: number };
  const cache = new Map<string, Entry>();
  const pending = new Map<string, { generation: number; promise: Promise<Response> }>();
  const generations = new Map<string, number>();

  const getTable = (url: URL): string | null => {
    const match = /^\/rest\/v1\/(rooms|pms_accounts|pms_configurations)$/.exec(url.pathname);
    return match?.[1] ?? null;
  };

  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'https://localhost');
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const table = getTable(url);
    if (method !== 'GET') {
      const response = await transport(input, init);
      if (response.ok && table) {
        generations.set(table, (generations.get(table) ?? 0) + 1);
        for (const [key, entry] of cache) if (entry.table === table) cache.delete(key);
      }
      return response;
    }

    const ttl = hotelCareReadTtlMs(url);
    if (!table || ttl === 0 || init?.signal || init?.cache === 'no-store') {
      return transport(input, init);
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const authorization = headers.get('authorization');
    // Do not share responses across identities or cache unauthenticated queries.
    if (!authorization) return transport(input, init);

    const key = authorization + '\n' + url.href;
    const generation = generations.get(table) ?? 0;
    const hit = cache.get(key);
    if (hit && hit.expiresAt > clock() && hit.generation === generation) {
      return hit.response.clone();
    }
    cache.delete(key);

    let request = pending.get(key)?.generation === generation
      ? pending.get(key)?.promise : undefined;
    if (!request) {
      // Cache bookkeeping and pending cleanup complete BEFORE a caller can
      // retry. In particular, a failed response must never be coalesced with
      // an immediate follow-up request that starts after the first finished.
      const shared = Promise.resolve().then(() => transport(input, init))
        .then((response) => {
          if (response.ok && (generations.get(table) ?? 0) === generation) {
            cache.set(key, {
              response: response.clone(), expiresAt: clock() + ttl, table, generation,
            });
            while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
          }
          return response;
        }).finally(() => {
          if (pending.get(key)?.promise === shared) pending.delete(key);
        });
      request = shared;
      pending.set(key, { generation, promise: shared });
    }
    // Caller-specific clones avoid already-consumed response bodies.
    const response = await request;
    return response.clone();
  };
}
