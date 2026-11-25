import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: auth.getSession,
      onAuthStateChange: auth.onAuthStateChange,
      signOut: auth.signOut,
    },
  },
}));
vi.mock("@/hooks/useTranslation", () => ({ useTranslation: () => ({ language: "en" }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import BreakfastAuthControl from "./BreakfastAuthControl";

beforeEach(() => {
  auth.getSession.mockReset();
  auth.onAuthStateChange.mockReset();
  auth.signOut.mockReset();
  auth.unsubscribe.mockReset();
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: auth.unsubscribe } } });
});

describe("BreakfastAuthControl", () => {
  it("takes a signed-out breakfast user to the staff login and preserves the BV route", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    const redirect = vi.fn();

    await act(async () => {
      render(<BreakfastAuthControl returnPath="/bb/org/rdhotels" redirectToAuth={redirect} />);
    });

    fireEvent.click(await screen.findByRole("button", { name: "Staff sign-in" }));
    expect(redirect).toHaveBeenCalledWith("/bb/auth?returnTo=%2Fbb%2Forg%2Frdhotels");
  });

  it("signs out only the current browser session, then opens the staff login", async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user: { id: "breakfast-user", email: "breakfast@example.com" } } },
    });
    auth.signOut.mockResolvedValue({ error: null });
    const redirect = vi.fn();

    await act(async () => {
      render(<BreakfastAuthControl returnPath="/bb" redirectToAuth={redirect} />);
    });

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" }));
    expect(redirect).toHaveBeenCalledWith("/bb/auth?returnTo=%2Fbb");
  });
});
