import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RevenueCalendarExperience from "@/components/revenue/RevenueCalendarExperience";

function touch(type: string, x: number, y: number) {
  const point = { clientX: x, clientY: y } as Touch;
  return new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    touches: type === "touchend" ? [] : [point],
    changedTouches: [point],
  });
}

describe("RevenueCalendarExperience", () => {
  beforeEach(() => {
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
      matches: query.includes("767"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("marks the revenue calendar and its scrolling pane", async () => {
    render(<RevenueCalendarExperience />);
    const card = document.createElement("div");
    card.setAttribute("data-training", "revenue-grid");
    const pane = document.createElement("div");
    pane.className = "relative overflow-auto overscroll-x-contain";
    card.appendChild(pane);
    document.body.appendChild(card);

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(card.dataset.rateCalendarV2).toBe("true");
    expect(pane.dataset.rateGridScroll).toBe("true");
  });

  it("hands a vertical boundary swipe to the page", async () => {
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
    render(<RevenueCalendarExperience />);
    const card = document.createElement("div");
    card.setAttribute("data-training", "revenue-grid");
    const pane = document.createElement("div");
    pane.className = "relative overflow-auto overscroll-x-contain";
    Object.defineProperty(pane, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(pane, "scrollHeight", { value: 600, configurable: true });
    pane.scrollTop = 300;
    card.appendChild(pane);
    document.body.appendChild(card);

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    pane.dispatchEvent(touch("touchstart", 100, 200));
    pane.dispatchEvent(touch("touchmove", 100, 150));

    expect(scrollBy).toHaveBeenCalled();
  });
});
