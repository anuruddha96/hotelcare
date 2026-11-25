import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ChannelEconomicsPanel from "./ChannelEconomicsPanel";
import RevenueInsightsHub from "@/components/revenue/RevenueInsightsHub";

// recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

let language: "en" | "hu" = "en";
let rpcResult: (fn: string) => { data: unknown[] | null; error: { message: string; code?: string } | null };

function builder(fn: string) {
  const result = () => {
    const r = rpcResult(fn);
    return Promise.resolve({ ...r, count: r.data ? r.data.length : null });
  };
  const chain = {
    order: () => chain,
    range: () => result(),
  };
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string) => builder(fn),
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) }),
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
  },
}));
vi.mock("@/hooks/useTranslation", () => ({ useTranslation: () => ({ language, t: (key: string) => key }) }));

const month = "2026-10";
const night = (o: Record<string, unknown>) => ({
  stay_date: "2026-10-10", booking_ref: "b1", ota_code: null, data_source: "previo", channel_key: "booking_com",
  channel_type: "ota", booked_on: "2026-09-01", room_nights: 1, priced_nights: 1, amount: 103.81, city_tax: 3.81,
  revenue_ex_tax: 100, gross_revenue: 100, commission: 18, net_revenue: 82, amount_basis: "gross",
  commission_source: "ota_note", commission_rate: 0.18, rate_label: "Mobile(App) Rate", meal_plan: "breakfast",
  payout_type: "Virtual credit card", currency: "EUR", ...o,
});
const nights = [
  night({}),
  night({ booking_ref: "b2", stay_date: "2026-10-11", rate_label: "Non-refundable" }),
  night({ booking_ref: "e1", channel_key: "expedia", amount: 82.71, city_tax: 2.71, revenue_ex_tax: 80, gross_revenue: 100, commission: 20, net_revenue: 80, amount_basis: "net", commission_source: "terms", commission_rate: 0.2, rate_label: null }),
  night({ booking_ref: "d1", channel_key: "edreams", amount: 70, city_tax: 0, revenue_ex_tax: 70, gross_revenue: 70, commission: null, net_revenue: 70, commission_source: "none", commission_rate: null, rate_label: null }),
  night({ booking_ref: "w1", channel_key: "direct_web", channel_type: "direct", amount: 90, city_tax: 0, revenue_ex_tax: 90, gross_revenue: 90, commission: 0, net_revenue: 90, commission_source: "no_commission", commission_rate: 0, rate_label: null }),
];
const monthly = [
  { month: "2026-09-01", channel_key: "booking_com", channel_type: "ota", commission_source: "ota_note", amount_basis: "gross", currency: "EUR", room_nights: 2, priced_nights: 2, bookings: 2, amount: 207.62, city_tax: 7.62, revenue_ex_tax: 200, gross_revenue: 200, commission: 36, net_revenue: 164, unknown_commission_gross: 0 },
];

beforeEach(() => {
  language = "en";
  rpcResult = (fn) => ({ data: fn === "revenue_channel_economics" ? nights : fn === "revenue_channel_economics_monthly" ? monthly : [], error: null });
});

describe("ChannelEconomicsPanel", () => {
  it("shows gross, commission and net per channel with the evidence behind it", async () => {
    render(<ChannelEconomicsPanel hotelId="gozsdu-court" hotelName="Gozsdu Court" selectedMonth={month} canEdit />);
    expect(await screen.findByText("Channel economics · October 2026")).toBeInTheDocument();
    expect(screen.getAllByText("Gross revenue").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Booking.com").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Expedia").length).toBeGreaterThan(0);
    expect(screen.getByText("Commission Expedia / Agoda kept before paying")).toBeInTheDocument();
    // eDreams has no terms: shown as unknown, never as zero commission
    expect(screen.getByText(/No commission terms yet for eDreams/)).toBeInTheDocument();
    expect(screen.getAllByText("No terms").length).toBeGreaterThan(0);
    // previous month comes from the monthly summary
    expect(screen.getAllByText(/vs Sep/).length).toBeGreaterThan(0);
  });

  it("switches to the Booking.com rate plans", async () => {
    render(<ChannelEconomicsPanel hotelId="gozsdu-court" selectedMonth={month} canEdit={false} />);
    await screen.findByText("Channel economics · October 2026");
    fireEvent.click(screen.getByRole("button", { name: "Booking.com rate plans" }));
    expect(await screen.findAllByText("Mobile rate")).not.toHaveLength(0);
    expect(screen.getAllByText("Non-refundable").length).toBeGreaterThan(0);
  });

  it("speaks Hungarian", async () => {
    language = "hu";
    render(<ChannelEconomicsPanel hotelId="gozsdu-court" selectedMonth={month} canEdit={false} />);
    expect(await screen.findByText("Csatornák és nettó bevétel")).toBeInTheDocument();
    expect((await screen.findAllByText("Nettó bevétel")).length).toBeGreaterThan(0);
  });

  it("explains when the user may not see commission", async () => {
    rpcResult = () => ({ data: null, error: { message: "Not authorised to view channel economics for this hotel", code: "42501" } });
    render(<ChannelEconomicsPanel hotelId="gozsdu-court" selectedMonth={month} canEdit={false} />);
    expect(await screen.findByText(/visible to top management and admins only/)).toBeInTheDocument();
  });

  it("says so when the month has no booked nights", async () => {
    rpcResult = () => ({ data: [], error: null });
    render(<ChannelEconomicsPanel hotelId="gozsdu-court" selectedMonth={month} canEdit={false} />);
    expect(await screen.findByText(/No booked nights for October 2026 yet/)).toBeInTheDocument();
  });
});

describe("RevenueInsightsHub", () => {
  it("groups analyses into sections and mounts only the open item", async () => {
    render(
      <RevenueInsightsHub
        title="Analysis & decisions"
        sections={[
          { key: "performance", label: "Performance", icon: null, question: "Are we on track?", items: [
            { key: "goal", label: "Today's goal", render: () => <p>goal panel</p> },
            { key: "yoy", label: "Year over year", render: () => <p>yoy panel</p> },
          ] },
          { key: "market", label: "Market", icon: null, question: "What is the market doing?", items: [
            { key: "compset", label: "Competitor rates", render: () => <p>compset panel</p> },
          ] },
          { key: "empty", label: "Hidden", icon: null, question: "", items: [] },
        ]}
      />,
    );
    expect(screen.getByText("goal panel")).toBeInTheDocument();
    expect(screen.queryByText("yoy panel")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Hidden" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Year over year" }));
    await waitFor(() => expect(screen.getByText("yoy panel")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Market" }));
    await waitFor(() => expect(screen.getByText("compset panel")).toBeInTheDocument());
    expect(screen.getByText("What is the market doing?")).toBeInTheDocument();
  });
});
