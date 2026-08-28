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
}

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  refused?: boolean;
  created_at: string;
  /** Set on the newest assistant reply when it hit a scope wall. */
  needsScope?: string | null;
}

export function assistantRowsToUiMessages(rows: AssistantMessage[]): UIMessage[] {
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    parts: [{ type: "text", text: row.content }],
    metadata: row.needsScope ? { needsScope: row.needsScope } : undefined,
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
    let query = supabase
      .from("assistant_threads")
      .select("id,title,updated_at")
      .eq("user_id", user.id);
    query = profile?.organization_slug
      ? query.eq("organization_slug", profile.organization_slug)
      : query.is("organization_slug", null);
    query = profile?.assigned_hotel
      ? query.eq("hotel_id", profile.assigned_hotel)
      : query.is("hotel_id", null);
    const { data, error } = await query.order("updated_at", { ascending: false }).limit(50);
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
      const { data, error } = await supabase
        .from("assistant_messages")
        .select("id,role,content,refused,created_at")
        .eq("thread_id", threadId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
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

  const createThread = useCallback(async (): Promise<string | null> => {
    if (!user) return null;
    // Organization and hotel are filled in by the database from the signed-in
    // profile. Sending them from the client broke chat creation whenever a
    // manager had switched the hotel view (the local profile no longer matches
    // the stored one, and the access rule rejected the row).
    const { data, error } = await supabase
      .from("assistant_threads")
      .insert({ user_id: user.id, title: "New chat" })
      .select("id,title,updated_at")
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

  return {
    threads,
    messages,
    loadingThreads,
    loadingMessages,
    createThread,
    renameThread,
    deleteThread,
    loadThreads,
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
