/**
 * Dirty linen autosave. Each tap is first recorded synchronously in browser
 * storage, then the latest absolute quantity is sent to the existing table.
 * Only one write may be in flight per queue: older responses cannot undo newer
 * taps, failed writes remain recoverable after reload, and repeating an upsert
 * or delete cannot double count after a lost HTTP acknowledgement.
 *
 * This is a browser reliability layer, NOT a cross-device concurrency lock.
 * Cross-device atomic increments would require an authenticated idempotent RPC.
 */
export type LinenCount = { linen_item_id: string; count: number };
export type LinenSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
export type LinenQueueSnapshot = {
  counts: Record<string, number>;
  status: LinenSaveStatus;
  pending: number;
  error: string | null;
};

type Pending = { count: number; version: number };
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type QueueOptions = {
  storageKey: string;
  storage?: StoragePort | null;
  save: (itemId: string, count: number) => Promise<void>;
  onChange: (snapshot: LinenQueueSnapshot) => void;
  onSynced?: () => void;
  debounceMs?: number;
};

const MAX_COUNT = 1000;
const validCount = (count: number) => Number.isSafeInteger(count) && count >= 0 && count <= MAX_COUNT;

export class DirtyLinenReliableQueue {
  private desired = new Map<string, number>();
  private pending = new Map<string, Pending>();
  private version = 0;
  private inFlight = false;
  private loaded = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private lastError: string | null = null;
  private storageUnavailable = false;
  private saved = false;

  constructor(private readonly options: QueueOptions) {
    try {
      const text = options.storage?.getItem(options.storageKey);
      if (text) {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && 'pending' in parsed &&
            Array.isArray((parsed as { pending: unknown }).pending)) {
          for (const entry of (parsed as { pending: unknown[] }).pending) {
            if (!Array.isArray(entry) || entry.length !== 3) continue;
            const [id, count, version] = entry;
            if (typeof id !== 'string' || !id || !validCount(count) ||
                !Number.isSafeInteger(version) || version < 0) continue;
            this.pending.set(id, { count, version });
            this.desired.set(id, count);
            this.version = Math.max(this.version, version);
          }
        }
      }
      if (!options.storage) this.storageUnavailable = true;
    } catch {
      this.storageUnavailable = true;
    }
    this.emit();
  }

  get revision(): number { return this.version; }
  get hasPending(): boolean { return this.pending.size > 0; }
  get isLoaded(): boolean { return this.loaded; }

  getCount(itemId: string): number { return this.desired.get(itemId) ?? 0; }

  snapshot(): LinenQueueSnapshot {
    const counts = Object.fromEntries(this.desired);
    const pending = this.pending.size;
    const error = this.storageUnavailable && pending
      ? 'Browser storage is unavailable. Keep this page open until all changes are saved.'
      : this.lastError;
    return {
      counts,
      pending,
      error,
      status: error ? 'error' : this.inFlight ? 'saving' : pending ? 'pending' : this.saved ? 'saved' : 'idle',
    };
  }

  private emit(): void {
    if (!this.disposed) this.options.onChange(this.snapshot());
  }

  private persist(): void {
    try {
      if (!this.options.storage) throw new Error('Storage not available');
      if (this.pending.size) {
        this.options.storage.setItem(this.options.storageKey, JSON.stringify({
          version: 1,
          pending: [...this.pending].map(([id, entry]) => [id, entry.count, entry.version]),
        }));
      } else {
        this.options.storage.removeItem(this.options.storageKey);
      }
      this.storageUnavailable = false;
    } catch {
      this.storageUnavailable = true;
    }
  }

  /** Read result must not overwrite anything tapped after the request began. */
  acceptServer(counts: LinenCount[], requestedRevision: number): boolean {
    if (this.disposed || requestedRevision !== this.version) return false;
    this.desired = new Map(counts.filter(row => validCount(row.count))
      .map(row => [row.linen_item_id, row.count]));
    for (const [id, entry] of this.pending) this.desired.set(id, entry.count);
    this.loaded = true;
    this.emit();
    return true;
  }

  /** Immediate, stale-closure-free update for tap, minus, or typed quantity. */
  setCount(itemId: string, next: number): number {
    if (this.disposed || !itemId) return this.getCount(itemId);
    const count = Math.min(MAX_COUNT, Math.max(0, Math.floor(Number.isFinite(next) ? next : 0)));
    if (count === this.getCount(itemId)) return count;
    this.version += 1;
    this.desired.set(itemId, count);
    this.pending.set(itemId, { count, version: this.version });
    this.saved = false;
    this.lastError = null;
    this.persist(); // Browser durability BEFORE informing the UI of the new value.
    this.emit();
    this.schedule(this.options.debounceMs ?? 250);
    return count;
  }

  adjust(itemId: string, delta: number): number {
    return this.setCount(itemId, this.getCount(itemId) + delta);
  }

  private schedule(delay: number): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  flushNow(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.inFlight || this.disposed || !this.pending.size) return;
    this.inFlight = true;
    this.emit();
    try {
      while (this.pending.size && !this.disposed) {
        const [id, submitted] = this.pending.entries().next().value as [string, Pending];
        // One request at a time; absolute set/delete operations can be replayed safely.
        await this.options.save(id, submitted.count);
        if (this.pending.get(id)?.version === submitted.version) {
          this.pending.delete(id);
          this.persist();
        }
        this.failures = 0;
        this.lastError = null;
        this.emit();
      }
      if (!this.pending.size) {
        this.saved = true;
        this.lastError = null;
        this.options.onSynced?.();
      }
    } catch (error) {
      this.failures += 1;
      this.lastError = error instanceof Error ? error.message : 'Could not save linen counts';
      // Never discard a failed operation. Resume on a timer, online event, or reopening.
      if (!this.disposed) this.schedule(Math.min(30_000, 1_000 * 2 ** Math.min(this.failures, 5)));
    } finally {
      this.inFlight = false;
      this.emit();
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.disposed = true;
    // An already-started request may finish, but every unacknowledged edit is
    // still in storage and will be replayed when the dialog mounts again.
  }
}

/** A separate browser queue for each tenant, employee, room and work date. */
export function dirtyLinenQueueKey(organization: string, user: string, room: string, workDate: string): string {
  return ['hotelcare-dirty-linen-v1', organization, user, room, workDate]
    .map(encodeURIComponent).join(':');
}
