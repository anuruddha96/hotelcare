import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const rpc = vi.fn();
const channel = vi.fn();
const publishedVersion = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    channel: (...args: unknown[]) => channel(...args),
    from: (table: string) => ({
      select: () => {
        const query = {
          eq: () => query,
          order: () => query,
          maybeSingle: () => table === "revenue_published_payloads"
            ? publishedVersion()
            : Promise.resolve({ data: null, error: null }),
        };
        return query;
      },
    }),
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
    publishedVersion.mockReset();
    publishedVersion.mockResolvedValue({ data: null, error: null });
    localStorage.clear();
    __resetRevenueEditGuard();
    rpc.mockResolvedValue({ data: [payloadRow], error: null });
  });
  afterEach(() => {
    localStorage.clear();
    __resetRevenueEditGuard();
    vi.restoreAllMocks();
  });

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
    // The date window defaults to precisely thirty days on every opening.
    expect(last[1]).toEqual({ _hotel_id: "hotel-resume-selection", _horizon_days: 30 });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("fetches a wider horizon only when the calendar explicitly selects it", async () => {
    const { result, rerender } = renderHook(
      ({ horizonDays }) => useRevenueHotelData("hotel-range-expansion", "org-1", horizonDays),
      { initialProps: { horizonDays: 30 } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.extending).toBe(false));
    const initial = rpc.mock.calls.length;

    rerender({ horizonDays: 110 });

    await waitFor(() => expect(rpc.mock.calls.length).toBeGreaterThan(initial));
    await waitFor(() => expect(result.current.extending).toBe(false));
    const last = rpc.mock.calls[rpc.mock.calls.length - 1];
    expect(last[0]).toBe("get_revenue_published_payload_window");
    expect(last[1]).toEqual({ _hotel_id: "hotel-range-expansion", _horizon_days: 110 });
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


  it("reloads an open rate grid after the published payload changes without starting a PMS sync", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    const { result } = renderHook(() => useRevenueHotelData("hotel-published-refresh", "org-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.extending).toBe(false));
    const initial = rpc.mock.calls.length;
    const poll = intervalSpy.mock.calls.find(([, ms]) => ms === 60_000)?.[0] as (() => void) | undefined;
    expect(poll).toBeTypeOf("function");

    publishedVersion.mockResolvedValue({
      data: { updated_at: "2026-08-28T08:01:00Z" }, error: null,
    });
    await act(async () => { poll?.(); });
    await waitFor(() => expect(rpc.mock.calls.length).toBeGreaterThan(initial));
    await waitFor(() => expect(result.current.extending).toBe(false));

    const afterRefresh = rpc.mock.calls.length;
    await act(async () => { poll?.(); });
    // The same published version must not repeatedly load the large grid.
    expect(rpc.mock.calls.length).toBe(afterRefresh);
    expect(rpc.mock.calls.every(([fn]) => PAYLOAD_FNS.has(fn))).toBe(true);
  });

  it("defers a newer published rate until the unsaved rate editor closes", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    const { result } = renderHook(() => useRevenueHotelData("hotel-published-editor", "org-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.extending).toBe(false));
    const initial = rpc.mock.calls.length;
    const poll = intervalSpy.mock.calls.find(([, ms]) => ms === 60_000)?.[0] as (() => void) | undefined;
    expect(poll).toBeTypeOf("function");

    const release = beginRevenueEdit("unsaved-gozsdu-rate");
    publishedVersion.mockResolvedValue({
      data: { updated_at: "2026-08-28T08:02:00Z" }, error: null,
    });
    await act(async () => { poll?.(); });
    await waitFor(() => expect(publishedVersion).toHaveBeenCalled());
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
