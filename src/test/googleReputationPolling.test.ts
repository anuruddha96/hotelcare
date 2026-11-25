import { describe, expect, it } from "vitest";
import { AUTO_REPLY_WINDOW_DAYS, MAX_REVIEW_PAGES, QUEUE_WINDOW_MINUTES, autoEligible, queuedLocationForMinute, shouldFetchNextReviewPage } from "../../supabase/functions/google-reputation-worker/reviewPolicy";

const now = Date.parse("2026-11-22T09:00:00.000Z");
const hoursAgo = (hours: number) => new Date(now - hours * 60 * 60 * 1000).toISOString();
const enabled = {
  is_active: true,
  auto_reply_enabled: true,
  auto_reply_enabled_at: hoursAgo(48),
  auto_reply_delay_minutes: 15,
  reply_mode: "auto_positive",
  min_auto_rating: 4,
  require_approval_below_rating: 4,
};

describe("three-hour Google review polling safety", () => {
  it("allows 4-5 star low-risk reviews posted after opt-in and delay", () => {
    expect(autoEligible(enabled, 5, "low", hoursAgo(3), now)).toBe(true);
    expect(autoEligible(enabled, 4, "low", hoursAgo(2), now)).toBe(true);
  });

  it("blocks reviews that predate opt-in, even if still within the seven-day window", () => {
    expect(autoEligible(enabled, 5, "low", hoursAgo(72), now)).toBe(false);
  });

  it("blocks low ratings, medium-risk feedback, inactive venues and draft-only settings", () => {
    expect(autoEligible(enabled, 3, "low", hoursAgo(3), now)).toBe(false);
    expect(autoEligible({ ...enabled, min_auto_rating: 1, require_approval_below_rating: 1, reply_mode: "auto_all" }, 2, "low", hoursAgo(3), now)).toBe(false);
    expect(autoEligible(enabled, 5, "medium", hoursAgo(3), now)).toBe(false);
    expect(autoEligible({ ...enabled, is_active: false }, 5, "low", hoursAgo(3), now)).toBe(false);
    expect(autoEligible({ ...enabled, reply_mode: "draft_only" }, 5, "low", hoursAgo(3), now)).toBe(false);
  });

  it("honours configured delay, window and future timestamp safety", () => {
    expect(autoEligible(enabled, 5, "low", hoursAgo(0.1), now)).toBe(false);
    expect(autoEligible({ ...enabled, auto_reply_enabled_at: hoursAgo(10 * 24) }, 5, "low", hoursAgo(8 * 24), now)).toBe(false);
    expect(autoEligible(enabled, 5, "low", new Date(now + 3000).toISOString(), now)).toBe(false);
    expect(AUTO_REPLY_WINDOW_DAYS).toBe(7);
  });

  it("paginates when latest updates are recent even if first page is full", () => {
    const page = [{ updateTime: hoursAgo(6) }, { updateTime: hoursAgo(5) }];
    expect(shouldFetchNextReviewPage(page, "next-token", 1, now)).toBe(true);
    expect(shouldFetchNextReviewPage(page, "", 1, now)).toBe(false);
    expect(shouldFetchNextReviewPage(page, "next-token", MAX_REVIEW_PAGES, now)).toBe(false);
    expect(shouldFetchNextReviewPage([{ updateTime: hoursAgo(25 * 24) }], "next-token", 1, now)).toBe(false);
    expect(shouldFetchNextReviewPage([], "next-token", 1, now)).toBe(false);
  });
  it("queues each Google business exactly once across each 180-minute cycle", () => {
    for (const count of [1, 2, 3, 10, 11, 60, 180]) {
      const scheduled = Array.from({ length: QUEUE_WINDOW_MINUTES }, (_, m) => queuedLocationForMinute(m, count))
        .filter((id): id is number => id !== null);
      expect(scheduled).toEqual(Array.from({ length: count }, (_, i) => i));
    }
  });
  it("stagger-checks 10 listings by 18 minutes", () => {
    const due = Array.from({ length: QUEUE_WINDOW_MINUTES }, (_, minute) => minute)
      .filter((minute) => queuedLocationForMinute(minute, 10) !== null);
    expect(due).toEqual([0, 18, 36, 54, 72, 90, 108, 126, 144, 162]);
  });
  it("rejects out-of-window and unsupported queue sizes", () => {
    expect(queuedLocationForMinute(-1, 10)).toBeNull();
    expect(queuedLocationForMinute(180, 10)).toBeNull();
    expect(queuedLocationForMinute(10, 0)).toBeNull();
    expect(queuedLocationForMinute(10, 181)).toBeNull();
  });

});
