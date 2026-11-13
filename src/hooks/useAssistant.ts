import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { UIMessage } from "ai";

export interface AssistantThread {
  id: string;
  title: string;
  updated_at: string;
  /** First line of the newest message, used as the history preview. */
  preview?: string | null;
  /** Set while the conversation is pinned to the top of the sidebar. */
  pinned_at?: string | null;
  /** New replies only: server records when the last assistant message was saved. */
  last_reply_at?: string | null;
  /** Last response the user actually opened. Never cleared merely by entering workspace. */
  last_read_at?: string | null;
  /** Explicit task follow-up is independent of unread and pinned status. */
  follow_up_status?: "none" | "open" | "done";
  /** The project this conversation is filed under, if any. */
  project_id?: string | null;
}

/** A chart or generated image that belongs to an assistant answer. */
export type AssistantAttachment = { kind: string; [key: string]: unknown };

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  refused?: boolean;
  created_at: string;
  /** Set on the newest assistant reply when it hit a scope wall. */
  needsScope?: string | null;
  attachments?: AssistantAttachment[] | null;
}

export function assistantRowsToUiMessages(rows: AssistantMessage[]): UIMessage[] {
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    parts: [{ type: "text", text: row.content }],
    metadata:
      row.needsScope || row.attachments?.length
        ? {
            ...(row.needsScope ? { needsScope: row.needsScope } : {}),
            ...(row.attachments?.length ? { attachments: row.attachments } : {}),
          }
        : undefined,
  }));
}

// Threads survive panel open/close and tab switches so the history list is
// painted instantly instead of flashing an empty state on every open.
const threadCache = new Map<string, AssistantThread[]>();
const messageCache = new Map<string, AssistantMessage[]>();

/** Threads + messages for the signed-in user, persisted in the database. */
export function useAssistant(threadId: string | null) {
  const { user, profile } = useAuth();
  const cacheKey = `${user?.id ?? "anon"}:${profile?.organization_slug ?? ""}:${profile?.assigned_hotel ?? ""}`;
  const [threads, setThreads] = useState<AssistantThread[]>(() => threadCache.get(cacheKey) ?? []);
  const [messages, setMessages] = useState<AssistantMessage[]>(() =>
    threadId ? (messageCache.get(threadId) ?? []) : [],
  );
  const [loadingThreads, setLoadingThreads] = useState(() => !threadCache.has(cacheKey));
  const [loadingMessages, setLoadingMessages] = useState(false);
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;

  const loadThreads = useCallback(async () => {
    if (!user) return;
    // A user without an assigned property saves threads with a null hotel and
    // organisation. Matching those with .eq("", ...) never hit a row, so their
    // history looked wiped; null scopes are matched with .is() instead.
    const run = (columns: string) => {
      let query = (supabase as any)
        .from("assistant_threads")
        .select(columns)
        .eq("user_id", user.id);
      query = profile?.organization_slug
        ? query.eq("organization_slug", profile.organization_slug)
        : query.is("organization_slug", null);
      query = profile?.assigned_hotel
        ? query.eq("hotel_id", profile.assigned_hotel)
        : query.is("hotel_id", null);
      return query.order("updated_at", { ascending: false }).limit(100);
    };
    // Pins and projects arrive with the workspace migration; until it has been
    // applied the history still loads from the original columns.
    let { data, error } = await run("id,title,updated_at,pinned_at,project_id,last_reply_at,last_read_at,follow_up_status");
    // Deploy migration before expecting unread / follow-up across devices.
    if (error) ({ data, error } = await run("id,title,updated_at,pinned_at,project_id"));
    if (error) ({ data, error } = await run("id,title,updated_at"));
    if (error) {
      console.error("Failed to load assistant threads", error);
      setLoadingThreads(false);
      return;
    }
    const rows = (data ?? []) as AssistantThread[];

    // One extra read gives every row a readable preview line.
    const ids = rows.map((row) => row.id);
    let previews = new Map<string, string>();
    if (ids.length) {
      const { data: recent } = await supabase
        .from("assistant_messages")
        .select("thread_id,content,created_at")
        .eq("user_id", user.id)
        .in("thread_id", ids)
        .order("created_at", { ascending: false })
        .limit(300);
      previews = new Map();
      for (const row of recent ?? []) {
        if (!previews.has(row.thread_id)) {
          previews.set(row.thread_id, String(row.content ?? "").replace(/\s+/g, " ").trim().slice(0, 120));
        }
      }
    }
    const withPreview = rows.map((row) => ({ ...row, preview: previews.get(row.id) ?? null }));
    threadCache.set(cacheKeyRef.current, withPreview);
    setThreads(withPreview);
    setLoadingThreads(false);
  }, [user, profile?.organization_slug, profile?.assigned_hotel]);

  useEffect(() => {
    // Paint whatever is cached for this scope first, then refresh quietly.
    const cached = threadCache.get(cacheKey);
    if (cached) {
      setThreads(cached);
      setLoadingThreads(false);
    } else {
      setLoadingThreads(Boolean(user));
    }
    loadThreads();
  }, [cacheKey, loadThreads, user]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!threadId || !user) {
        setMessages([]);
        return;
      }
      const cached = messageCache.get(threadId);
      if (cached) setMessages(cached);
      setLoadingMessages(!cached);
      const read = (columns: string) =>
        (supabase as any)
          .from("assistant_messages")
          .select(columns)
          .eq("thread_id", threadId)
          .eq("user_id", user.id)
          .order("created_at", { ascending: true });
      let { data, error } = await read("id,role,content,refused,created_at,attachments");
      if (error) ({ data, error } = await read("id,role,content,refused,created_at"));
      if (!cancelled && !error) {
        const rows = (data ?? []) as AssistantMessage[];
        messageCache.set(threadId, rows);
        setMessages(rows);
      }
      if (error) console.error("Failed to load assistant messages", error);
      if (!cancelled) setLoadingMessages(false);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [threadId, user]);

  const createThread = useCallback(async (projectId?: unknown): Promise<string | null> => {
    if (!user) return null;
    // Often wired straight to onClick, so anything but an id is ignored.
    const project = typeof projectId === "string" && projectId ? projectId : null;
    // Organization and hotel are filled in by the database from the signed-in
    // profile. Sending them from the client broke chat creation whenever a
    // manager had switched the hotel view (the local profile no longer matches
    // the stored one, and the access rule rejected the row).
    const { data, error } = await (supabase as any)
      .from("assistant_threads")
      .insert({ user_id: user.id, title: "New chat", ...(project ? { project_id: project } : {}) })
      .select(project ? "id,title,updated_at,pinned_at,project_id" : "id,title,updated_at")
      .single();
    if (error || !data) {
      console.error("assistant: could not create thread", error);
      return null;
    }
    setThreads((t) => {
      const next = [data as AssistantThread, ...t];
      threadCache.set(cacheKeyRef.current, next);
      return next;
    });
    return data.id;
  }, [user]);

  /** User-chosen title. Locked so the automatic topic title never replaces it. */
  const renameThread = useCallback(
    async (id: string, title: string) => {
      const clean = title.replace(/\s+/g, " ").trim().slice(0, 60);
      if (!clean) return false;
      const { error } = await supabase
        .from("assistant_threads")
        .update({ title: clean, title_locked: true })
        .eq("id", id)
        .eq("user_id", user?.id ?? "");
      if (error) {
        console.error("assistant: rename failed", error);
        return false;
      }
      setThreads((t) => {
        const next = t.map((x) => (x.id === id ? { ...x, title: clean } : x));
        threadCache.set(cacheKeyRef.current, next);
        return next;
      });
      return true;
    },
    [user?.id],
  );

  const deleteThread = useCallback(async (id: string) => {
    const { error } = await supabase
      .from("assistant_threads")
      .delete()
      .eq("id", id)
      .eq("user_id", user?.id ?? "");
    if (error) return false;
    messageCache.delete(id);
    setThreads((t) => {
      const next = t.filter((x) => x.id !== id);
      threadCache.set(cacheKeyRef.current, next);
      return next;
    });
    return true;
  }, [user?.id]);

  const patchThread = useCallback(
    async (id: string, patch: {
      pinned_at?: string | null;
      project_id?: string | null;
      follow_up_status?: "none" | "open" | "done";
    }) => {
      const { error } = await (supabase as any)
        .from("assistant_threads")
        .update(patch)
        .eq("id", id)
        .eq("user_id", user?.id ?? "");
      if (error) {
        console.error("assistant: thread update failed", error);
        return false;
      }
      setThreads((t) => {
        const next = t.map((x) => (x.id === id ? { ...x, ...patch } : x));
        threadCache.set(cacheKeyRef.current, next);
        return next;
      });
      return true;
    },
    [user?.id],
  );

  /** Pin to, or release from, the top of the sidebar. */
  const setThreadPinned = useCallback(
    (id: string, pinned: boolean) => patchThread(id, { pinned_at: pinned ? new Date().toISOString() : null }),
    [patchThread],
  );

  /** Mark an unresolved task as open, done or clear. Does not affect unread replies. */
  const setThreadFollowUpStatus = useCallback(
    (id: string, status: "none" | "open" | "done") => patchThread(id, { follow_up_status: status }),
    [patchThread],
  );

  /** Acknowledge the timestamp actually rendered, never unseen newer replies. */
  const markThreadRead = useCallback(async (id: string, visibleAssistantAt: string) => {
    if (!user?.id || typeof document === "undefined" || document.visibilityState !== "visible") return false;
    if (!Number.isFinite(Date.parse(visibleAssistantAt))) return false;
    // Atomic DB function keeps multi-device acknowledgments monotonic.
    const { error } = await (supabase as any).rpc("hc_mira_mark_thread_read", {
      p_thread_id: id,
      p_last_seen_at: visibleAssistantAt,
    });
    if (error) {
      console.error("assistant: mark read failed", error);
      return false;
    }
    setThreads((current) => {
      const next = current.map((t) => {
        if (t.id !== id || !t.last_reply_at) return t;
        const seenMs = Math.min(Date.parse(t.last_reply_at), Date.parse(visibleAssistantAt));
        return { ...t, last_read_at: new Date(Math.max(Date.parse(t.last_read_at ?? "") || 0, seenMs)).toISOString() };
      });
      threadCache.set(cacheKeyRef.current, next);
      return next;
    });
    return true;
  }, [user?.id]);

  /** File a conversation under a project, or take it out with `null`. */
  const moveThreadToProject = useCallback(
    (id: string, projectId: string | null) => patchThread(id, { project_id: projectId }),
    [patchThread],
  );

  return {
    threads,
    messages,
    loadingThreads,
    loadingMessages,
    createThread,
    renameThread,
    deleteThread,
    loadThreads,
    setThreadPinned,
    setThreadFollowUpStatus,
    markThreadRead,
    moveThreadToProject,
  };
}

/** Ask a manager for temporary access to a data area. */
export async function requestAssistantAccess(params: {
  userId: string;
  orgSlug: string | null;
  hotelId: string | null;
  scope: string;
  question: string;
  reason?: string;
}) {
  return supabase.from("assistant_access_requests").insert({
    user_id: params.userId,
    organization_slug: params.orgSlug,
    hotel_id: params.hotelId,
    requested_scope: params.scope,
    question: params.question,
    reason: params.reason ?? null,
  });
}

export interface AssistantSearchHit {
  threadId: string;
  title: string;
  snippet: string;
  updated_at: string;
}

/**
 * Search the signed-in user's own conversations by title and message text.
 * Row-level security already limits both tables to the caller's own threads.
 */
export async function searchAssistantThreads(userId: string, term: string): Promise<AssistantSearchHit[]> {
  const clean = term.replace(/[%_,()\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (clean.length < 2) return [];
  const pattern = `%${clean}%`;
  const [titles, bodies] = await Promise.all([
    supabase.from("assistant_threads").select("id,title,updated_at").eq("user_id", userId).ilike("title", pattern).order("updated_at", { ascending: false }).limit(20),
    supabase.from("assistant_messages").select("thread_id,content,created_at").eq("user_id", userId).ilike("content", pattern).order("created_at", { ascending: false }).limit(40),
  ]);
  const hits = new Map<string, AssistantSearchHit>();
  for (const row of titles.data ?? []) {
    hits.set(row.id, { threadId: row.id, title: row.title, snippet: "", updated_at: row.updated_at });
  }
  const missing = [...new Set((bodies.data ?? []).map((row) => row.thread_id))].filter((id) => !hits.has(id));
  const extra = missing.length
    ? await supabase.from("assistant_threads").select("id,title,updated_at").eq("user_id", userId).in("id", missing)
    : { data: [] as { id: string; title: string; updated_at: string }[] };
  for (const row of extra.data ?? []) {
    hits.set(row.id, { threadId: row.id, title: row.title, snippet: "", updated_at: row.updated_at });
  }
  const needle = clean.toLowerCase();
  for (const row of bodies.data ?? []) {
    const hit = hits.get(row.thread_id);
    if (!hit || hit.snippet) continue;
    const text = String(row.content ?? "").replace(/\s+/g, " ");
    const at = Math.max(0, text.toLowerCase().indexOf(needle) - 40);
    hit.snippet = `${at > 0 ? "…" : ""}${text.slice(at, at + 140)}`;
  }
  return [...hits.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 25);
}
