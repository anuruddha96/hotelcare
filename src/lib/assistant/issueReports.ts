import { supabase } from "@/integrations/supabase/client";
import type { AssistantPageContext } from "@/hooks/useAssistantContext";

/**
 * Sends a problem report to the Hotel Care team. The recipient address lives in
 * a server secret, so it is never present in the browser bundle.
 */
export async function reportAssistantIssue(params: {
  title: string;
  description: string;
  aiSummary?: string | null;
  category?: string;
  severity?: string;
  threadId?: string | null;
  page: AssistantPageContext;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.functions.invoke("assistant-report-issue", {
    body: {
      title: params.title.slice(0, 200),
      description: params.description.slice(0, 4000),
      ai_summary: params.aiSummary ?? null,
      category: params.category ?? "other",
      severity: params.severity ?? "normal",
      thread_id: params.threadId ?? null,
      context: {
        route: params.page.route,
        module: params.page.module,
        tab: params.page.tab,
        entity_type: params.page.entityType,
        entity_id: params.page.entityId,
        device: params.page.device,
        language: params.page.language,
      },
    },
  });
  if (error) return { ok: false, error: "Could not send the report just now." };
  return { ok: true };
}

/** Thumbs up / down on an answer. Stored for the admin insights page. */
export async function sendAssistantFeedback(params: {
  threadId: string;
  messageId: string;
  helpful: boolean;
  reason?: string | null;
  organizationSlug: string | null;
  hotelId: string | null;
}) {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  await supabase.from("assistant_feedback").insert({
    user_id: data.user.id,
    thread_id: params.threadId,
    message_id: params.messageId,
    helpful: params.helpful,
    reason: params.reason ?? null,
    organization_slug: params.organizationSlug,
    hotel_id: params.hotelId,
  });
}
