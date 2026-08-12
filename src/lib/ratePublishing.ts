import { supabase } from "@/integrations/supabase/client";
import type { DraftChange } from "@/lib/rateDrafts";

export async function publishRates(opts: {
  hotelId: string;
  organizationSlug?: string | null;
  source?: "manual" | "bulk" | "pickup-board" | "automation";
  changes: DraftChange[];
}): Promise<{ runId: string; queued: number }> {
  if (opts.changes.length === 0) return { runId: "", queued: 0 };
  const { data, error } = await supabase.functions.invoke("revenue-enqueue-rates", {
    body: {
      hotelId: opts.hotelId,
      organizationSlug: opts.organizationSlug ?? null,
      source: opts.source ?? "manual",
      changes: opts.changes,
    },
  });
  if (error) throw error;
  const result = data as { runId?: string; queued?: number; error?: string };
  if (result.error || !result.runId) throw new Error(result.error ?? "Could not send prices to Previo");
  return { runId: result.runId, queued: result.queued ?? opts.changes.length };
}