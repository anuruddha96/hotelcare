// Shared helpers for saving price drafts and sending them to Previo.
//
// The rate grid, the bulk editor and the pickup movement board all do the same
// two things: write drafts, then (optionally) push exactly those drafts. Keeping
// it in one place means a fix to the push path applies everywhere.
import { supabase } from "@/integrations/supabase/client";

export interface DraftChange {
  stay_date: string;
  obk_id: string | null;
  room_type_name: string;
  occupancy: number;
  old_price: number | null;
  new_price: number;
}

const SAVE_CHUNK = 300;

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const cellKeyOf = (stay_date: string, room_type_name: string, occupancy: number) =>
  `${stay_date}|${room_type_name}|${occupancy}`;

/**
 * Replace the active draft for each date/room type/occupancy and return the new
 * ids. Written in chunks so a season-wide bulk change is a handful of requests
 * instead of thousands.
 */
export async function saveRateDrafts(opts: {
  hotelId: string;
  organizationSlug?: string | null;
  changes: DraftChange[];
}): Promise<string[]> {
  if (opts.changes.length === 0) return [];
  const { data: auth } = await supabase.auth.getUser();

  // Keep only the last change per cell so one call never violates the
  // "one active draft per cell" index against itself.
  const byCell = new Map<string, DraftChange>();
  for (const c of opts.changes) {
    byCell.set(cellKeyOf(c.stay_date, c.room_type_name, c.occupancy), c);
  }
  const changes = Array.from(byCell.values());

  const dates = Array.from(new Set(changes.map((c) => c.stay_date))).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];

  // Clear the drafts these changes supersede: read the active ones in the same
  // window, match on the exact cell, delete by id.
  const stale: string[] = [];
  const { data: existing, error: readError } = await supabase
    .from("revenue_rate_drafts")
    .select("id, stay_date, room_type_name, occupancy")
    .eq("hotel_id", opts.hotelId)
    .gte("stay_date", from)
    .lte("stay_date", to)
    .in("status", ["draft", "failed"]);
  if (readError) throw readError;
  for (const row of (existing ?? []) as Array<{ id: string; stay_date: string; room_type_name: string; occupancy: number }>) {
    if (byCell.has(cellKeyOf(row.stay_date, row.room_type_name ?? "", row.occupancy))) stale.push(row.id);
  }
  for (const ids of chunk(stale, 200)) {
    const { error } = await supabase.from("revenue_rate_drafts").delete().in("id", ids);
    if (error) throw error;
  }

  const rows = changes.map((c) => ({
    hotel_id: opts.hotelId,
    organization_slug: opts.organizationSlug ?? null,
    stay_date: c.stay_date,
    obk_id: c.obk_id,
    room_type_name: c.room_type_name,
    occupancy: c.occupancy,
    old_price: c.old_price,
    new_price: c.new_price,
    status: "draft",
    push_error: null,
    created_by: auth.user?.id ?? null,
  }));

  const ids: string[] = [];
  for (const batch of chunk(rows, SAVE_CHUNK)) {
    const { data, error } = await supabase.from("revenue_rate_drafts").insert(batch).select("id");
    if (error) throw error;
    for (const r of (data ?? []) as Array<{ id: string }>) ids.push(r.id);
  }
  return ids;
}

export interface PushOutcome {
  pushed: number;
  failed: number;
  confirmed?: number;
  checking?: number;
  different?: number;
  errors?: Array<{ stay_date: string; room_type_name: string; error: string }>;
  /** Draft ids that did not land — the caller can retry exactly these. */
  failedIds?: string[];
  cancelled?: boolean;
}

/** Send the given drafts to Previo. Throws with Previo's own message on refusal. */
export async function pushRateDrafts(hotelId: string, draftIds: string[], pushRunId?: string): Promise<PushOutcome> {
  const { data, error } = await supabase.functions.invoke("revenue-push-drafts", {
    body: { hotelId, draftIds, pushRunId },
  });
  if (error) throw error;
  const res = data as {
    ok?: boolean; pushed?: number; failed?: number; error?: string;
    pushedIds?: string[];
    failedIds?: string[];
    errors?: Array<{ stay_date: string; room_type_name: string; error: string }>;
  };
  if (res?.error || res?.ok === false) throw new Error(res?.error || "Previo refused the price push.");
  return {
    pushed: res?.pushed ?? 0,
    failed: res?.failed ?? 0,
    checking: res?.pushed ?? 0,
    failedIds: res?.failedIds ?? [],
    errors: res?.errors,
  };
}

/**
 * Send a large set of drafts in batches so one Previo conversation per date and
 * room type never has to fit inside a single function call. Reports progress,
 * keeps going when a batch fails and returns the drafts that still need a retry.
 */
export async function pushRateDraftsBatched(
  hotelId: string,
  draftIds: string[],
  opts: {
    chunkSize?: number;
    onProgress?: (done: number, total: number) => void;
    shouldCancel?: () => boolean;
  } = {},
): Promise<PushOutcome> {
  // Keep each HTTP request short. Previo groups all occupancy levels for one
  // room/date, so 24 drafts is normally about one or two dates and remains recoverable
  // if the browser loses a response after Previo accepted it.
  // Previo accepts a date range per message, and the push function now collapses
  // identical consecutive days into one call, so a large batch is only a handful
  // of Previo messages. Bigger chunks therefore mean far fewer round trips.
  const size = opts.chunkSize ?? 250;
  const batches = chunk(draftIds, size);
  const outcome: PushOutcome = { pushed: 0, failed: 0, errors: [], failedIds: [] };
  const pushRunId = crypto.randomUUID();
  let done = 0;

  let cursor = 0;
  const workers = Array.from({ length: Math.min(3, batches.length) }, async () => {
    while (cursor < batches.length && !opts.shouldCancel?.()) {
      const batch = batches[cursor++];
      try {
        const res = await pushRateDrafts(hotelId, batch, pushRunId);
        outcome.pushed += res.pushed;
        outcome.failed += res.failed;
        if (res.errors?.length) outcome.errors!.push(...res.errors);
        if (res.failedIds?.length) outcome.failedIds!.push(...res.failedIds);
      } catch (e) {
        outcome.failed += batch.length;
        outcome.failedIds!.push(...batch);
        outcome.errors!.push({ stay_date: "", room_type_name: "", error: e instanceof Error ? e.message : String(e) });
      }
      done += batch.length;
      opts.onProgress?.(Math.min(done, draftIds.length), draftIds.length);
    }
  });
  await Promise.all(workers);
  if (opts.shouldCancel?.()) outcome.cancelled = true;
  return outcome;
}
