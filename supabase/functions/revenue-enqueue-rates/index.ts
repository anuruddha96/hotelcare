import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";
import { enforceRateSafety } from "../_shared/rateSafety.ts";

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

    {
      const safe = await enforceRateSafety(admin, hotelId, changes as any[]);
      changes = safe.changes as any;
    }

    // Sold-out room types are published too. A date can free up at any moment
    // through a cancellation, and holding its price still made the calendar
    // inconsistent and hard to follow, so every selected cell is sent.
    const skippedSoldOut = 0;
    if (changes.length === 0) {
      return json({ error: "Every selected room type is sold out on those dates — nothing to publish." }, 400);
    }

    const runId = crypto.randomUUID();
    const orgSlug = organizationSlug ?? profile.organization_slug;


    const { priority, intent } = INTENT_BY_SOURCE[source] ?? { priority: 50, intent: source };

    // Durability comes before acknowledgement. The browser may disappear as
    // soon as this function returns, so the run and every item must already be
    // committed before we tell the user that the prices were queued.
    const { error: runError } = await admin.from("revenue_rate_push_runs").insert({
      id: runId, hotel_id: hotelId, organization_slug: orgSlug,
      source, requested_count: changes.length, created_by: user.id, priority,
    });
    if (runError) throw runError;

    const rejected: Array<{ stay_date: string; room_type_name: string; occupancy: number; reason: string }> = [];
    let queued = 0;

    try {
        const dates = changes.map((change) => change.stay_date).sort();
        // Older intents for the same cells are retired BEFORE the new ones are
        // written. Only one live intent per cell may exist, so inserting first
        // used to abort the entire submission on a single leftover row — one
        // stale cell would sink a six-month push. Rows already claimed by the
        // publisher are superseded too: the newest price a person asked for
        // always wins, and the in-flight row is discarded on completion.
        const { data: existingDrafts } = await admin.from("revenue_rate_drafts")
          .select("id,stay_date,room_type_name,occupancy")
          .eq("hotel_id", hotelId).gte("stay_date", dates[0]).lte("stay_date", dates[dates.length - 1])
          .in("status", ["draft", "failed"])
          .is("superseded_at", null);
        const staleIds: string[] = [];
        for (const row of existingDrafts ?? []) {
          const key = `${row.stay_date}|${row.room_type_name}|${row.occupancy}`;
          if (!byCell.has(key)) continue;
          staleIds.push(row.id);
        }
        const supersededAt = new Date().toISOString();
        for (const ids of chunks(staleIds, 300)) {
          const { error: supersedeError } = await admin.from("revenue_rate_drafts")
            .update({ status: "superseded", confirmation_status: "superseded", superseded_at: supersededAt })
            .in("id", ids)
            .is("superseded_at", null)
            .in("status", ["draft", "failed"]);
          if (supersedeError) throw supersedeError;
        }

        const rowFor = (change: z.infer<typeof ChangeSchema>) => ({
          hotel_id: hotelId, organization_slug: orgSlug,
          ...change, status: "draft", push_error: null, created_by: user.id, push_run_id: runId,
          confirmation_status: "sending", priority, intent_source: intent,
        });

        for (const batch of chunks(changes, 500)) {
          let drafts: Array<{ id: string; stay_date: string; room_type_name: string; occupancy: number }> = [];
          const { data: inserted, error } = await admin.from("revenue_rate_drafts")
            .insert(batch.map(rowFor)).select("id,stay_date,room_type_name,occupancy");
          if (error) {
            // A whole chunk must never be lost because of one bad cell: fall
            // back to row-by-row so the rest of the range still goes out, and
            // report the offenders instead of failing the request.
            console.warn("chunk insert failed, isolating rows", error.message);
            for (const change of batch) {
              const { data: one, error: rowError } = await admin.from("revenue_rate_drafts")
                .insert(rowFor(change)).select("id,stay_date,room_type_name,occupancy").maybeSingle();
              if (rowError || !one) {
                rejected.push({
                  stay_date: change.stay_date, room_type_name: change.room_type_name,
                  occupancy: change.occupancy,
                  reason: rowError?.message ?? "Could not be queued",
                });
                continue;
              }
              drafts.push(one);
            }
          } else {
            drafts = inserted ?? [];
          }
          if (drafts.length === 0) continue;

          const idsByCell = new Map(drafts.map((draft) => [
            `${draft.stay_date}|${draft.room_type_name}|${draft.occupancy}`, draft.id,
          ]));

          const items = batch
            .filter((change) => idsByCell.has(`${change.stay_date}|${change.room_type_name}|${change.occupancy}`))
            .map((change) => ({
              run_id: runId, hotel_id: hotelId, organization_slug: orgSlug,
              stay_date: change.stay_date, obk_id: change.obk_id, room_type_name: change.room_type_name,
              occupancy: change.occupancy, old_price: change.old_price, target_price: change.new_price,
              draft_id: idsByCell.get(`${change.stay_date}|${change.room_type_name}|${change.occupancy}`),
            }));
          if (items.length > 0) {
            const { error: itemError } = await admin.from("revenue_rate_push_items")
              .upsert(items, { onConflict: "run_id,stay_date,room_type_name,occupancy" });
            if (itemError) throw itemError;
          }
          queued += drafts.length;
        }

        if (queued === 0) {
          await admin.from("revenue_rate_push_runs").update({
            status: "failed", finished_at: new Date().toISOString(),
            last_error: rejected[0]?.reason?.slice(0, 500) ?? "No price could be queued",
          }).eq("id", runId);
          return json({
            ok: false,
            error: `None of these ${changes.length} prices could be queued. ${rejected[0]?.reason ?? ""}`.trim(),
            rejected: rejected.slice(0, 20),
          }, 200);
        }

        await admin.from("revenue_rate_push_runs")
          .update({ requested_count: queued }).eq("id", runId);

        const kick = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/revenue-publish-queue`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-engine-key": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          },
          body: JSON.stringify({ trigger: "enqueue", continuationBudget: 12 }),
        }).catch((error) => console.error("could not kick publisher queue", runId, error));
        const edgeRuntime = globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } };
        if (edgeRuntime.EdgeRuntime?.waitUntil) edgeRuntime.EdgeRuntime.waitUntil(kick);
        else void kick;
    } catch (error) {
      await admin.from("revenue_rate_push_runs").update({
        status: "failed", finished_at: new Date().toISOString(),
        last_error: error instanceof Error ? error.message : String(error),
      }).eq("id", runId);
      throw error;
    }

    // How many jobs are ahead of this one, so the app can say "queued behind N"
    // instead of leaving the user guessing whether anything happened.
    const { count: ahead } = await admin.from("revenue_rate_push_runs")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "processing"])
      .lt("created_at", new Date().toISOString())
      .neq("id", runId);

    return json({
      ok: true, runId, queued, skippedSoldOut,
      rejectedCount: rejected.length, rejected: rejected.slice(0, 20),
      queueAhead: ahead ?? 0,
    });


  } catch (error) {
    console.error("rate enqueue failed", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});