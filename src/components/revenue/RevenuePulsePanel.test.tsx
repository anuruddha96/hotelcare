import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DayMetrics } from "@/lib/revenueAnalytics";
import RevenuePulsePanel from "./RevenuePulsePanel";

const today = "2026-09-17";

function metric(overrides: Partial<DayMetrics> = {}): DayMetrics {
  return {
    stay_date: today,
    roomsSold: 0,
    roomsAvailable: 20,
    revenueEur: 0,
    occupancyPct: 0,
    adrEur: null,
    revparEur: null,
    roomsLeft: 20,
    ...overrides,
  } as DayMetrics;
}

describe("RevenuePulsePanel data integrity", () => {
  it("does not turn a missing tonight row into false zero occupancy or availability advice", () => {
    render(<RevenuePulsePanel today={today} metrics={[]} roomsAvailable={20} />);

    expect(screen.getByRole("status")).toHaveTextContent("Tonight's PMS data is unavailable");
    const occupancy = screen.getByText("Occupancy tonight").parentElement!.parentElement!;
    expect(within(occupancy).getByText("—")).toBeInTheDocument();
    expect(within(occupancy).getByText("PMS stay-date data unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Do not make a rate decision from this card/)).toBeInTheDocument();
    expect(screen.queryByText(/20 units left tonight/)).not.toBeInTheDocument();
  });

  it("renders a genuine zero occupancy as 0% when tonight data exists", () => {
    render(<RevenuePulsePanel today={today} metrics={[metric()]} roomsAvailable={20} />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const occupancy = screen.getByText("Occupancy tonight").parentElement!.parentElement!;
    expect(within(occupancy).getByText("0%")).toBeInTheDocument();
    expect(within(occupancy).getByText("0 / 20 rooms")).toBeInTheDocument();
  });

  it("keeps normal live occupancy and rate guidance unchanged", () => {
    render(<RevenuePulsePanel today={today} metrics={[metric({ roomsSold: 15, occupancyPct: 75, adrEur: 140, revparEur: 105 })]} roomsAvailable={20} />);

    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("5 / 20 rooms")).toBeInTheDocument();
    expect(screen.getByText("€140")).toBeInTheDocument();
    expect(screen.getByText("€105")).toBeInTheDocument();
  });
});
