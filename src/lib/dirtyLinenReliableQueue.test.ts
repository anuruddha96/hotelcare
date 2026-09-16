import { describe, expect, it, vi } from 'vitest';
import { DirtyLinenReliableQueue, dirtyLinenQueueKey } from './dirtyLinenReliableQueue';

const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
};

const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('DirtyLinenReliableQueue', () => {
  it('records four rapid taps immediately, sending only the latest absolute value', async () => {
    const storage = memoryStorage();
    const saved: number[] = [];
    const queue = new DirtyLinenReliableQueue({
      storageKey: 'first', storage, debounceMs: 10_000,
      save: async (_, count) => { saved.push(count); }, onChange: () => {},
    });
    queue.acceptServer([{ linen_item_id: 'towel', count: 0 }], queue.revision);
    for (let i = 0; i < 4; i++) queue.adjust('towel', 1);
    expect(queue.getCount('towel')).toBe(4);
    expect(JSON.parse(storage.getItem('first')!).pending[0][1]).toBe(4);
    await queue.flush();
    expect(saved).toEqual([4]);
    expect(queue.snapshot().status).toBe('saved');
    expect(storage.getItem('first')).toBeNull();
    queue.dispose();
  });

  it('does not let a stale server fetch or an old acknowledgement erase newer taps', async () => {
    const storage = memoryStorage();
    const first = deferred();
    const writes: number[] = [];
    const queue = new DirtyLinenReliableQueue({
      storageKey: 'stale', storage, debounceMs: 10_000,
      save: (_, count) => { writes.push(count); return writes.length === 1 ? first.promise : Promise.resolve(); },
      onChange: () => {},
    });
    queue.acceptServer([{ linen_item_id: 'towel', count: 0 }], queue.revision);
    queue.adjust('towel', 1);
    const flush = queue.flush();
    queue.adjust('towel', 1);
    queue.adjust('towel', 1);
    queue.adjust('towel', 1);
    expect(queue.acceptServer([{ linen_item_id: 'towel', count: 1 }], 0)).toBe(false);
    first.resolve();
    await flush;
    expect(writes).toEqual([1, 4]);
    expect(queue.getCount('towel')).toBe(4);
    expect(queue.snapshot().pending).toBe(0);
    queue.dispose();
  });

  it('retains a failed save in browser storage and replays it after reopening', async () => {
    const storage = memoryStorage();
    const broken = new DirtyLinenReliableQueue({
      storageKey: 'offline', storage, debounceMs: 10_000,
      save: async () => { throw new Error('Network offline'); }, onChange: () => {},
    });
    broken.acceptServer([], broken.revision);
    broken.setCount('sheet', 4);
    await broken.flush();
    expect(broken.snapshot().pending).toBe(1);
    expect(broken.snapshot().status).toBe('error');
    broken.dispose();
    const writes: number[] = [];
    const recovered = new DirtyLinenReliableQueue({
      storageKey: 'offline', storage, debounceMs: 10_000,
      save: async (_, count) => { writes.push(count); }, onChange: () => {},
    });
    recovered.acceptServer([], recovered.revision);
    expect(recovered.getCount('sheet')).toBe(4);
    await recovered.flush();
    expect(writes).toEqual([4]);
    expect(storage.getItem('offline')).toBeNull();
    recovered.dispose();
  });

  it('persists and retries zero deletion and isolates tenant/user/room/day keys', async () => {
    const storage = memoryStorage();
    const saved: number[] = [];
    const key = dirtyLinenQueueKey('tenant-a', 'staff-a', 'room-1', '2026-09-16');
    expect(key).not.toBe(dirtyLinenQueueKey('tenant-b', 'staff-a', 'room-1', '2026-09-16'));
    const queue = new DirtyLinenReliableQueue({ storageKey: key, storage, debounceMs: 10_000,
      save: async (_, count) => { saved.push(count); }, onChange: () => {} });
    queue.acceptServer([{ linen_item_id: 'sheet', count: 2 }], queue.revision);
    queue.adjust('sheet', -2);
    expect(queue.getCount('sheet')).toBe(0);
    await queue.flush();
    expect(saved).toEqual([0]);
    expect(storage.getItem(key)).toBeNull();
    queue.dispose();
  });
});
