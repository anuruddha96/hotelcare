import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHousekeepingLiveRefresh } from './useHousekeepingLiveRefresh';

describe('useHousekeepingLiveRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reconciles an open housekeeping screen without a manual reload', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useHousekeepingLiveRefresh(refresh, true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(refresh).toHaveBeenCalledTimes(2);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not poll sleeping phones but catches up on reopening the tab', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useHousekeepingLiveRefresh(refresh, true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    expect(refresh).not.toHaveBeenCalled();

    hidden.mockReturnValue(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('recovers from an offline phone when connectivity returns', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useHousekeepingLiveRefresh(refresh, true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(refresh).not.toHaveBeenCalled();

    online.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('stays disabled when this view is not active', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useHousekeepingLiveRefresh(refresh, false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      window.dispatchEvent(new Event('focus'));
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
