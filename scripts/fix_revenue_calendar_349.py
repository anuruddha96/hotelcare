#!/usr/bin/env python3
"""Adjust legacy grid-horizon default and its resume tests for issue #349."""
from pathlib import Path


def replace_one(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if text.count(old) != 1:
        raise RuntimeError(f"Expected one anchor in {path}: {old[:70]!r}; found {text.count(old)}")
    path.write_text(text.replace(old, new, 1))
    print(f"Updated {path}")


hook = Path("src/hooks/useRevenueHotelData.ts")
replace_one(hook, "  horizonDays = 365,\n", "  horizonDays = 30,\n")

test = Path("src/hooks/__tests__/useRevenueHotelData.resume.test.tsx")
replace_one(test, 'import { REVENUE_PREF_CHANGED_EVENT } from "@/lib/revenuePrefs";\n', "")
replace_one(test, '''    // Desktop opens on the 45-day grid plus a 20-day prefetch buffer instead
    // of silently decoding the full year on every resume.
    expect(last[1]).toEqual({ _hotel_id: "hotel-resume-selection", _horizon_days: 65 });''', '''    // The date window defaults to precisely thirty days on every opening.
    expect(last[1]).toEqual({ _hotel_id: "hotel-resume-selection", _horizon_days: 30 });''')
replace_one(test, '''  it("expands the payload when the user asks the grid for a wider range", async () => {
    const { result } = renderHook(() => useRevenueHotelData("hotel-range-expansion", "org-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.extending).toBe(false));
    const initial = rpc.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new CustomEvent(REVENUE_PREF_CHANGED_EVENT, {
        detail: { name: "grid-range", value: 90 },
      }));
    });

    await waitFor(() => expect(rpc.mock.calls.length).toBeGreaterThan(initial));
    await waitFor(() => expect(result.current.extending).toBe(false));
    const last = rpc.mock.calls[rpc.mock.calls.length - 1];
    expect(last[0]).toBe("get_revenue_published_payload_window");
    expect(last[1]).toEqual({ _hotel_id: "hotel-range-expansion", _horizon_days: 110 });
  });''', '''  it("fetches a wider horizon only when the calendar explicitly selects it", async () => {
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
  });''')
