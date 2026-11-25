import { supabase } from "@/integrations/supabase/client";

/** The person's Mira plan and usage, as the server counts it. */
export interface AssistantUsage {
  allowed: boolean;
  tier: "leadership" | "standard" | "none";
  plan: string;
  used: number;
  usedToday: number;
  limit: number | null;
  dailyLimit: number;
  remaining: number | null;
  unlimited: boolean;
  resets_on?: string;
}

export async function fetchAssistantUsage(): Promise<AssistantUsage | null> {
  const { data, error } = await supabase.functions.invoke("assistant-usage", { body: { action: "status" } });
  if (error || !data || typeof data.used !== "number") return null;
  return data as AssistantUsage;
}

/** Sending is paused only when the server says a limit is reached. */
export function usageBlocked(usage: AssistantUsage | null): boolean {
  if (!usage) return false;
  if (usage.tier === "none") return true;
  if (usage.limit !== null && usage.remaining === 0) return true;
  return usage.usedToday >= usage.dailyLimit;
}

/**
 * A short line for the composer, only when it matters: close to a limit or
 * at it. Unlimited plans show nothing (heavy use goes to the administrator).
 */
export function usageNotice(usage: AssistantUsage | null): string | null {
  if (!usage || usage.tier === "none") return null;
  if (usage.usedToday >= usage.dailyLimit) {
    return `Daily limit of ${usage.dailyLimit} messages reached. You can continue later today.`;
  }
  if (usage.limit !== null && usage.remaining !== null) {
    if (usage.remaining === 0) return `You have used your ${usage.limit} messages this month. It resets on the 1st.`;
    if (usage.remaining <= Math.max(20, Math.round(usage.limit * 0.1))) {
      return `${usage.remaining} of ${usage.limit} monthly messages left.`;
    }
  }
  return null;
}
