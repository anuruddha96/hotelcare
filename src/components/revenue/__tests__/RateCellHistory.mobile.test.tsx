import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RateCellHistory from "@/components/revenue/RateCellHistory";
import type { RateAuditRow } from "@/lib/rateAudit";

const history: RateAuditRow[] = Array.from({ length: 5 }, (_, i) => ({
  id: `confirmed-${i}`,
  stay_date: "2026-12-01",
  action: "price",
  source: "previo_confirmed",
  old_rate_eur: 100 + i,
  new_rate_eur: 101 + i,
  delta_eur: 1,
  notes: null,
  performed_at: new Date(Date.UTC(2026, 10, 10, 10 + i)).toISOString(),
  performed_by: null,
  payload: {
    room_type_name: "Deluxe Double",
    occupancy: 2,
    confirmation_status: "confirmed",
  },
}));

describe("mobile price-cell history", () => {
  it("shows only the three newest changes until the user requests the full trail", () => {
    const { container } = render(<RateCellHistory history={history} names={new Map()} />);

    // The phone sheet must not force the expanded prop: a long audit trail
    // should never push its primary Edit price action out of view.
    expect(container.textContent).not.toContain("€100 → €101");
    expect(container.textContent).toContain("€104 → €105");

    fireEvent.click(screen.getByRole("button", { name: "2 more changes" }));
    expect(container.textContent).toContain("€100 → €101");

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(container.textContent).not.toContain("€100 → €101");
  });
});
