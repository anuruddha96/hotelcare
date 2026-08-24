import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import type { DraftChange } from "@/lib/rateDrafts";

export interface RejectedCell {
  stay_date: string;
  room_type_name: string;
  occupancy: number;
  reason: string;
}

export interface PublishResult {
  runId: string;
  queued: number;
  skippedSoldOut: number;
  /** Cells that could not be queued at all; everything else still went out. */
  rejected: RejectedCell[];
  /** How many other jobs are waiting ahead of this one. */
  queueAhead: number;
}

/** "Queued — 2 jobs ahead" style line for toasts, or null when it goes out now. */
export function queueNote(result: PublishResult): string | null {
  if (result.queueAhead <= 0) return null;
  return `Queued behind ${result.queueAhead} other job${result.queueAhead === 1 ? "" : "s"} — prices go out automatically.`;
}

export async function publishRates(opts: {
  hotelId: string;
  organizationSlug?: string | null;
  source?: "manual" | "bulk" | "pickup-board" | "automation";
  changes: DraftChange[];
}): Promise<PublishResult> {
  if (opts.changes.length === 0) {
    return { runId: "", queued: 0, skippedSoldOut: 0, rejected: [], queueAhead: 0 };
  }
  const { data, error } = await supabase.functions.invoke("revenue-enqueue-rates", {
    body: {
      hotelId: opts.hotelId,
      organizationSlug: opts.organizationSlug ?? null,
      source: opts.source ?? "manual",
      changes: opts.changes,
    },
  });
  if (error) {
    // The generic "non-2xx status code" tells the user nothing; the body does.
    let detail = error.message;
    if (error instanceof FunctionsHttpError) {
      const text = await error.context.text().catch(() => "");
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed?.error) detail = parsed.error;
      } catch {
        if (text) detail = text.slice(0, 300);
      }
    }
    throw new Error(detail || "Could not send prices to Previo");
  }
  const result = data as {
    runId?: string; queued?: number; skippedSoldOut?: number;
    rejected?: RejectedCell[]; queueAhead?: number; error?: string;
  };
  if (result.error || !result.runId) throw new Error(result.error ?? "Could not send prices to Previo");
  return {
    runId: result.runId,
    queued: result.queued ?? opts.changes.length,
    skippedSoldOut: result.skippedSoldOut ?? 0,
    rejected: result.rejected ?? [],
    queueAhead: result.queueAhead ?? 0,
  };
}
