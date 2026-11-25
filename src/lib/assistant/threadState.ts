/** Persistent, per-user state for Mira conversations. Do not confuse unread with unresolved. */
export type FollowUpStatus = "none" | "open" | "done";

export interface ThreadReadState {
  last_reply_at?: string | null;
  last_read_at?: string | null;
  follow_up_status?: FollowUpStatus | null;
}

/** Only a completed, persisted assistant reply may produce an unread dot. */
export function hasUnreadAssistantReply(thread: ThreadReadState): boolean {
  if (!thread.last_reply_at) return false;
  const latest = Date.parse(thread.last_reply_at);
  const seen = thread.last_read_at ? Date.parse(thread.last_read_at) : NaN;
  return Number.isFinite(latest) && (!Number.isFinite(seen) || latest > seen);
}

export function isOpenFollowUp(thread: ThreadReadState): boolean {
  return thread.follow_up_status === "open";
}
