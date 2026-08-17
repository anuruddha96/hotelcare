import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

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

/** Threads + messages for the signed-in user, persisted in the database. */
export function useAssistant(threadId: string | null) {
  const { user, profile } = useAuth();
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const loadThreads = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("assistant_threads")
      .select("id,title,updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(50);
    setThreads((data ?? []) as AssistantThread[]);
  }, [user]);

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
      const { data } = await supabase
        .from("assistant_messages")
        .select("id,role,content,refused,created_at")
        .eq("thread_id", threadId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      if (!cancelled) {
        setMessages((data ?? []) as AssistantMessage[]);
        setLoadingMessages(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [threadId, user]);

  const createThread = useCallback(async (): Promise<string | null> => {
    if (!user) return null;
    const { data, error } = await supabase
      .from("assistant_threads")
      .insert({
        user_id: user.id,
        organization_slug: profile?.organization_slug ?? null,
        hotel_id: profile?.assigned_hotel ?? null,
        title: "New chat",
      })
      .select("id,title,updated_at")
      .single();
    if (error || !data) return null;
    setThreads((t) => [data as AssistantThread, ...t]);
    return data.id;
  }, [user, profile]);

  const deleteThread = useCallback(async (id: string) => {
    await supabase.from("assistant_threads").delete().eq("id", id);
    setThreads((t) => t.filter((x) => x.id !== id));
  }, []);

  const send = useCallback(
    async (question: string, activeThreadId: string) => {
      if (!question.trim() || !user) return;
      setSending(true);
      const optimistic: AssistantMessage = {
        id: `tmp-${Date.now()}`,
        role: "user",
        content: question,
        created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, optimistic]);
      try {
        const { data, error } = await supabase.functions.invoke("assistant-chat", {
          body: {
            thread_id: activeThreadId,
            question,
            language: profile?.["preferred_language" as keyof typeof profile] ?? undefined,
          },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        setMessages((m) => [
          ...m,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: (data as any).answer as string,
            refused: !!(data as any).needs_scope,
            needsScope: (data as any).needs_scope ?? null,
            created_at: new Date().toISOString(),
          },
        ]);
        // First question becomes the thread title.
        const thread = threads.find((t) => t.id === activeThreadId);
        if (!thread || thread.title === "New chat") {
          const title = question.slice(0, 60);
          await supabase.from("assistant_threads").update({ title }).eq("id", activeThreadId);
          setThreads((t) => t.map((x) => (x.id === activeThreadId ? { ...x, title } : x)));
        }
      } catch (e) {
        setMessages((m) => [
          ...m,
          {
            id: `e-${Date.now()}`,
            role: "assistant",
            content: `Sorry — ${e instanceof Error ? e.message : "something went wrong"}.`,
            created_at: new Date().toISOString(),
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [user, profile, threads],
  );

  return { threads, messages, sending, loadingMessages, createThread, deleteThread, send, loadThreads };
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
