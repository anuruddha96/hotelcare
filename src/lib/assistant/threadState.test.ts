import { describe, expect, it } from "vitest";
import { hasUnreadAssistantReply, isOpenFollowUp } from "./threadState";

describe("Mira persisted thread state", () => {
  it("does not count a new user message or unsaved response as unread", () => {
    expect(hasUnreadAssistantReply({ last_read_at: "2026-11-13T14:00:00Z" })).toBe(false);
  });
  it("shows unread for a persisted reply after the last viewed reply", () => {
    expect(hasUnreadAssistantReply({
      last_read_at: "2026-11-13T14:00:00Z",
      last_reply_at: "2026-11-13T14:01:00Z",
    })).toBe(true);
  });
  it("clears unread once the same reply was actually seen", () => {
    expect(hasUnreadAssistantReply({
      last_read_at: "2026-11-13T14:01:00Z",
      last_reply_at: "2026-11-13T14:01:00Z",
    })).toBe(false);
  });
  it("does not confuse a task awaiting action with a new unread answer", () => {
    const thread = { follow_up_status: "open" as const, last_read_at: "2026-11-13T14:01:00Z", last_reply_at: "2026-11-13T14:01:00Z" };
    expect(isOpenFollowUp(thread)).toBe(true);
    expect(hasUnreadAssistantReply(thread)).toBe(false);
  });
});
