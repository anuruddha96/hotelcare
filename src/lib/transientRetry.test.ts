import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTransientBackendError, retryTransient } from './transientRetry';

afterEach(() => vi.useRealTimers());

describe('transient backend recovery', () => {
  it('recognizes upstream and server failures', () => {
    expect(isTransientBackendError({ status: 503, message: 'Unavailable' })).toBe(true);
    expect(isTransientBackendError({ message: 'upstream connect error or disconnect/reset before headers' })).toBe(true);
    expect(isTransientBackendError({ status: 403, message: 'Forbidden' })).toBe(false);
  });

  it('recovers after a transient failure', async () => {
    vi.useFakeTimers();
    const operation = vi.fn()
      .mockRejectedValueOnce({ status: 503, message: 'Service unavailable' })
      .mockResolvedValue({ id: 'profile' });
    const resultPromise = retryTransient(operation, { baseDelayMs: 10, jitter: 0 });
    await vi.advanceTimersByTimeAsync(10);
    await expect(resultPromise).resolves.toEqual({ id: 'profile' });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry authorization failures', async () => {
    const operation = vi.fn().mockRejectedValue({ status: 403, message: 'Forbidden' });
    await expect(retryTransient(operation)).rejects.toMatchObject({ status: 403 });
    expect(operation).toHaveBeenCalledTimes(1);
  });
});