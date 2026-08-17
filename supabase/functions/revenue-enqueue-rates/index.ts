import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";

const ChangeSchema = z.object({
  stay_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  obk_id: z.string().nullable(),
  room_type_name: z.string().min(1).max(255),
  occupancy: z.number().int().min(1).max(30),
  old_price: z.number().positive().nullable(),
  // Whole prices only. Cents make the PMS pricelist unreadable and every OTA
  // shows them, so a fractional target is rounded to the nearest whole unit
  // before anything is queued or mirrored.
  new_price: z.number().positive().max(10000000).transform((v) => Math.round(v)),
});

const BodySchema = z.object({
  hotelId: z.string().min(1).max(255),
  organizationSlug: z.string().min(1).max(255).nullable().optional(),
  source: z.enum(["manual", "bulk", "pickup-board", "automation"]).default("manual"),
  changes: z.array(ChangeSchema).min(1).max(20000),
});

// Queue priority + intent labelling. Lower number = published first.
// Manager work (single cell, bulk edit, pickup board) always outranks the
// automation engine's own pickup (20) / reconcile (30) / markdown (40) runs.
const INTENT_BY_SOURCE: Record<string, { priority: number; intent: string }> = {
  manual: { priority: 10, intent: "manual" },
  bulk: { priority: 10, intent: "manual_bulk" },
  "pickup-board": { priority: 10, intent: "manual_pickup_board" },
  automation: { priority: 40, intent: "automation_legacy" },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});


const chunks = <T>(values: T[], size: number) => {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: userResult } = await admin.auth.getUser(token);
    const user = userResult.user;
    if (!user) return json({ error: "Not signed in" }, 401);

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const { hotelId, organizationSlug, source } = parsed.data;

    const { data: profile } = await admin.from("profiles")
      .select("role, assigned_hotel, organization_slug").eq("id", user.id).maybeSingle();
    const roles = ["admin", "top_management", "top_management_manager"];
    if (!profile || !roles.includes(String(profile.role))) return json({ error: "You cannot publish rates" }, 403);
    const { data: canAccess } = await admin.rpc("user_can_access_hotel", { _uid: user.id, _hotel_id: hotelId });
    if (!canAccess) return json({ error: "You cannot publish rates for this hotel" }, 403);

    const byCell = new Map<string, z.infer<typeof ChangeSchema>>();
    for (const change of parsed.data.changes) {
      byCell.set(`${change.stay_date}|${change.room_type_name}|${change.occupancy}`, change);
    }
    let changes = [...byCell.values()];

    // A sold-out room type has nothing left to sell on that date, so changing
    // its price is noise (and can even hurt future rate integrity). Those cells
    // are dropped here; every other date/room type in the same selection is
    // still published.
    let skippedSoldOut = 0;
    try {
      const dateList = changes.map((c) => c.stay_date).sort();
       const [{ data: capacityRows }, { data: nightRows }] = await Promise.all([
         admin.from("room_types").select("name, pms_room_id, num_rooms, counts_toward_inventory")
           .eq("hotel_id", hotelId).eq("organization_slug", profile.organization_slug),
         admin.from("revenue_booking_nights").select("stay_date, obk_id, room_type_name")
          .eq("hotel_id", hotelId)
           .eq("organization_slug", profile.organization_slug)
          .gte("stay_date", dateList[0]).lte("stay_date", dateList[dateList.length - 1])
          .limit(50000),
      ]);
      const capacity = new Map<string, number>();
      for (const row of capacityRows ?? []) {
        const rooms = Number((row as any).num_rooms);
        if ((row as any).counts_toward_inventory === false || !Number.isFinite(rooms) || rooms <= 0) continue;
         const name = String((row as any).name).trim().toLowerCase();
         const obk = String((row as any).pms_room_id ?? "").trim();
         capacity.set(`name:${name}`, rooms);
         if (obk) capacity.set(`obk:${obk}`, rooms);
      }
      const sold = new Map<string, number>();
      for (const row of nightRows ?? []) {
         const date = String((row as any).stay_date);
         const name = String((row as any).room_type_name ?? "").trim().toLowerCase();
         const obk = String((row as any).obk_id ?? "").trim();
         if (name) sold.set(`${date}|name:${name}`, (sold.get(`${date}|name:${name}`) ?? 0) + 1);
         if (obk) sold.set(`${date}|obk:${obk}`, (sold.get(`${date}|obk:${obk}`) ?? 0) + 1);
      }
      if (capacity.size > 0) {
        const kept = changes.filter((change) => {
          const name = change.room_type_name.trim().toLowerCase();
           const obk = String(change.obk_id ?? "").trim();
           const identity = obk && capacity.has(`obk:${obk}`) ? `obk:${obk}` : `name:${name}`;
           const rooms = capacity.get(identity);
          if (!rooms) return true;
           return (sold.get(`${change.stay_date}|${identity}`) ?? 0) < rooms;
        });
        skippedSoldOut = changes.length - kept.length;
        if (kept.length > 0) changes = kept;
      }
    } catch (soldOutError) {
      console.error("sold-out filter skipped", soldOutError);
    }
    if (changes.length === 0) {
      return json({ error: "Every selected room type is sold out on those dates — nothing to publish." }, 400);
    }

    const runId = crypto.randomUUID();
    const orgSlug = organizationSlug ?? profile.organization_slug;


    const { priority, intent } = INTENT_BY_SOURCE[source] ?? { priority: 50, intent: source };

    // The only work the caller waits for: record the run. Everything else —
    // expanding drafts, queueing items, sending to Previo — happens after the
    // response so a 6-month bulk edit returns as fast as a single cell.
    const { error: runError } = await admin.from("revenue_rate_push_runs").insert({
      id: runId, hotel_id: hotelId, organization_slug: orgSlug,
      source, requested_count: changes.length, created_by: user.id, priority,
    });
    if (runError) throw runError;

    const expandAndPush = async () => {
      try {
        const dates = changes.map((change) => change.stay_date).sort();
        // Older intents for the same cells are superseded, never deleted: the
        // audit trail of "what we meant to send" has to survive. Rows already
        // claimed by the publisher are left alone — this run queues behind them.
        const { data: existingDrafts } = await admin.from("revenue_rate_drafts")
          .select("id,stay_date,room_type_name,occupancy")
          .eq("hotel_id", hotelId).gte("stay_date", dates[0]).lte("stay_date", dates[dates.length - 1])
          .in("status", ["draft", "failed"])
          .is("superseded_at", null)
          .is("claimed_at", null);
        const staleByCell = new Map<string, string[]>();
        for (const row of existingDrafts ?? []) {
          const key = `${row.stay_date}|${row.room_type_name}|${row.occupancy}`;
          if (!byCell.has(key)) continue;
          staleByCell.set(key, [...(staleByCell.get(key) ?? []), row.id]);
        }

        for (const batch of chunks(changes, 500)) {
          const draftRows = batch.map((change) => ({
            hotel_id: hotelId, organization_slug: orgSlug,
            ...change, status: "draft", push_error: null, created_by: user.id, push_run_id: runId,
            confirmation_status: "sending", priority, intent_source: intent,
          }));
          const { data: drafts, error } = await admin.from("revenue_rate_drafts").insert(draftRows).select("id,stay_date,room_type_name,occupancy");
          if (error) throw error;
          const idsByCell = new Map((drafts ?? []).map((draft) => [
            `${draft.stay_date}|${draft.room_type_name}|${draft.occupancy}`, draft.id,
          ]));

          // Successors exist now, so each superseded row can point at the one
          // that replaced it.
          const supersededAt = new Date().toISOString();
          for (const [key, successorId] of idsByCell) {
            const stale = staleByCell.get(key);
            if (!stale?.length) continue;
            for (const ids of chunks(stale, 300)) {
              await admin.from("revenue_rate_drafts")
                .update({ status: "superseded", superseded_at: supersededAt, superseded_by: successorId })
                .in("id", ids)
                .is("superseded_at", null)
                .is("claimed_at", null)
                .in("status", ["draft", "failed"]);
            }
            staleByCell.delete(key);
          }


          const items = batch.map((change) => ({
            run_id: runId, hotel_id: hotelId, organization_slug: orgSlug,
            stay_date: change.stay_date, obk_id: change.obk_id, room_type_name: change.room_type_name,
            occupancy: change.occupancy, old_price: change.old_price, target_price: change.new_price,
            draft_id: idsByCell.get(`${change.stay_date}|${change.room_type_name}|${change.occupancy}`),
          }));
          const { error: itemError } = await admin.from("revenue_rate_push_items").insert(items);
          if (itemError) throw itemError;
        }

        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/revenue-push-drafts`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-engine-key": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          },
          body: JSON.stringify({ hotelId, pushRunId: runId }),
        });
      } catch (error) {
        console.error("background rate expansion failed", runId, error);
        await admin.from("revenue_rate_push_runs").update({
          status: "failed", finished_at: new Date().toISOString(),
          last_error: error instanceof Error ? error.message : String(error),
        }).eq("id", runId);
      }
    };

    const edgeRuntime = globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } };
    if (edgeRuntime.EdgeRuntime?.waitUntil) edgeRuntime.EdgeRuntime.waitUntil(expandAndPush());
    else void expandAndPush();

    return json({ ok: true, runId, queued: changes.length, skippedSoldOut });

  } catch (error) {
    console.error("rate enqueue failed", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});