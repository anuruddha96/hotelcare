import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExecutiveResumeRefresh, {
  isResumeRefreshEligible,
  RESUME_REFRESH_AFTER_MS,
} from "@/components/system/ExecutiveResumeRefresh";
import { useAuth } from "@/hooks/useAuth";
import {
  beginRevenueEdit,
  isRevenueEditorDirty,
  runWhenRevenueEditorsClosed,
  __resetRevenueEditGuard,
} from "@/lib/revenueEditGuard";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));

let now = 1_000_000;
let visibility: DocumentVisibilityState = "visible";
const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");

function auth(role: string | null = "top_management") {
  vi.mocked(useAuth).mockReturnValue({
    user: role ? { id: "test-user" } : null,
    profile: role ? { role } : null,
  } as ReturnType<typeof useAuth>);
}

function returnFromHidden(afterMs: number) {
  visibility = "hidden";
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  now += afterMs;
  visibility = "visible";
  act(() => document.dispatchEvent(new Event("visibilitychange")));
}

beforeEach(() => {
  now = 1_000_000;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  vi.spyOn(Date, "now").mockImplementation(() => now);
  auth();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility);
  else Reflect.deleteProperty(document, "visibilityState");
});

describe("authenticated user idle return — scope", () => {
  it("includes every authenticated HotelCare profile", () => {
    expect(isResumeRefreshEligible({ role: "admin" })).toBe(true);
    expect(isResumeRefreshEligible({ role: "top_management" })).toBe(true);
    expect(isResumeRefreshEligible({ role: "top_management_manager" })).toBe(true);
    expect(isResumeRefreshEligible({ role: "housekeeping" })).toBe(true);
    expect(isResumeRefreshEligible({ role: "maintenance" })).toBe(true);
    expect(isResumeRefreshEligible({ role: "reception" })).toBe(true);
    expect(isResumeRefreshEligible({ role: "manager" })).toBe(true);
    expect(isResumeRefreshEligible({ role: "finance" })).toBe(true);
    expect(isResumeRefreshEligible({ role: "housekeeping", is_super_admin: true })).toBe(true);
    expect(isResumeRefreshEligible(null)).toBe(false);
  });

  it.each(["housekeeping", "maintenance", "reception", "manager", "finance"])(
    "shows the same refresh prompt for operational role %s after 30 minutes",
    (role) => {
      auth(role);
      render(<ExecutiveResumeRefresh />);
      returnFromHidden(RESUME_REFRESH_AFTER_MS);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    },
  );

  it("does not display a dialog for logged-out visitors", () => {
    auth(null);
    render(<ExecutiveResumeRefresh />);
    returnFromHidden(30 * 60_000);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("authenticated user idle return — manual refresh", () => {
  it("does nothing on a short absence and never forces a reload", () => {
    render(<ExecutiveResumeRefresh />);
    returnFromHidden(RESUME_REFRESH_AFTER_MS - 1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows an accessible blurred-background prompt after exactly 30 minutes", () => {
    render(<ExecutiveResumeRefresh />);
    returnFromHidden(RESUME_REFRESH_AFTER_MS);
    expect(RESUME_REFRESH_AFTER_MS).toBe(30 * 60_000);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "You\u0027ve been away for some time" })).toBeInTheDocument();
    const refreshLink = screen.getByRole("link", { name: "Refresh and continue" });
    expect(refreshLink).toBeInTheDocument();
    // Do not rely on React's onClick after a suspended tab returns.
    const refreshUrl = new URL(refreshLink.getAttribute("href")!, window.location.href);
    expect(refreshUrl.pathname).toBe(window.location.pathname);
    expect(refreshUrl.searchParams.get("chunk-recovery")).toBe(String(now));
    expect(screen.queryByText(/unsaved changes|background operational queries|30 minutes without/i)).not.toBeInTheDocument();
  });

  it("allows the refresh action when an underlying Radix modal locks body pointer events", () => {
    // Radix writes pointer-events:none to body while its modal is open.
    // The idle overlay must opt back into pointer interaction or clicks
    // on Refresh HotelCare never reach the browser.
    const previousPointerEvents = document.body.style.pointerEvents;
    document.body.style.pointerEvents = "none";
    try {
      render(<ExecutiveResumeRefresh />);
      returnFromHidden(RESUME_REFRESH_AFTER_MS + 1);
      expect(screen.getByRole("dialog")).toHaveStyle({ pointerEvents: "auto" });
      const refreshLink = screen.getByRole("link", { name: "Refresh and continue" });
      expect(refreshLink.getAttribute("href")).toContain("chunk-recovery=");
    } finally {
      document.body.style.pointerEvents = previousPointerEvents;
    }
  });

  it("handles repeated visibilitychange, focus and pageshow without multiple prompts", () => {
    render(<ExecutiveResumeRefresh />);
    returnFromHidden(RESUME_REFRESH_AFTER_MS + 1);
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("blocks the first click after 30 minutes of foreground inactivity", () => {
    render(<ExecutiveResumeRefresh />);
    const underlyingAction = vi.fn();
    const button = document.createElement("button");
    button.addEventListener("pointerdown", underlyingAction);
    document.body.appendChild(button);
    now += RESUME_REFRESH_AFTER_MS + 1;
    const event = new Event("pointerdown", { bubbles: true, cancelable: true });
    act(() => button.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(underlyingAction).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    button.remove();
  });

  it("clears an open prompt when the user signs out", () => {
    const view = render(<ExecutiveResumeRefresh />);
    returnFromHidden(RESUME_REFRESH_AFTER_MS + 1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    auth(null);
    view.rerender(<ExecutiveResumeRefresh />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("unsaved rate edits", () => {
  beforeEach(() => __resetRevenueEditGuard());

  it("defers a refresh while an editor is open and replays it on close", () => {
    const refresh = vi.fn();
    const release = beginRevenueEdit("bulk-price-editor");
    expect(isRevenueEditorDirty()).toBe(true);
    runWhenRevenueEditorsClosed(refresh);
    expect(refresh).not.toHaveBeenCalled();
    release();
    expect(isRevenueEditorDirty()).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("runs immediately when nothing is dirty", () => {
    const refresh = vi.fn();
    runWhenRevenueEditorsClosed(refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
