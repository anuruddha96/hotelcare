// Push confirmed rate drafts back to Previo.
//
// The grid stores every manual price change as a draft; nothing leaves the
// app until someone with rate-push rights confirms. This function validates
// the caller, sends each draft to Previo through the confirmed rate-write
// method, mirrors accepted prices immediately, then verifies them against
// Previo in background so a partial failure is visible instead of silent.
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadPrevioCredentials, hasPrevioCredentials } from "../_shared/previoCredentials.ts";
import { writePrevioRate, readPrevioRateLevels } from "../_shared/previoRateWrite.ts";
import { syncPrevioRatePlanMappings } from "../_shared/previoRatePlans.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PUSH_ROLES = ["admin", "top_management", "top_management_manager"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // --- caller must be signed in and allowed to push rates -------------
    // The pickup automation engine runs with no human in the loop, so it
    // authenticates with the service-role key instead of a user session.
    const engineKey = req.headers.get("x-engine-key") ?? "";
    const isEngine = engineKey.length > 0 &&
      engineKey === (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "\u0000");

    let profile: { role: string; assigned_hotel: string | null; organization_slug: string | null } | null = null;
    let pusherLabel = "pickup automation";


    if (!isEngine) {
      const authHeader = req.headers.get("Authorization") ?? "";
      const token = authHeader.replace("Bearer ", "");
      if (!token) return json({ error: "Not signed in" }, 401);

      const { data: userRes } = await admin.auth.getUser(token);
      const user = userRes?.user;
      if (!user) return json({ error: "Not signed in" }, 401);
      pusherLabel = user.email ?? user.id;

      const { data: profileRow } = await admin
        .from("profiles")
        .select("role, assigned_hotel, organization_slug")
        .eq("id", user.id)
        .maybeSingle();
      profile = profileRow as any;

      if (!profile || !PUSH_ROLES.includes(String(profile.role))) {
        return json({ error: "You do not have permission to push rates" }, 403);
      }
    }

    const body = await req.json().catch(() => ({}));
    const hotelId: string | null = typeof body.hotelId === "string" ? body.hotelId : null;
    const draftIds: string[] = Array.isArray(body.draftIds) ? body.draftIds : [];
    const requestedRunId: string | null = typeof body.pushRunId === "string" ? body.pushRunId : null;
    if (!hotelId) return json({ error: "hotelId is required" }, 400);

    if (profile && profile.role !== "admin" && profile.assigned_hotel && profile.assigned_hotel !== hotelId) {
      return json({ error: "You can only push rates for your own hotel" }, 403);
    }


    // --- PMS config + rate-plan mapping ---------------------------------
    // SLNT-style hotels have no pms_configurations row at all (they run on
    // pms_accounts), so a missing row is not by itself a failure. Only a real
    // read error, or no usable Previo account anywhere, stops the push.
    const { data: cfg, error: cfgErr } = await admin
      .from("pms_configurations")
      .select("hotel_id, pms_hotel_id, credentials_secret_name, is_active")
      .eq("hotel_id", hotelId)
      .maybeSingle();
    if (cfgErr) {
      return json({ ok: false, code: "pms_read_failed", error: `Could not read the PMS configuration: ${cfgErr.message}` });
    }
    const { data: activeAccounts } = await admin
      .from("pms_accounts")
      .select("pms_hotel_id, credentials_secret_name")
      .eq("hotel_id", hotelId)
      .eq("is_active", true);
    const hasAccounts = ((activeAccounts ?? []) as any[]).some(
      (a) => a.pms_hotel_id && hasPrevioCredentials(a.credentials_secret_name),
    );
    if (!hasAccounts && (!cfg || !cfg.is_active)) {
      return json({ ok: false, code: "pms_inactive", error: "PMS is not configured or is inactive for this hotel." });
    }

    const { data: orgRow } = await admin
      .from("room_types")
      .select("organization_slug")
      .eq("hotel_id", hotelId)
      .limit(1)
      .maybeSingle();
    const hotelOrgSlug: string | null = (orgRow as any)?.organization_slug ?? null;


    const loadMaps = async () => {
      const { data } = await admin
        .from("previo_rate_plan_mapping")
        .select("room_type_id, previo_rate_plan_id, previo_room_type_id, is_default")
        .eq("hotel_id", hotelId);
      return ((data ?? []) as any[]).filter((m) => m.previo_rate_plan_id && m.previo_room_type_id);
    };

    let validMaps = await loadMaps();
    let mappingNote = "";
    if (validMaps.length === 0) {
      // Nobody typed the pricelist ids — read them from Previo instead of failing.
      const derived = await syncPrevioRatePlanMappings(admin, hotelId);
      mappingNote = derived.notes.join(" ");
      validMaps = await loadMaps();
    }
    if (validMaps.length === 0) {
      return json({
        ok: false,
        code: "no_mapping",
        error: `No Previo pricelist could be resolved for this hotel. ${mappingNote} Run a revenue sync, then try “Sync rate plans” again.`.trim(),
      });
    }
    const defaultMap = validMaps.find((m: any) => m.is_default) ?? validMaps[0];


    const { data: settings } = await admin
      .from("hotel_revenue_settings")
      .select("rate_write_method, base_currency")
      .eq("hotel_id", hotelId)
      .maybeSingle();

    let writeMethod: string | null = settings?.rate_write_method ?? null;

    // --- drafts to push --------------------------------------------------
    // A six-month edit can be thousands of prices. One invocation handles a
    // bounded slice and then calls itself for the rest, so a long range never
    // hits the function time limit and never needs the browser to stay open.
    const SLICE = 400;
    let q = admin
      .from("revenue_rate_drafts")
      .select("id, stay_date, obk_id, room_type_name, occupancy, old_price, new_price, currency, created_by, organization_slug")
      .eq("hotel_id", hotelId)
      .order("stay_date", { ascending: true })
      .limit(SLICE);
    if (draftIds.length > 0) {
      q = q.in("id", draftIds.slice(0, SLICE)).in("status", ["draft", "failed"]);
    } else if (requestedRunId) {
      // Resuming a run: only untouched drafts, so a failure is not retried
      // forever inside the same run.
      q = q.eq("push_run_id", requestedRunId).eq("status", "draft");
    } else {
      q = q.in("status", ["draft", "failed"]);
    }

    const { data: drafts, error: draftErr } = await q;
    if (draftErr) throw draftErr;
    if (!drafts || drafts.length === 0) {
      if (requestedRunId) {
        await admin.from("revenue_rate_push_runs").update({
          status: "completed", finished_at: new Date().toISOString(),
        }).eq("id", requestedRunId).in("status", ["queued", "processing"]);
      }
      return json({ ok: true, pushed: 0, failed: 0, message: "Nothing to push." });
    }

    // Credentials per Previo account — SLNT merges two profiles under one hotel,
    // so the account is chosen from the obk id prefix ("<hotId>:<obkId>").
    type Account = { hotId: string; creds: any };
    const accounts = new Map<string, Account>();
    let fallback: Account | null = null;
    const { data: accountRows } = await admin
      .from("pms_accounts")
      .select("pms_hotel_id, credentials_secret_name, is_active")
      .eq("hotel_id", hotelId)
      .eq("is_active", true);
    for (const a of (accountRows ?? []) as any[]) {
      if (!a.pms_hotel_id || !hasPrevioCredentials(a.credentials_secret_name)) continue;
      try {
        const acc = { hotId: String(a.pms_hotel_id), creds: loadPrevioCredentials(a.credentials_secret_name) };
        accounts.set(acc.hotId, acc);
        fallback ??= acc;
      } catch { /* reported below if nothing else works */ }
    }
    if (!fallback) {
      try {
        if (!hasPrevioCredentials(cfg?.credentials_secret_name)) {
          throw new Error("No Previo credentials are saved for this hotel (neither a PMS configuration nor an active PMS account).");
        }
        fallback = {
          hotId: String(cfg.pms_hotel_id ?? ""),
          creds: loadPrevioCredentials(cfg.credentials_secret_name),
        };
      } catch (e) {
        return json({
          ok: false,
          code: "no_credentials",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }



    const pushRunId = requestedRunId ?? crypto.randomUUID();
    const draftIdList = (drafts as any[]).map((draft) => draft.id);
    await admin.from("revenue_rate_push_runs").update({
      status: "processing", started_at: new Date().toISOString(), last_error: null,
    }).eq("id", pushRunId);
    await admin.from("revenue_rate_push_items").update({
      status: "processing", claimed_at: new Date().toISOString(),
    }).eq("run_id", pushRunId).in("draft_id", draftIdList);
    await admin.from("revenue_rate_drafts").update({
      push_run_id: pushRunId,
      claimed_at: new Date().toISOString(),
      confirmation_status: "sending",
    }).in("id", draftIdList);

    let pushed = 0;
    const pushedIds: string[] = [];

    let failed = 0;
    let verified = 0;
    const errors: Array<{ stay_date: string; room_type_name: string; error: string }> = [];

    // Previo rejects an occupancy level whose lower levels are absent from the
    // same message ("3092 … levels have to be created sequentially"). So one
    // message per stay date + room type, carrying every level 1..max: the
    // edited ones from the drafts, the rest read straight back from Previo so
    // nothing else changes.
    type Group = {
      stay_date: string;
      obkId: string;
      prlId: string;
      account: { hotId: string; creds: any };
      currency: string;
      room_type_name: string;
      drafts: any[];
    };
    const groups = new Map<string, Group>();

    for (const d of drafts as any[]) {
      const mapForType = validMaps.find((m: any) => String(m.previo_room_type_id) === String(d.obk_id));
      const map: any = mapForType ?? defaultMap;
      // Multi-account hotels prefix the obk id with the Previo hotId.
      const scoped = String(map.previo_room_type_id ?? d.obk_id);
      const parts = scoped.split(":");
      const obkId = parts.pop() as string;
      const account = (parts.length ? accounts.get(parts.join(":")) : null) ?? fallback!;
      const key = `${d.stay_date}|${account.hotId}|${obkId}`;
      const existing = groups.get(key);
      if (existing) {
        existing.drafts.push(d);
      } else {
        groups.set(key, {
          stay_date: d.stay_date,
          obkId,
          prlId: String(map.previo_rate_plan_id),
          account,
          currency: d.currency ?? settings?.base_currency ?? "EUR",
          room_type_name: d.room_type_name,
          drafts: [d],
        });
      }
    }

    const groupList = Array.from(groups.values());
    const stayDates = groupList.map((group) => group.stay_date).sort();
    const { data: storedRateRows } = await admin
      .from("revenue_room_type_rates")
      .select("stay_date, obk_id, occupancy, price")
      .eq("hotel_id", hotelId)
      .gte("stay_date", stayDates[0])
      .lte("stay_date", stayDates[stayDates.length - 1]);
    const storedLevels = new Map<string, Map<number, number>>();
    for (const row of (storedRateRows ?? []) as any[]) {
      const key = `${row.stay_date}|${String(row.obk_id).split(":").pop()}`;
      const levels = storedLevels.get(key) ?? new Map<number, number>();
      levels.set(Math.max(1, Number(row.occupancy) || 1), Number(row.price));
      storedLevels.set(key, levels);
    }

    /** Gap-free occupancy ladder for one date + room type (EQC error 3092). */
    const ladderFor = (g: Group): Array<{ occupancy: number; price: number }> => {
      const wanted = new Map<number, number>(storedLevels.get(`${g.stay_date}|${g.obkId}`) ?? []);
      for (const d of g.drafts) {
        wanted.set(Math.max(1, Math.round(Number(d.occupancy) || 2)), Number(d.new_price));
      }
      const maxOccupancy = Math.max(...wanted.keys());
      const firstKnown = Array.from(wanted.entries()).sort((a, b) => a[0] - b[0])[0]?.[1];
      if (!Number.isFinite(firstKnown)) throw new Error("No valid occupancy price is available for this room type.");
      const levels: Array<{ occupancy: number; price: number }> = [];
      let previous = firstKnown;
      for (let occupancy = 1; occupancy <= maxOccupancy; occupancy += 1) {
        previous = wanted.get(occupancy) ?? previous;
        levels.push({ occupancy, price: previous });
      }
      return levels;
    };

    // A season-wide change is normally the same ladder repeated over many days.
    // EQC accepts a DateRange, so identical consecutive days collapse into one
    // message instead of one call per day — the single biggest cost in a push.
    type Batch = {
      from: string;
      to: string;
      obkId: string;
      prlId: string;
      account: { hotId: string; creds: any };
      currency: string;
      room_type_name: string;
      levels: Array<{ occupancy: number; price: number }>;
      drafts: any[];
    };
    const batches: Batch[] = [];
    const ladderBuckets = new Map<string, Group[]>();
    for (const g of groupList) {
      let levels: Array<{ occupancy: number; price: number }>;
      try {
        levels = ladderFor(g);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const ids = g.drafts.map((d: any) => d.id);
        await admin.from("revenue_rate_drafts").update({
          status: "failed", push_error: message.slice(0, 500),
          confirmation_status: "failed", push_attempt_count: 1,
        }).in("id", ids);
        failed += ids.length;
        for (const d of g.drafts) errors.push({ stay_date: d.stay_date, room_type_name: d.room_type_name, error: message });
        continue;
      }
      (g as any).levels = levels;
      const sig = levels.map((l) => `${l.occupancy}:${l.price}`).join(",");
      const key = `${g.account.hotId}|${g.obkId}|${g.prlId}|${g.currency}|${sig}`;
      const list = ladderBuckets.get(key) ?? [];
      list.push(g);
      ladderBuckets.set(key, list);
    }

    const nextDay = (iso: string) => {
      const d = new Date(`${iso}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    };

    for (const list of ladderBuckets.values()) {
      list.sort((a, b) => a.stay_date.localeCompare(b.stay_date));
      let run: Group[] = [];
      const flush = () => {
        if (run.length === 0) return;
        const first = run[0];
        batches.push({
          from: first.stay_date,
          to: run[run.length - 1].stay_date,
          obkId: first.obkId,
          prlId: first.prlId,
          account: first.account,
          currency: first.currency,
          room_type_name: first.room_type_name,
          levels: (first as any).levels,
          drafts: run.flatMap((g) => g.drafts),
        });
        run = [];
      };
      for (const g of list) {
        if (run.length > 0 && nextDay(run[run.length - 1].stay_date) !== g.stay_date) flush();
        run.push(g);
      }
      flush();
    }

    type GroupResult = { pushedIds: string[]; failedIds: string[]; errors: typeof errors };
    const processBatch = async (b: Batch): Promise<GroupResult> => {
      const creds = b.account.creds;
      const pmsHotelId = b.account.hotId;
      try {
        const result = await writePrevioRate({
          creds,
          pmsHotelId,
          preferredMethod: writeMethod,
          target: {
            prlId: b.prlId,
            obkId: b.obkId,
            from: b.from,
            to: b.to,
            occupancy: b.levels[b.levels.length - 1]?.occupancy ?? 2,
            price: b.levels[b.levels.length - 1]?.price ?? 0,
            currency: b.currency,
            levels: b.levels,
          },
        });

        if (!result.ok) {
          const detail = result.attempts
            .map((a) => `${a.method} → ${a.status}${a.message ? `: ${a.message}` : ""}`)
            .join(" | ");
          throw new Error(`Previo rejected the price change. ${detail}`);
        }

        if (result.method && result.method !== writeMethod) {
          writeMethod = result.method;
          await admin
            .from("hotel_revenue_settings")
            .update({ rate_write_method: result.method, rate_write_verified_at: new Date().toISOString() })
            .eq("hotel_id", hotelId);
        }

        // EQC acceptance is enough to update Hotel Care's visible mirror. The
        // authoritative read-back runs below in background and corrects this
        // value if Previo publishes something different.
        const now = new Date().toISOString();
        const successfulIds = b.drafts.map((draft: any) => draft.id);
        const acceptedRateRows = (b.drafts as any[]).map((d) => ({
          hotel_id: hotelId,
          organization_slug: hotelOrgSlug ?? d.organization_slug,
          stay_date: d.stay_date,
          obk_id: String(d.obk_id),
          room_type_name: d.room_type_name,
          rate_plan_id: b.prlId,
          occupancy: Math.max(1, Math.round(Number(d.occupancy) || 2)),
          price: Number(d.new_price),
          currency: d.currency ?? b.currency,
          source: "previo",
          captured_at: now,
          updated_at: now,
        }));
        const [{ error: finalizeError }, { error: mirrorError }] = await Promise.all([
          admin.from("revenue_rate_drafts").update({
            status: "pushed", pushed_at: now, push_error: null,
            confirmation_status: "sent", push_attempt_count: 1,
            actual_previo_price: null, confirmed_at: null, last_checked_at: null,
          }).in("id", successfulIds),
          admin.from("revenue_room_type_rates").upsert(acceptedRateRows, {
            onConflict: "hotel_id,stay_date,obk_id,rate_plan_id,occupancy",
          }),
        ]);
        await admin.from("revenue_rate_push_items").update({
          status: "accepted", accepted_at: now, attempt_count: 1, error: null,
        }).eq("run_id", pushRunId).in("draft_id", successfulIds);
        if (finalizeError) throw new Error(`Previo accepted the price, but Hotel Care could not finalize it: ${finalizeError.message}`);
        // Never turn a Previo-accepted write into a retryable failure just
        // because the local mirror had a transient error: retrying could apply
        // the same increase twice. The nightly sync remains the backstop.
        if (mirrorError) console.error("accepted rate mirror failed", b.from, b.to, b.obkId, mirrorError.message);

        const verifyAcceptedRates = async () => {
          try {
            const landed = await readPrevioRateLevels({
              creds, pmsHotelId, date: b.from, obkId: b.obkId, prlId: b.prlId,
            });
            if (landed.size === 0) return;
            const checkedAt = new Date().toISOString();
            const updates = new Map<string, { ids: string[]; actual: number; confirmed: boolean; requested: number }>();
            const correctedRows: Record<string, unknown>[] = [];
            const auditRows: Record<string, unknown>[] = [];
            for (const d of b.drafts as any[]) {
              const occupancy = Math.max(1, Math.round(Number(d.occupancy) || 2));
              const actual = landed.get(occupancy);
              if (actual === undefined || !Number.isFinite(actual)) continue;
              const confirmed = Math.abs(Number(actual) - Number(d.new_price)) < 0.01;
              const updateKey = `${occupancy}|${actual}|${confirmed}|${d.new_price}`;
              const update = updates.get(updateKey) ?? { ids: [], actual, confirmed, requested: Number(d.new_price) };
              update.ids.push(d.id);
              updates.set(updateKey, update);
              correctedRows.push({
                hotel_id: hotelId, organization_slug: hotelOrgSlug ?? d.organization_slug, stay_date: d.stay_date,
                obk_id: String(d.obk_id), room_type_name: d.room_type_name, rate_plan_id: b.prlId,
                occupancy, price: actual, currency: d.currency ?? b.currency,
                source: "previo", captured_at: checkedAt, updated_at: checkedAt,
              });
              if (hotelOrgSlug) auditRows.push({
                hotel_id: hotelId,
                organization_slug: hotelOrgSlug,
                action: confirmed ? "price_confirmed" : "price_landed_differently",
                source: confirmed
                  ? (isEngine ? "previo_automation_confirmed" : "previo_confirmed")
                  : "previo_different",
                stay_date: d.stay_date,
                old_rate_eur: d.old_price,
                new_rate_eur: actual,
                delta_eur: d.old_price === null ? null : Math.round((actual - Number(d.old_price)) * 100) / 100,
                notes: confirmed
                  ? `${d.room_type_name} confirmed by Previo`
                  : `${d.room_type_name}: requested ${d.new_price}, Previo published ${actual}`,
                performed_by: d.created_by ?? null,
                payload: {
                  room_type_name: d.room_type_name, occupancy,
                  requested_price: Number(d.new_price), actual_previo_price: actual,
                  confirmation_status: confirmed ? "confirmed" : "different",
                  push_run_id: pushRunId,
                  origin: isEngine ? "pickup-automation" : "hotelcare-push",
                },
              });
            }
            await Promise.all(Array.from(updates.values()).map((u) =>
              admin.from("revenue_rate_drafts").update({
                confirmation_status: u.confirmed ? "confirmed" : "different",
                actual_previo_price: u.actual,
                confirmed_at: u.confirmed ? checkedAt : null,
                last_checked_at: checkedAt,
                push_error: u.confirmed ? null : `Previo currently publishes ${u.actual}; requested ${u.requested}`,
              }).in("id", u.ids)
            ));
            await Promise.all(Array.from(updates.values()).map((u) =>
              admin.from("revenue_rate_push_items").update({
                status: u.confirmed ? "confirmed" : "different",
                actual_previo_price: u.actual,
                confirmed_at: u.confirmed ? checkedAt : null,
                error: u.confirmed ? null : `Previo currently publishes ${u.actual}; requested ${u.requested}`,
              }).eq("run_id", pushRunId).in("draft_id", u.ids)
            ));
            if (correctedRows.length > 0) await admin.from("revenue_room_type_rates").upsert(correctedRows, {
              onConflict: "hotel_id,stay_date,obk_id,rate_plan_id,occupancy",
            });
            if (auditRows.length > 0) await admin.from("rate_change_audit").insert(auditRows);
          } catch (error) {
            console.error("background rate verification failed", b.from, b.to, b.obkId, error);
          }
        };
        const verification = verifyAcceptedRates();
        const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime;
        if (edgeRuntime) edgeRuntime.waitUntil(verification);
        else void verification;

        await admin.from("rate_history").insert(b.drafts.map((d: any) => ({
            hotel_id: hotelId,
            organization_slug: hotelOrgSlug,
            stay_date: d.stay_date,
            old_rate_eur: d.old_price,
            new_rate_eur: d.new_price,
            source: isEngine ? "pickup_automation" : "manual_push",
            notes: `${d.room_type_name} · ${d.occupancy} guest(s) · ${result.method} · accepted by Previo · pushed by ${pusherLabel}`,
          })));
        return { pushedIds: successfulIds, failedIds: [], errors: [] };

      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const failedIds = b.drafts.map((draft: any) => draft.id);
        const groupErrors = b.drafts.map((d: any) => ({ stay_date: d.stay_date, room_type_name: d.room_type_name, error: message }));
        await admin.from("revenue_rate_drafts").update({
          status: "failed", push_error: message.slice(0, 500),
          confirmation_status: "failed", push_attempt_count: 1,
        }).in("id", failedIds);
        await admin.from("revenue_rate_push_items").update({
          status: "failed", error: message.slice(0, 500), attempt_count: 1,
        }).eq("run_id", pushRunId).in("draft_id", failedIds);
        console.error("rate push failed", b.from, b.to, b.obkId, message);
        return { pushedIds: [], failedIds, errors: groupErrors };
      }
    };

    // Batches are independent. A concurrency pool cuts wall time without
    // flooding Previo.
    const results: GroupResult[] = [];
    const concurrency = 6;
    let nextBatch = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
      while (nextBatch < batches.length) {
        const index = nextBatch++;
        results[index] = await processBatch(batches[index]);
      }
    }));
    for (const result of results) {
      pushed += result.pushedIds.length;
      failed += result.failedIds.length;
      pushedIds.push(...result.pushedIds);
      errors.push(...result.errors);
    }
    console.log(`push run ${pushRunId}: ${drafts.length} drafts → ${groupList.length} date/room groups → ${batches.length} Previo messages`);

    await admin.from("revenue_rate_push_runs").update({
      status: failed === 0 ? "completed" : pushed === 0 ? "failed" : "partial",
      processed_count: pushed + failed,
      accepted_count: pushed,
      failed_count: failed,
      compressed_message_count: batches.length,
      finished_at: new Date().toISOString(),
      last_error: failed > 0 ? errors[0]?.error?.slice(0, 500) ?? "Previo rejected one or more prices" : null,
    }).eq("id", pushRunId);


    await admin.from("pms_sync_history").insert({
      sync_type: "rate_push",
      direction: "to_previo",
      hotel_id: hotelId,
      sync_status: failed === 0 ? "success" : pushed === 0 ? "failed" : "partial",
      data: { pushRunId, pushed, failed, verified, method: writeMethod, errors: errors.slice(0, 10), by: pusherLabel },
      error_message: failed > 0 ? errors[0]?.error : null,
    });

    const failedIds = results.flatMap((result) => result.failedIds);
    return json({ ok: true, pushRunId, pushed, pushedIds, failed, failedIds, verified, method: writeMethod, errors });
  } catch (e) {
    console.error("revenue-push-drafts error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
