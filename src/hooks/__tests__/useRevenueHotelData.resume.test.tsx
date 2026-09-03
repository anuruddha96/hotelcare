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

  const PAYLOAD_FNS = new Set([
    "get_revenue_published_payload",
    "get_revenue_published_payload_window",
  ]);

  it("re-reads only the published payload, with no sync/push/PMS call", async () => {
    const { result } = renderHook(() => useRevenueHotelData("hotel-resume-read", "org-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.extending).toBe(false));
    const initial = rpc.mock.calls.length;

    await act(async () => { fireResume(); });
    await waitFor(() => expect(rpc.mock.calls.length).toBeGreaterThan(initial));

    const called = rpc.mock.calls.map((c) => c[0] as string);
    expect(called.every((name) => PAYLOAD_FNS.has(name))).toBe(true);
    expect(called).not.toContain("claim_revenue_sync");
    // no extra realtime channels were opened by the resume path
    expect(channel).not.toHaveBeenCalled();
  });

  it("keeps the selected hotel and does not clear the current dataset", async () => {
    const { result } = renderHook(() => useRevenueHotelData("hotel-resume-selection", "org-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.extending).toBe(false));
    const initial = rpc.mock.calls.length;

    await act(async () => { fireResume(); });
    await waitFor(() => expect(rpc.mock.calls.length).toBeGreaterThan(initial));

    const last = rpc.mock.calls[rpc.mock.calls.length - 1];
    expect(last[0]).toBe("get_revenue_published_payload_window");
    expect(last[1]).toEqual({ _hotel_id: "hotel-resume-selection", _horizon_days: 365 });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("defers the refresh while a rate editor holds unsaved values", async () => {
    const { result } = renderHook(() => useRevenueHotelData("hotel-resume-editor", "org-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.extending).toBe(false));
    const initial = rpc.mock.calls.length;

    const release = beginRevenueEdit("bulk-price-editor");
    await act(async () => { fireResume(); });
    expect(rpc.mock.calls.length).toBe(initial);

    await act(async () => { release(); });
    await waitFor(() => expect(rpc.mock.calls.length).toBeGreaterThan(initial));
  });

  it("keeps the previous data when the refresh fails", async () => {
    const { result } = renderHook(() => useRevenueHotelData("hotel-resume-failure", "org-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.extending).toBe(false));

    const initial = rpc.mock.calls.length;
    rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    await act(async () => { fireResume(); });
    await waitFor(() => expect(rpc.mock.calls.length).toBeGreaterThan(initial));

    expect(result.current.roomTypes).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
