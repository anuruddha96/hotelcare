import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MonthBreakdownPanel from "../MonthBreakdownPanel";
import type { MonthBreakdownRow } from "@/lib/kpiReconciliation";

vi.mock("@/lib/revenueCurrency", () => ({ money: (n: number) => `€${Math.round(n)}` }));

const row = (key: MonthBreakdownRow["key"], extra: Partial<MonthBreakdownRow> = {}): MonthBreakdownRow => ({
  key,
  firstDay: "2026-11-01",
  lastDay: "2026-11-30",
  sold: 520,
  capacity: 630,
  occupancyPct: 82.5,
  priced: 520,
  revenueGross: 63884.58,
  adrGross: 122.85,
  revparGross: 101.4,
  breakfasts: 878,
  breakfastNightsKnown: 30,
  nightsWithSales: 30,
  revenueRoomOnly: null,
  adrRoomOnly: null,
  revparRoomOnly: null,
  ...extra,
});

// Ottofiori, November 2026, as the function returned it on 12 November.
const OTTO_NOV: MonthBreakdownRow[] = [
  row("stayed", { lastDay: "2026-11-11", sold: 230, capacity: 231, occupancyPct: 99.6, adrGross: 92.4 }),
  row("books", { firstDay: "2026-11-12", sold: 290, capacity: 399, occupancyPct: 72.7, adrGross: 147 }),
  row("month"),
];

describe("MonthBreakdownPanel", () => {
  it("shows stayed + on the books = whole month, with the day ranges", () => {
    render(<MonthBreakdownPanel rows={OTTO_NOV} monthLabel="November 2026" breakfastPrice={null} />);
    const text = screen.getByTestId("month-breakdown").textContent ?? "";
    expect(text).toMatch(/How November 2026 adds up/);
    expect(text).toMatch(/Already stayed1–11230\/231100%/);
    expect(text).toMatch(/On the books12–30290\/39973%€147/);
    expect(text).toMatch(/Whole month1–30520\/63083%€123/);
    // No room-only column until the breakfast value is known.
    expect(text).not.toMatch(/ADR room/);
    expect(text).toMatch(/878 breakfasts on the housekeeping lists/);
    expect(text).toMatch(/An admin can set the breakfast value/);
  });

  it("adds a room-only ADR column once the breakfast value is set", () => {
    const rows = OTTO_NOV.map((r) => ({ ...r, adrRoomOnly: 101.92, revenueRoomOnly: 52997.08 }));
    render(<MonthBreakdownPanel rows={rows} monthLabel="November 2026" breakfastPrice={12.4} />);
    const text = screen.getByTestId("month-breakdown").textContent ?? "";
    expect(text).toMatch(/ADR room/);
    expect(text).toMatch(/Whole month1–30520\/63083%€102€123/);
    expect(text).toMatch(/Room price = booking price − breakfasts × €12/);
  });

  it("says why room-only ADR is missing when some sold nights have no housekeeping list", () => {
    const rows = OTTO_NOV.map((r) => (r.key === "month" ? { ...r, breakfastNightsKnown: 27 } : r));
    render(<MonthBreakdownPanel rows={rows} monthLabel="November 2026" breakfastPrice={12.4} />);
    expect(screen.getByText(/3 sold nights have no housekeeping list yet/)).toBeTruthy();
  });

  it("lets an admin save, change and clear the breakfast value", () => {
    const save = vi.fn();
    const { rerender } = render(<MonthBreakdownPanel rows={OTTO_NOV} monthLabel="November 2026" breakfastPrice={null} canEdit onSaveBreakfastPrice={save} />);
    const input = screen.getByLabelText("Breakfast value per guest per night") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12,4" } });
    fireEvent.blur(input);
    expect(save).toHaveBeenLastCalledWith(12.4);
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "-3" } });
    fireEvent.blur(input);
    expect(save).toHaveBeenCalledTimes(1);
    // The saved value comes back from the server as the new prop.
    rerender(<MonthBreakdownPanel rows={OTTO_NOV} monthLabel="November 2026" breakfastPrice={12.4} canEdit onSaveBreakfastPrice={save} />);
    expect(input.value).toBe("12.4");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(save).toHaveBeenLastCalledWith(null);
  });

  it("does not save when the value did not change", () => {
    const save = vi.fn();
    render(<MonthBreakdownPanel rows={OTTO_NOV} monthLabel="November 2026" breakfastPrice={12.4} canEdit onSaveBreakfastPrice={save} />);
    fireEvent.blur(screen.getByLabelText("Breakfast value per guest per night"));
    expect(save).not.toHaveBeenCalled();
  });

  it("speaks Hungarian", () => {
    render(<MonthBreakdownPanel rows={OTTO_NOV} monthLabel="2026. november" breakfastPrice={null} hu />);
    const text = screen.getByTestId("month-breakdown").textContent ?? "";
    expect(text).toMatch(/Hogyan áll össze: 2026\. november/);
    expect(text).toMatch(/Már eltöltött/);
    expect(text).toMatch(/Könyvben \(jövő\)/);
    expect(text).toMatch(/Teljes hónap/);
  });

  it("renders nothing without rows", () => {
    const { container } = render(<MonthBreakdownPanel rows={[]} monthLabel="November 2026" breakfastPrice={null} />);
    expect(container.innerHTML).toBe("");
  });
});
