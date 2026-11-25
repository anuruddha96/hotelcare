// Mira approval requests: a plan Mira prepared (rate plan, schedule plan) is
// stored before it is shown, so the card, the decision and the result survive
// a reload and stay as an audit record. Only Edge Functions (service role)
// write public.assistant_action_requests; the database refuses edits to the
// plan and to a recorded decision.

import { planHash } from "./ratePlan.ts";

export type ActionRequestKind = "rate_plan" | "schedule_plan";

/** Attachment saved with the assistant message; the card loads the request by id. */
export type ActionRequestAttachment = {
  kind: "action_request";
  requestId: string;
  requestKind: ActionRequestKind;
  title: string;
};

export const REQUEST_LIFETIME_HOURS: Record<ActionRequestKind, number> = {
  // Prices move quickly; an old plan must be prepared again.
  rate_plan: 12,
  schedule_plan: 72,
};

export async function createActionRequest(service: any, params: {
  organizationSlug: string;
  hotelId: string;
  threadId: string | null;
  requestedBy: string;
  kind: ActionRequestKind;
  title: string;
  summary: string;
  plan: unknown;
}): Promise<{ ok: true; id: string; expiresAt: string; hash: string } | { ok: false; error: string }> {
  const hash = await planHash(params.plan);
  const expiresAt = new Date(Date.now() + REQUEST_LIFETIME_HOURS[params.kind] * 3_600_000).toISOString();
  const { data, error } = await service
    .from("assistant_action_requests")
    .insert({
      organization_slug: params.organizationSlug,
      hotel_id: params.hotelId,
      thread_id: params.threadId && /^[0-9a-f-]{36}$/i.test(params.threadId) ? params.threadId : null,
      requested_by: params.requestedBy,
      kind: params.kind,
      title: params.title.slice(0, 200),
      summary: params.summary.slice(0, 2000),
      plan: params.plan,
      plan_hash: hash,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error || !data?.id) {
    // Before the migration is applied the table does not exist; the plan is
    // still shown, only without an approval button.
    return { ok: false, error: error?.message ?? "The plan could not be saved for approval" };
  }
  return { ok: true, id: String(data.id), expiresAt, hash };
}
