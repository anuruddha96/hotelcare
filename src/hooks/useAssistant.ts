import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { UIMessage } from "ai";

export interface AssistantThread {
  id: string;
  title: string;
  updated_at: string;
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

/** Threads + messages for the signed-in user, persisted in the database. */
export function useAssistant(threadId: string | null) {
  const { user, profile } = useAuth();
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

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
      return;
    }
    setThreads((data ?? []) as AssistantThread[]);
  }, [user, profile?.organization_slug, profile?.assigned_hotel]);


  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!threadId || !user) {
        setMessages([]);
        return;
      }
      setLoadingMessages(true);
      const { data, error } = await supabase
        .from("assistant_messages")
        .select("id,role,content,refused,created_at")
        .eq("thread_id", threadId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      if (!cancelled && !error) {
        setMessages((data ?? []) as AssistantMessage[]);
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
    setThreads((t) => [data as AssistantThread, ...t]);
    return data.id;
  }, [user]);


  const deleteThread = useCallback(async (id: string) => {
    const { error } = await supabase
      .from("assistant_threads")
      .delete()
      .eq("id", id)
      .eq("user_id", user?.id ?? "");
    if (error) return false;
    setThreads((t) => t.filter((x) => x.id !== id));
    return true;
  }, [user?.id]);

  return { threads, messages, loadingMessages, createThread, deleteThread, loadThreads };
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
