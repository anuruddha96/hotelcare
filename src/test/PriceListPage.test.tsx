import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PriceList from "@/pages/PriceList";
import { shiftDate, todayInBudapest } from "@/lib/revenue/priceList";

const today = todayInBudapest();
const rpc = vi.fn(async () => ({
  data: {
    hotel_id: "ottofiori",
    from: today,
    to: today,
    synced_at: "2026-11-17T19:00:00Z",
    room_types: [{ id: "rt-1", name: "Double room", pms_room_id: "obk-1", num_rooms: 10, sort_order: 1, name_translations: {} }],
    rates: [{ stay_date: today, obk_id: "obk-1", occupancy: 2, price: 120, currency: "EUR" }],
  },
  error: null,
}));
let profile: Record<string, unknown> = { id: "u1", role: "manager", access_role: "manager", organization_slug: "rdhotels", assigned_hotel: "ottofiori" };

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...(args as [])) } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ profile, loading: false }) }));
vi.mock("@/hooks/useTranslation", () => ({ useTranslation: () => ({ language: "en", t: (key: string) => (key === "nav.priceList" ? "Price list" : key) }) }));
vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ hotels: [{ hotel_id: "ottofiori", hotel_name: "Hotel Ottofiori" }, { hotel_id: "gozsdu-court", hotel_name: "Gozsdu Court Budapest" }] }),
}));
vi.mock("@/components/layout/Header", () => ({ Header: () => null }));
vi.mock("@/components/layout/MainTabsBar", () => ({ MainTabsBar: () => null }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/rdhotels/price-list"]}>
      <Routes>
        <Route path="/:organizationSlug/price-list" element={<PriceList />} />
        <Route path="/:organizationSlug" element={<div>Dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Price list page", () => {
  beforeEach(() => {
    profile = { id: "u1", role: "manager", access_role: "manager", organization_slug: "rdhotels", assigned_hotel: "ottofiori" };
    rpc.mockClear();
  });

  it("shows a manager the prices of their hotel and no revenue figures", async () => {
    renderPage();
    expect(await screen.findByText("€120")).toBeInTheDocument();
    expect(screen.getByText("Double room")).toBeInTheDocument();
    expect(screen.getByText("2 guests")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("revenue_price_list", { _hotel_id: "ottofiori", _from: today, _days: 14 });
    expect(screen.queryByText(/Gross booking value|ADR|RevPAR|Revenue/)).not.toBeInTheDocument();
  });

  it("lets front-office managers browse previous weeks and jump to a historical date", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Past 14 days" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("revenue_price_list", {
      _hotel_id: "ottofiori", _from: shiftDate(today, -14), _days: 14,
    }));
    expect(screen.getAllByText("Archived").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-11-17" } });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("revenue_price_list", {
      _hotel_id: "ottofiori", _from: "2026-11-17", _days: 14,
    }));
    expect(screen.queryByRole("button", { name: /edit|save rates/i })).not.toBeInTheDocument();
  });

  it("sends people without the price list back to the dashboard", async () => {
    profile = { id: "u2", role: "manager", access_role: "housekeeping_manager", organization_slug: "rdhotels", assigned_hotel: "ottofiori" };
    renderPage();
    await waitFor(() => expect(screen.getByText("Dashboard")).toBeInTheDocument());
  });
});
