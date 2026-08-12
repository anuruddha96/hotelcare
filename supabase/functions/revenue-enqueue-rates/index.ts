import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";

const ChangeSchema = z.object({
  stay_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  obk_id: z.string().nullable(),
  room_type_name: z.string().min(1).max(255),
  occupancy: z.number().int().min(1).max(30),
  old_price: z.number().positive().nullable(),
  new_price: z.number().positive().max(10000000),
});

const BodySchema = z.object({
  hotelId: z.string().min(1).max(255),
  organizationSlug: z.string().min(1).max(255).nullable().optional(),
  source: z.enum(["manual", "bulk", "pickup-board", "automation"]).default("manual"),
  changes: z.array(ChangeSchema).min(1).max(20000),
});

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
    const changes = [...byCell.values()];
    const runId = crypto.randomUUID();

    const dates = changes.map((change) => change.stay_date).sort();
    const { data: existingDrafts } = await admin.from("revenue_rate_drafts")
      .select("id,stay_date,room_type_name,occupancy")
      .eq("hotel_id", hotelId).gte("stay_date", dates[0]).lte("stay_date", dates[dates.length - 1])
      .in("status", ["draft", "failed"]);
    const superseded = (existingDrafts ?? []).filter((row) => byCell.has(`${row.stay_date}|${row.room_type_name}|${row.occupancy}`)).map((row) => row.id);
    for (const ids of chunks(superseded, 300)) await admin.from("revenue_rate_drafts").delete().in("id", ids);

    const { error: runError } = await admin.from("revenue_rate_push_runs").insert({
      id: runId, hotel_id: hotelId, organization_slug: organizationSlug ?? profile.organization_slug,
      source, requested_count: changes.length, created_by: user.id,
    });
    if (runError) throw runError;

    const draftIds: string[] = [];
    for (const batch of chunks(changes, 500)) {
      const draftRows = batch.map((change) => ({
        hotel_id: hotelId, organization_slug: organizationSlug ?? profile.organization_slug,
        ...change, status: "draft", push_error: null, created_by: user.id, push_run_id: runId,
        confirmation_status: "sending",
      }));
      const { data: drafts, error } = await admin.from("revenue_rate_drafts").insert(draftRows).select("id,stay_date,room_type_name,occupancy");
      if (error) throw error;
      const idsByCell = new Map((drafts ?? []).map((draft) => [
        `${draft.stay_date}|${draft.room_type_name}|${draft.occupancy}`, draft.id,
      ]));
      draftIds.push(...(drafts ?? []).map((draft) => draft.id));

      const items = batch.map((change) => ({
        run_id: runId, hotel_id: hotelId, organization_slug: organizationSlug ?? profile.organization_slug,
        stay_date: change.stay_date, obk_id: change.obk_id, room_type_name: change.room_type_name,
        occupancy: change.occupancy, old_price: change.old_price, target_price: change.new_price,
        draft_id: idsByCell.get(`${change.stay_date}|${change.room_type_name}|${change.occupancy}`),
      }));
      const { error: itemError } = await admin.from("revenue_rate_push_items").insert(items);
      if (itemError) throw itemError;

    }

    const work = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/revenue-push-drafts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-engine-key": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      },
      body: JSON.stringify({ hotelId, draftIds, pushRunId: runId }),
    }).catch((error) => console.error("background rate push failed to start", runId, error));
    const edgeRuntime = globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } };
    edgeRuntime.EdgeRuntime?.waitUntil(work);

    return json({ ok: true, runId, queued: changes.length });
  } catch (error) {
    console.error("rate enqueue failed", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});