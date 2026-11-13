import { describe, expect, it, vi } from 'vitest';
import { ChannexClient, ChannexError, readChannexKey, summarizeAriResponse } from '../../../supabase/functions/_shared/channex/client.ts';

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? '' : JSON.stringify(body), { status, headers });

describe('Channex client', () => {
  it('sends the key in user-api-key to the staging base URL and unwraps data/meta', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, { data: [{ id: 'p1' }], meta: { total: 1 } }));
    const client = new ChannexClient('staging', 'secret-key', fetchImpl, 0);
    const out = await client.probe();
    expect(out).toEqual({ data: [{ id: 'p1' }], meta: { total: 1 } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://staging.channex.io/api/v1/properties?pagination[page]=1&pagination[limit]=1');
    expect(init.headers['user-api-key']).toBe('secret-key');
  });

  it('wraps entity payloads under the entity name', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(201, { data: { id: 'rt1' } }));
    const client = new ChannexClient('production', 'k', fetchImpl, 0);
    await client.createRoomType({ title: 'Double' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://app.channex.io/api/v1/room_types');
    expect(JSON.parse(init.body)).toEqual({ room_type: { title: 'Double' } });
  });

  it('retries 429 and 5xx, then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(res(429, { errors: { code: 'rate_limit' } }, { 'retry-after': '0' }))
      .mockResolvedValueOnce(res(503, {}))
      .mockResolvedValueOnce(res(200, { data: { id: 'ok' } }));
    vi.useFakeTimers();
    const client = new ChannexClient('staging', 'k', fetchImpl, 2);
    const p = client.getRevision('r1');
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ data: { id: 'ok' }, meta: undefined });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('does not retry validation errors and exposes code/details', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(422, { errors: { code: 'validation_error', title: 'Invalid', details: ['rate is invalid'] } }));
    const client = new ChannexClient('staging', 'k', fetchImpl, 3);
    const err = await client.pushRestrictions([]).catch((e) => e);
    expect(err).toBeInstanceOf(ChannexError);
    expect(err).toMatchObject({ status: 422, code: 'validation_error', details: ['rate is invalid'] });
    expect(err.retryable).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reads the project secret HOTELCARE_CHANNEX_API for staging only', () => {
    const env = (k: string) => ({ HOTELCARE_CHANNEX_API: ' stg-key ' } as Record<string, string>)[k];
    expect(readChannexKey('staging', env)).toBe('stg-key');
    expect(readChannexKey('production', env)).toBeNull();
  });

  it('refuses to start without a key', () => {
    expect(() => ChannexClient.fromEnv('staging', () => undefined)).toThrow(/not configured/);
  });

  it('collects task ids and warnings: 200 is accepted, not proven', () => {
    expect(summarizeAriResponse({ data: [{ id: 'task-1', type: 'task' }], meta: { warnings: [{ date: '2027-01-01', warning: 'rate below min' }] } }))
      .toEqual({ taskIds: ['task-1'], warnings: [{ date: '2027-01-01', warning: 'rate below min' }] });
  });
});
