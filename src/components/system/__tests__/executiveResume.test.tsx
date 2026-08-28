import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isResumeRefreshEligible,
  RESUME_REFRESH_AFTER_MS,
  RESUME_DEBOUNCE_MS,
  EXTENDED_RESUME_AFTER_MS,
  EXECUTIVE_RESUME_EVENT,
} from "@/components/system/ExecutiveResumeRefresh";
import {
  beginRevenueEdit,
  isRevenueEditorDirty,
  runWhenRevenueEditorsClosed,
  __resetRevenueEditGuard,
} from "@/lib/revenueEditGuard";

/**
 * The resume detector itself is a handful of listeners around one decision, so
 * the decision is modelled here exactly as the component implements it. That
 * keeps the role gate, the idle threshold and the duplicate-event collapsing
 * under test without mounting the whole app shell.
 */
function makeResumeMachine(profile: { role?: string | null; is_super_admin?: boolean } | null) {
  const eligible = isResumeRefreshEligible(profile);
  let hiddenSince: number | null = null;
  let lastResumeAt = 0;
  const fired: { idleMs: number; level: string }[] = [];

  return {
    eligible,
    hide(at: number) {
      if (!eligible) return;
      if (hiddenSince === null) hiddenSince = at;
    },
    /** One of visibilitychange / focus / pageshow / online arriving. */
    resume(at: number) {
      if (!eligible) return;
      if (hiddenSince === null) return;
      const idleMs = at - hiddenSince;
      if (at - lastResumeAt < RESUME_DEBOUNCE_MS) { hiddenSince = null; return; }
      if (idleMs < RESUME_REFRESH_AFTER_MS) { hiddenSince = null; return; }
      hiddenSince = null;
      lastResumeAt = at;
      fired.push({ idleMs, level: idleMs >= EXTENDED_RESUME_AFTER_MS ? "extended" : "normal" });
    },
    fired,
  };
}

const MIN = 60 * 1000;

describe("executive resume — role scope", () => {
  it("includes admin, top management and super admins", () => {
    expect(isResumeRefreshEligible({ role: "admin" })).toBe(true);
    expect(isResumeRefreshEligible({ role: "top_management" })).toBe(true);
    expect(isResumeRefreshEligible({ role: "top_management_manager" })).toBe(true);
    expect(isResumeRefreshEligible({ role: "housekeeping", is_super_admin: true })).toBe(true);
  });

  it.each([
    "housekeeping",
    "housekeeping_manager",
    "maintenance",
    "maintenance_manager",
    "reception",
    "front_office",
    "breakfast_staff",
    "supervisor",
    "marketing",
    "finance",
    "control",
    "hr",
    "manager",
  ])("excludes %s", (role) => {
    expect(isResumeRefreshEligible({ role })).toBe(false);
  });

  it("excludes signed-out visitors", () => {
    expect(isResumeRefreshEligible(null)).toBe(false);
  });
});

describe("executive resume — idle threshold", () => {
  it("does nothing after 30 seconds away", () => {
    const m = makeResumeMachine({ role: "top_management" });
    m.hide(0);
    m.resume(30 * 1000);
    expect(m.fired).toHaveLength(0);
  });

  it("fires once after 3 minutes away (top management)", () => {
    const m = makeResumeMachine({ role: "top_management" });
    m.hide(0);
    m.resume(3 * MIN);
    expect(m.fired).toHaveLength(1);
    expect(m.fired[0].level).toBe("normal");
  });

  it("fires once after 3 minutes away (admin)", () => {
    const m = makeResumeMachine({ role: "admin" });
    m.hide(0);
    m.resume(3 * MIN);
    expect(m.fired).toHaveLength(1);
  });

  it("marks long absences as extended", () => {
    const m = makeResumeMachine({ role: "admin", is_super_admin: true });
    m.hide(0);
    m.resume(20 * MIN);
    expect(m.fired[0].level).toBe("extended");
  });

  it.each(["housekeeping", "reception", "maintenance"])(
    "never fires for %s even after 10 minutes",
    (role) => {
      const m = makeResumeMachine({ role });
      m.hide(0);
      m.resume(10 * MIN);
      expect(m.fired).toHaveLength(0);
    },
  );
});

describe("executive resume — duplicate events", () => {
  it("collapses visibilitychange + focus + pageshow into one refresh", () => {
    const m = makeResumeMachine({ role: "top_management" });
    m.hide(0);
    const back = 5 * MIN;
    m.resume(back);       // visibilitychange
    m.resume(back + 10);  // focus
    m.resume(back + 25);  // pageshow
    expect(m.fired).toHaveLength(1);
  });

  it("allows a later, genuinely separate return", () => {
    const m = makeResumeMachine({ role: "admin" });
    m.hide(0);
    m.resume(5 * MIN);
    m.hide(6 * MIN);
    m.resume(9 * MIN);
    expect(m.fired).toHaveLength(2);
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

  it("waits for the last of several editors", () => {
    const refresh = vi.fn();
    const a = beginRevenueEdit("bulk-price-editor");
    const b = beginRevenueEdit("quick-rate-adjust");
    runWhenRevenueEditorsClosed(refresh);
    a();
    expect(refresh).not.toHaveBeenCalled();
    b();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("resume payload contract", () => {
  it("uses a single dedicated event name", () => {
    expect(EXECUTIVE_RESUME_EVENT).toBe("hotelcare:executive-resume");
  });
});
