import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { request, range, auth } = vi.hoisted(() => ({
  request: vi.fn(), range: vi.fn(),
  auth: { user: { id: "manager" }, profile: { organization_slug: "rdhotels", role: "top_management", assigned_hotel: "ottofiori" } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args: unknown) => ({
    range: (from: number, to: number) => {
      range(from, to);
      return { abortSignal: (signal: AbortSignal) => request(name, args, signal) };
    },
  }) },
}));
import { usePortfolioSnapshots } from "@/hooks/usePortfolioSnapshots";

const hotels = ["ottofiori", "mika-downtown", "memories-budapest", "gozsdu-court"];
const rows = hotels.map((hotel_id) => ({ hotel_id, stay_date: "2026-09-04", rooms_sold: 10, rooms_available: 20, occupancy_pct: 50, adr_eur: 150, revenue_eur: 1500 }));
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const useSnapshots = () => usePortfolioSnapshots(hotels, "2026-09-01", "2026-09-30");

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } } });
  request.mockReset().mockResolvedValue({ data: rows, error: null });
  range.mockReset();
  auth.user.id = "manager";
  auth.profile.organization_slug = "rdhotels";
});
afterEach(() => { cleanup(); client.clear(); });

describe("portfolio snapshot loading", () => {
  it("loads all four hotels and deduplicates the request IDs", async () => {
    const { result } = renderHook(() => usePortfolioSnapshots([...hotels, hotels[0]], "2026-09-01", "2026-09-30"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(rows);
    expect(request).toHaveBeenCalledWith("revenue_portfolio_latest_snapshots", {
      _hotel_ids: [...hotels].sort(), _from: "2026-09-01", _to: "2026-09-30",
    }, expect.any(AbortSignal));
  });

  it("recovers automatically from the statement timeout that left cards blank", async () => {
    request.mockResolvedValueOnce({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    const { result } = renderHook(useSnapshots, { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(4);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("exposes a persistent failure and supports a manual retry", async () => {
    request.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    const { result } = renderHook(useSnapshots, { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.data).toEqual(rows));
    expect(result.current.isError).toBe(false);
  });

  it("retains the last successful figures when a refresh fails", async () => {
    const { result } = renderHook(useSnapshots, { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    request.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toEqual(rows);
  });

  it("does not display cached figures after changing the user or organisation", async () => {
    const { result, rerender } = renderHook(useSnapshots, { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    auth.user.id = "different-manager";
    auth.profile.organization_slug = "different-org";
    request.mockImplementation(() => new Promise(() => {}));
    rerender();
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);
  });

  it("loads additional pages instead of dropping hotels at the API row limit", async () => {
    const page = Array.from({ length: 500 }, (_, i) => ({ ...rows[0], hotel_id: `hotel-${i}` }));
    request.mockResolvedValueOnce({ data: page, error: null }).mockResolvedValueOnce({ data: [rows[1]], error: null });
    const { result } = renderHook(useSnapshots, { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(501));
    expect(range.mock.calls).toEqual([[0, 499], [500, 999]]);
    expect(result.current.data?.[500].hotel_id).toBe("mika-downtown");
  });

  it("does not query an empty portfolio", () => {
    renderHook(() => usePortfolioSnapshots([], "2026-09-01", "2026-09-30"), { wrapper });
    expect(request).not.toHaveBeenCalled();
  });
});
