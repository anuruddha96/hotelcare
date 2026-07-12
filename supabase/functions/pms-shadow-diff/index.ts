// pms-shadow-diff
//
// Observational-only diff. Accepts an already-normalized snapshot,
// compares against the previous snapshot for (hotel_id, business_date),
// writes `pms_change_events` rows classified by pmsDiff, and stores the
// new snapshot in `pms_snapshots`.
//
// This function DOES NOT mutate room_assignments, rooms, or any
// operational table. It is purely a recorder — so it can be enabled on
// any hotel with zero risk of disrupting current workflows. Auto-apply
// (calling pms_apply_change) is intentionally NOT wired here; that
// happens in a later step gated by pms_configurations flags.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { diffSnapshots } from "../_shared/pmsDiff.ts";
import { normalize, type NormalizedSnapshot, type NormalizedRoom, type XlsxRow, type PrevioApiRow } from "../_shared/pmsNormalizer.ts";

interface RequestBody {
  // Preferred: pre-normalized snapshot.
  snapshot?: NormalizedSnapshot;
  // Alternative: raw rows + meta (function normalizes server-side).
  raw?: {
    rows: XlsxRow[] | PrevioApiRow[];
    hotel_id: string;
    business_date: string;
    source: "xlsx" | "api";
  };
  actor_id?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as RequestBody;
    let snap = body?.snapshot;
    if (!snap && body?.raw) {
      snap = normalize(body.raw.rows, {
        hotelId: body.raw.hotel_id,
        businessDate: body.raw.business_date,
        source: body.raw.source,
      });
    }
    if (!snap?.hotel_id || !snap?.business_date || !Array.isArray(snap?.rooms)) {
      return json({ error: "invalid snapshot payload" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load previous snapshot for the same hotel+date.
    const { data: prevRow } = await supabase
      .from("pms_snapshots")
      .select("rooms, content_hash")
      .eq("hotel_id", snap.hotel_id)
      .eq("business_date", snap.business_date)
      .maybeSingle();

    const previous: NormalizedSnapshot | null = prevRow
      ? {
          hotel_id: snap.hotel_id,
          business_date: snap.business_date,
          source: snap.source,
          content_hash: (prevRow as any).content_hash,
          rooms: (prevRow as any).rooms as NormalizedRoom[],
        }
      : null;

    // Short-circuit: identical content hash = nothing to record.
    if (previous && previous.content_hash === snap.content_hash) {
      return json({
        ok: true,
        noop: true,
        reason: "identical content_hash",
        events_written: 0,
      });
    }

    const diff = diffSnapshots(previous, snap);

    // Resolve room_id (uuid) per previo_room_id / room_number for event rows.
    const numbers = diff.all_changes.map((c) => c.room_number).filter(Boolean);
    const idByNumber = new Map<string, string>();
    if (numbers.length) {
      const { data: rows } = await supabase
        .from("rooms")
        .select("id, room_number, hotel")
        .in("room_number", numbers)
        .eq("hotel", snap.hotel_id);
      for (const r of (rows as any[]) ?? []) {
        idByNumber.set(String(r.room_number), r.id as string);
      }
    }

    // Persist change events (observational only).
    const eventRows = diff.all_changes.map((c) => ({
      hotel_id: snap.hotel_id,
      room_id: idByNumber.get(c.room_number) ?? null,
      room_label: c.room_number,
      event_type: c.kind ?? "unknown",
      source: `shadow_diff:${snap.source}`,
      before: c.before as any,
      after: c.after as any,
      category: c.category,
      change_kind: c.kind,
      auto_applied: false,
      is_conflict: c.category === "risky",
      notes: c.summary,
    }));

    let inserted = 0;
    if (eventRows.length) {
      const { error: insErr, count } = await supabase
        .from("pms_change_events")
        .insert(eventRows, { count: "exact" });
      if (insErr) {
        return json({ error: `insert events failed: ${insErr.message}` }, 500);
      }
      inserted = count ?? eventRows.length;
    }

    // Upsert snapshot.
    const { error: upErr } = await supabase
      .from("pms_snapshots")
      .upsert(
        {
          hotel_id: snap.hotel_id,
          business_date: snap.business_date,
          source: snap.source,
          content_hash: snap.content_hash,
          rooms: snap.rooms as any,
          created_by: body.actor_id ?? null,
        },
        { onConflict: "hotel_id,business_date" },
      );
    if (upErr) {
      return json({ error: `snapshot upsert failed: ${upErr.message}` }, 500);
    }

    return json({
      ok: true,
      noop: false,
      events_written: inserted,
      safe: diff.safe.length,
      risky: diff.risky.length,
      noop_count: diff.noop_count,
    });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
