import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
  callback: null as ((event: string, session: unknown) => void) | null,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: {
    getUser: auth.getUser,
    onAuthStateChange: auth.onAuthStateChange,
  } },
}));
vi.mock("./RestaurantReservations", () => ({
  default: () => <div>Protected reservations loaded</div>,
}));

import RestaurantReservationsGate from "./RestaurantReservationsGate";

beforeEach(() => {
  vi.clearAllMocks();
  auth.callback = null;
  auth.onAuthStateChange.mockImplementation((callback) => {
    auth.callback = callback;
    return { data: { subscription: { unsubscribe: auth.unsubscribe } } };
  });
});

describe("RestaurantReservationsGate shared-device access", () => {
  it("does not mount the guest data list for a signed-out shared tablet", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    render(<RestaurantReservationsGate hotelId="hotel-mika" date="2026-11-22" language="en" />);
    expect(screen.queryByText("Protected reservations loaded")).not.toBeInTheDocument();
    expect(await screen.findByText("Staff sign-in required")).toBeInTheDocument();
    expect(screen.queryByText("Protected reservations loaded")).not.toBeInTheDocument();
  });

  it("mounts reservations only after a verified session", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "verified-staff" } }, error: null });
    render(<RestaurantReservationsGate hotelId="hotel-mika" date="2026-11-22" language="en" />);
    expect(await screen.findByText("Protected reservations loaded")).toBeInTheDocument();
  });

  it("removes guest data on sign-out from a shared device", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "verified-staff" } }, error: null });
    render(<RestaurantReservationsGate hotelId="hotel-mika" date="2026-11-22" language="en" />);
    expect(await screen.findByText("Protected reservations loaded")).toBeInTheDocument();
    await act(async () => { auth.callback?.("SIGNED_OUT", null); });
    await waitFor(() => expect(screen.queryByText("Protected reservations loaded")).not.toBeInTheDocument());
    expect(screen.getByText("Staff sign-in required")).toBeInTheDocument();
  });
});
