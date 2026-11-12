import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import KpiReconciliationCard, { KpiReconciliationView, type KpiReconciliationMonth } from "../KpiReconciliationCard";

const lang = { language: "en" };
vi.mock("@/hooks/useTranslation", () => ({ useTranslation: () => lang }));

const query = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: (k1: string, v1: string) => ({
          eq: (k2: string, v2: string) => ({
            maybeSingle: () => query(table, { [k1]: v1, [k2]: v2 }),
          }),
        }),
      }),
    }),
  },
}));

// Gozsdu Court, December 2026, as the reconciliation view returned it on 2026-11-12.
const GOZSDU_DEC: KpiReconciliationMonth = {
  hotel_id: "gozsdu-court",
  month_start: "2026-12-01",
  capacity_room_nights: 2542,
  booked_nights_all: 1773,
  hold_nights: 465,
  commercial_sold: 1308,
  unassigned_nights: 35,
  option_nights: 99,
  previo_dashboard_occupied: 1738,
  past_nights: 0,
  housekeeping_verified_nights: 0,
  housekeeping_mismatch_nights: 0,
  previo_dashboard_occupancy_pct: 68.4,
  hotelcare_commercial_occupancy_pct: 63.0,
  best_physical_occupancy_pct: 69.7,
  best_commercial_occupancy_pct: 63.0,
};

// Ottofiori, November 2026: past nights checked against housekeeping, nothing unusual.
const OTTOFIORI_NOV: KpiReconciliationMonth = {
  hotel_id: "ottofiori",
  month_start: "2026-11-01",
  capacity_room_nights: 630,
  booked_nights_all: 507,
  hold_nights: 0,
  commercial_sold: 507,
  unassigned_nights: 0,
  option_nights: 0,
  previo_dashboard_occupied: 507,
  past_nights: 11,
  housekeeping_verified_nights: 11,
  housekeeping_mismatch_nights: 0,
  previo_dashboard_occupancy_pct: 80.5,
  hotelcare_commercial_occupancy_pct: 80.5,
  best_physical_occupancy_pct: 80.5,
  best_commercial_occupancy_pct: 80.5,
};

describe("KpiReconciliationView", () => {
  beforeEach(() => { lang.language = "en"; });

  it("shows the three figures and explains every cause of the Gozsdu gap", () => {
    render(<KpiReconciliationView row={GOZSDU_DEC} />);
    expect(screen.getByText("68%")).toBeTruthy(); // Previo dashboard
    expect(screen.getByText("63%")).toBeTruthy(); // HotelCare commercial
    expect(screen.getByText("70%")).toBeTruthy(); // verified (future: bookings on the books)
    expect(screen.getByText("Gap vs Previo: +35 room-nights")).toBeTruthy();
    expect(screen.getByText(/35 booked room-nights have no room assigned yet/)).toBeTruthy();
    expect(screen.getByText(/465 room-nights are multi-year holds/)).toBeTruthy();
    expect(screen.getByText(/99 room-nights are options/)).toBeTruthy();
    expect(screen.getByText("Future: every booking on the books")).toBeTruthy();
  });

  it("says Previo's ADR is room-only and can lag same-morning bookings", () => {
    render(<KpiReconciliationView row={GOZSDU_DEC} />);
    expect(screen.getByText(/Previo's dashboard ADR is room-only/)).toBeTruthy();
    expect(screen.getByText(/lag bookings made the same morning/)).toBeTruthy();
  });

  it("shows no gap or reasons when both systems agree", () => {
    render(<KpiReconciliationView row={OTTOFIORI_NOV} />);
    expect(screen.queryByText(/Gap vs Previo/)).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.getByText("11/11 past nights checked against housekeeping")).toBeTruthy();
  });

  it("renders a dash, not NaN, when a percentage is missing", () => {
    const { container } = render(
      <KpiReconciliationView row={{ ...OTTOFIORI_NOV, hotelcare_commercial_occupancy_pct: null }} />,
    );
    expect(screen.getByText("—")).toBeTruthy();
    expect(container.textContent).not.toMatch(/NaN|undefined/);
  });

  it("speaks Hungarian", () => {
    render(<KpiReconciliationView row={GOZSDU_DEC} hu />);
    expect(screen.getByText("Kihasználtság egyeztetés")).toBeTruthy();
    expect(screen.getByText("Eltérés a Previótól: +35 éj")).toBeTruthy();
    expect(screen.getByText(/csak a szobaár/)).toBeTruthy();
  });
});

describe("KpiReconciliationCard", () => {
  beforeEach(() => { query.mockReset(); lang.language = "en"; });

  it("loads the selected hotel and month from the monthly view", async () => {
    query.mockResolvedValue({ data: GOZSDU_DEC, error: null });
    render(<KpiReconciliationCard hotelId="gozsdu-court" month="2026-12" />);
    await waitFor(() => expect(screen.getByTestId("kpi-reconciliation")).toBeTruthy());
    expect(query).toHaveBeenCalledWith("revenue_kpi_reconciliation_monthly", {
      hotel_id: "gozsdu-court",
      month_start: "2026-12-01",
    });
  });

  it("renders nothing when the view is missing or access is denied", async () => {
    query.mockResolvedValue({ data: null, error: { code: "42P01" } });
    const { container } = render(<KpiReconciliationCard hotelId="mika-downtown" month="2026-11" />);
    await waitFor(() => expect(query).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("does not query without a hotel or with a malformed month", () => {
    render(<KpiReconciliationCard hotelId={null} month="2026-11" />);
    render(<KpiReconciliationCard hotelId="ottofiori" month="November" />);
    expect(query).not.toHaveBeenCalled();
  });

  it("uses Hungarian when the app language is Hungarian", async () => {
    lang.language = "hu";
    query.mockResolvedValue({ data: OTTOFIORI_NOV, error: null });
    render(<KpiReconciliationCard hotelId="ottofiori" month="2026-11" />);
    await waitFor(() => expect(screen.getByText("Kihasználtság egyeztetés")).toBeTruthy());
  });
});
