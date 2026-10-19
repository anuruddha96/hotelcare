import { describe, expect, it, vi } from 'vitest';
import { createSupabaseEgressGuard, hotelCareReadTtlMs } from './supabaseEgressGuard';

const origin = 'https://example.supabase.co';
const config = origin + '/rest/v1/pms_configurations?select=hotel_id%2Cpms_type&hotel_id=in.%28gozsdu-court%29&pms_type=eq.previo&limit=1';
const account = origin + '/rest/v1/pms_accounts?select=hotel_id%2Cpms_type%2Cis_active&hotel_id=in.%28gozsdu-court%29&pms_type=eq.previo&is_active=eq.true&limit=1';
const rooms = origin + '/rest/v1/rooms?select=id%2Chotel%2Croom_number%2Cpms_metadata%2Cguest_nights_stayed%2Ctowel_change_required%2Clinen_change_required&hotel=in.%28gozsdu-court%29';
const auth = { authorization: 'Bearer signed-in-user' };

function setup() {
  let time = 10_000;
  const transport = vi.fn(async () => new Response(JSON.stringify({ time }), {
    status: 200, headers: { 'content-type': 'application/json' },
  }));
  const fetcher = createSupabaseEgressGuard(transport as unknown as typeof fetch, () => time);
  return { fetcher, transport, advance: (ms: number) => { time += ms; } };
}

describe('Supabase hot-query egress guard', () => {
  it('only enables TTLs for the three measured read-only query shapes', () => {
    expect(hotelCareReadTtlMs(new URL(config))).toBe(30_000);
    expect(hotelCareReadTtlMs(new URL(account))).toBe(30_000);
    expect(hotelCareReadTtlMs(new URL(rooms))).toBe(3_000);
    expect(hotelCareReadTtlMs(new URL(origin + '/rest/v1/rooms?select=*&hotel=eq.x'))).toBe(0);
    expect(hotelCareReadTtlMs(new URL(origin + '/auth/v1/user'))).toBe(0);
  });

  it('coalesces concurrent requests and each response body is readable', async () => {
    const { fetcher, transport } = setup();
    const results = await Promise.all(Array.from({ length: 15 },
      () => fetcher(config, { headers: auth }).then(r => r.json())));
    expect(transport).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(15);
    results.forEach(result => expect(result).toEqual({ time: 10_000 }));
  });

  it('expires static metadata and room snapshots on distinct schedules', async () => {
    const { fetcher, transport, advance } = setup();
    await (await fetcher(config, { headers: auth })).json();
    await (await fetcher(rooms, { headers: auth })).json();
    advance(3_100);
    await (await fetcher(config, { headers: auth })).json();
    await (await fetcher(rooms, { headers: auth })).json();
    expect(transport).toHaveBeenCalledTimes(3);
    advance(27_000);
    await (await fetcher(config, { headers: auth })).json();
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it('never shares cached data between authorization identities', async () => {
    const { fetcher, transport } = setup();
    await fetcher(account, { headers: auth });
    await fetcher(account, { headers: { authorization: 'Bearer someone-else' } });
    await fetcher(account, { headers: auth });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('invalidates the relevant table immediately after a successful write', async () => {
    const { fetcher, transport } = setup();
    await fetcher(rooms, { headers: auth });
    await fetcher(rooms, { headers: auth });
    await fetcher(origin + '/rest/v1/rooms?id=eq.123', {
      method: 'PATCH', headers: auth, body: JSON.stringify({ notes: 'updated' }),
    });
    await fetcher(rooms, { headers: auth });
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('does not cache failed, unauthenticated, aborted or unrelated requests', async () => {
    const denied = vi.fn(async () => new Response('{}', { status: 403 }));
    const fetcher = createSupabaseEgressGuard(denied as unknown as typeof fetch);
    await fetcher(config, { headers: auth });
    await fetcher(config, { headers: auth });
    await fetcher(config);
    await fetcher(config);
    const controller = new AbortController();
    await fetcher(config, { headers: auth, signal: controller.signal });
    await fetcher(origin + '/rest/v1/rooms?select=*', { headers: auth });
    expect(denied).toHaveBeenCalledTimes(6);
  });
});
