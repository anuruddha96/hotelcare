import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const rpc = vi.fn();
const channel = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    channel: (...args: unknown[]) => channel(...args),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  },
}));

import { useRevenueHotelData } from "@/hooks/useRevenueHotelData";
import { EXECUTIVE_RESUME_EVENT } from "@/components/system/ExecutiveResumeRefresh";
import { beginRevenueEdit, __resetRevenueEditGuard } from "@/lib/revenueEditGuard";

const payloadRow = {
  payload: { roomTypes: [], nights: [], snapshots: [], rates: [], cancellations: [], movements: [], settings: {} },
  sync_completed_at: "2026-08-28T08:00:00Z",
  sync_completed_by_name: null,
};

function fireResume() {
  window.dispatchEvent(
    new CustomEvent(EXECUTIVE_RESUME_EVENT, { detail: { idleMs: 180000, level: "normal" } }),
  );
}

describe("useRevenueHotelData — executive resume", () => {
  beforeEach(() => {
    rpc.mockReset();
    channel.mockReset();
    __resetRevenueEditGuard();
    rpc.mockResolvedValue({ data: [payloadRow], error: null });
  });
  afterEach(() => __resetRevenueEditGuard());

  it("re-reads only the published payload, with no sync/push/PMS call", async () => {
    const { result } = renderHook(() => useRevenueHotelData("hotel-1", "org-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(rpc).toHaveBeenCalledTimes(1);

    await act(async () => { fireResume(); });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));

    const called = rpc.mock.calls.map((c) => c[0]);
    expect(new Set(called)).toEqual(new Set(["get_revenue_published_payload"]));
    expect(called).not.toContain("claim_revenue_sync");
    // no extra realtime channels were opened by the resume path
    expect(channel).not.toHaveBeenCalled();
  });

  it("keeps the selected hotel and does not clear the current dataset", async () => {
    const { result } = renderHook(() => useRevenueHotelData("hotel-1", "org-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { fireResume(); });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));

    expect(rpc.mock.calls[1][1]).toEqual({ _hotel_id: "hotel-1" });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("defers the refresh while a rate editor holds unsaved values", async () => {
    const { result } = renderHook(() => useRevenueHotelData("hotel-1", "org-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const release = beginRevenueEdit("bulk-price-editor");
    await act(async () => { fireResume(); });
    expect(rpc).toHaveBeenCalledTimes(1);

    await act(async () => { release(); });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
  });

  it("keeps the previous data when the refresh fails", async () => {
    const { result } = renderHook(() => useRevenueHotelData("hotel-1", "org-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    await act(async () => { fireResume(); });
    await waitFor(() => expect(rpc.mock.calls.length).toBeGreaterThan(1));

    expect(result.current.roomTypes).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
