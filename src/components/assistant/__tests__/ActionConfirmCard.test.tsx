import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import ActionConfirmCard, { actionFailureMessage, type ActionProposal } from "../ActionConfirmCard";

const proposal: ActionProposal = {
  kind: "action_proposal",
  action: "create_ticket",
  title: "Create a maintenance ticket",
  hotelId: "ottofiori",
  hotelName: "Hotel Ottofiori",
  fields: [{ label: "Room", value: "406" }, { label: "Priority", value: "High" }],
  input: { hotelId: "ottofiori", roomNumber: "406", title: "Possible water leak", description: "Leak near the washroom.", priority: "high", department: "maintenance" },
};

function httpError(body: unknown, status = 400) {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  };
}

describe("ActionConfirmCard", () => {
  beforeEach(() => invoke.mockReset());

  it("shows HotelCare's reason instead of 'non-2xx status code'", async () => {
    invoke.mockResolvedValue({ data: null, error: httpError({ error: "Room 4066 was not found at Hotel Ottofiori. Did you mean 406?" }) });
    render(<ActionConfirmCard proposal={proposal} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Room 4066 was not found at Hotel Ottofiori. Did you mean 406?");
    expect(alert).not.toHaveTextContent(/non-2xx/);
    // Nothing changed, so Confirm stays available for a retry.
    expect(screen.getByRole("button", { name: /Confirm/ })).toBeEnabled();
  });

  it("confirms with the proposal's action and shows the result", async () => {
    invoke.mockResolvedValue({ data: { ok: true, summary: "Ticket TKT-1 created for room 406 at Hotel Ottofiori." }, error: null });
    render(<ActionConfirmCard proposal={proposal} />);
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    await waitFor(() => expect(screen.getByText("Ticket TKT-1 created for room 406 at Hotel Ottofiori.")).toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith("assistant-apply-action", { body: { kind: "create_ticket", input: proposal.input } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never shows the bare transport message", async () => {
    const gateway = { message: "Edge Function returned a non-2xx status code", context: new Response("<html>bad gateway</html>", { status: 502 }) };
    expect(await actionFailureMessage(gateway, null)).toBe("HotelCare could not complete this. Nothing was changed.");
    expect(await actionFailureMessage(null, { ok: false, error: "That property is outside your access" })).toBe("That property is outside your access");
    expect(await actionFailureMessage(null, null)).toBe("HotelCare could not complete this. Nothing was changed.");
  });
});
