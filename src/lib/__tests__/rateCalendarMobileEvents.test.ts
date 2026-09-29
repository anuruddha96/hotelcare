import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installRateCalendarMobileEvents,
  parseMobileEventSummary,
} from "@/lib/rateCalendarMobileEvents";

function mediaResult(matches: boolean): MediaQueryList {
  return {
    matches,
    media: "",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as MediaQueryList;
}

function buildCalendar(eventTitles: string[]) {
  const card = document.createElement("div");
  card.setAttribute("data-training", "revenue-grid");

  const pane = document.createElement("div");
  pane.className = "relative overflow-auto overscroll-x-contain";
  const grid = document.createElement("div");
  const sticky = document.createElement("div");
  sticky.className = "sticky top-0";

  for (let i = 0; i < 7; i += 1) sticky.appendChild(document.createElement("div"));

  const eventsRow = document.createElement("div");
  eventsRow.className = "flex";
  const left = document.createElement("div");
  left.className = "sticky left-0";
  const toggle = document.createElement("button");
  toggle.title = "Hide event names";
  toggle.textContent = "Events";
  left.appendChild(toggle);
  eventsRow.appendChild(left);

  for (const title of eventTitles) {
    const button = document.createElement("button");
    button.title = title;
    const existing = document.createElement("div");
    existing.textContent = "desktop chips";
    button.appendChild(existing);
    eventsRow.appendChild(button);
  }

  sticky.appendChild(eventsRow);
  grid.appendChild(sticky);
  pane.appendChild(grid);
  card.appendChild(pane);
  document.body.appendChild(card);

  return { card, eventsRow, buttons: Array.from(eventsRow.querySelectorAll("button")).slice(1) as HTMLButtonElement[] };
}

async function nextFrame() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe("rateCalendarMobileEvents", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 844, configurable: true });
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) =>
      mediaResult(query.includes("max-width: 767px")),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    document.getElementById("rate-calendar-mobile-events-style")?.remove();
  });

  it("summarizes date, count and the highest impact without exposing more than 4+", () => {
    const summary = parseMobileEventSummary([
      "2026-10-01",
      "1. Medium conference — medium impact",
      "2. Major concert — high impact",
      "3. City festival — low impact",
      "4. Congress — very_high impact",
      "5. Match — medium impact",
    ].join("\n"));

    expect(summary.dateLabel).toBe("1 Oct");
    expect(summary.count).toBe(5);
    expect(summary.countLabel).toBe("4+ events");
    expect(summary.impact).toBe("very-high");
    expect(summary.impactLabel).toBe("Very High");
  });

  it("turns mobile event cells into date/count/impact summaries with an eye only when events exist", async () => {
    const { eventsRow, buttons } = buildCalendar([
      [
        "2026-10-01",
        "1. Congress — high impact",
        "2. Concert — medium impact",
        "3. Match — low impact",
      ].join("\n"),
      "2026-10-02 · no recorded events",
    ]);

    const cleanup = installRateCalendarMobileEvents();
    await nextFrame();

    expect(eventsRow.dataset.rateCalendarMobileEvents).toBe("true");
    expect(buttons[0].dataset.eventDateLabel).toBe("1 Oct");
    expect(buttons[0].dataset.eventCountLabel).toBe("3 events");
    expect(buttons[0].dataset.eventImpactLabel).toBe("High");
    expect(buttons[0].dataset.eventHasEye).toBe("true");
    expect(buttons[0].getAttribute("aria-label")).toContain("Tap to view ranked event details");

    expect(buttons[1].dataset.eventDateLabel).toBe("2 Oct");
    expect(buttons[1].dataset.eventCountLabel).toBe("No events");
    expect(buttons[1].dataset.eventHasEye).toBe("false");

    cleanup();
  });

  it("leaves desktop event cells unchanged", async () => {
    vi.mocked(window.matchMedia).mockImplementation(() => mediaResult(false));
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });

    const { eventsRow, buttons } = buildCalendar([
      "2026-10-01\n1. Congress — high impact",
    ]);

    const cleanup = installRateCalendarMobileEvents();
    await nextFrame();

    expect(eventsRow.dataset.rateCalendarMobileEvents).toBeUndefined();
    expect(buttons[0].dataset.mobileEventSummary).toBeUndefined();
    expect(buttons[0].textContent).toBe("desktop chips");

    cleanup();
  });
});