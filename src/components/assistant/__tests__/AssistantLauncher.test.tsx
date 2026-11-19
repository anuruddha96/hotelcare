import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1" }, profile: { organization_slug: "rd", role: "top_management" } }),
}));
vi.mock("@/hooks/useAssistant", () => ({ useAssistant: () => ({ threads: [], loadThreads: vi.fn() }) }));
vi.mock("@/lib/assistantAccess", () => ({ canUseAssistant: () => true }));
vi.mock("@/lib/assistant/activeThread", () => ({
  getRememberedAssistantThread: () => null,
  rememberAssistantReturnPath: vi.fn(),
}));

import AssistantLauncher from "../AssistantLauncher";

const originalMatchMedia = window.matchMedia;

function stubMatchMedia(matches: (query: string) => boolean) {
  window.matchMedia = ((query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function renderLauncher() {
  render(
    <MemoryRouter initialEntries={["/rd/revenue"]}>
      <Routes>
        <Route path="/rd/assistant" element={<p>Mira chat</p>} />
        <Route path="*" element={<AssistantLauncher />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Mira launcher", () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    localStorage.clear();
  });

  it("shows only the round, draggable button on phones and tablets", () => {
    stubMatchMedia((query) => query === "(pointer: coarse), (max-width: 767px)");
    renderLauncher();
    const button = screen.getByRole("button", { name: "Open Mira AI Operator" });
    expect(button).toHaveAttribute("data-side", "right");
    expect(screen.queryByText(/Try Mira|Mira Operator/)).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.getByText("Mira chat")).toBeInTheDocument();
  });

  it("keeps the labelled pill on desktop", () => {
    stubMatchMedia(() => false);
    renderLauncher();
    const button = screen.getByRole("button", { name: "Open Mira AI Operator" });
    expect(button).not.toHaveAttribute("data-side");
    expect(button).toHaveTextContent("Mira Operator");
  });
});
