// Executes an action the Hotel Care Assistant proposed and the user confirmed.
// Session, role, organization, property and every field are re-validated here;
// the chat function never writes. Revenue actions are deliberately handed to
// the same Revenue/Previo endpoints used by the calendar UI, so Assistant edits
// inherit all existing mapping, ladder-safety, authorization and PMS checks.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { canRunAction, executeAction, ticketHotelAllowed, validateAction } from "../_shared/assistantActions.ts";
import { resolveAssistantHotels } from "../_shared/assistantHotels.ts";
import { ACCESS_ROLE_LABEL, capabilitiesFor } from "../_shared/accessPolicy.ts";
import { rateConsentText, ratePlanRanges, type RatePlan } from "../_shared/ratePlan.ts";
import { scheduleConsentText, type PlannedCell } from "../_shared/schedulePlanner.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type AppliedResult = { ok: true; summary: string; recordId?: string } | { ok: false; error: string };

function normalizeName(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function collapseDates(dates: string[]) {
  const sorted = [...new Set(dates)].sort();
  const ranges: Array<{ date: string; to: string }> = [];
  for (const date of sorted) {
    const last = ranges.at(-1);
    if (!last) {
      ranges.push({ date, to: date });
      continue;
    }
    const nextMs = Date.parse(`${last.to}T12:00:00Z`) + 86_400_000;
    if (new Date(nextMs).toISOString().slice(0, 10) === date) last.to = date;
    else ranges.push({ date, to: date });
  }
  return ranges;
}

async function invokeUserFunction(
  supabaseUrl: string,
  authHeader: string,
  functionName: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: any }> {
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  return { ok: response.ok, status: response.status, data };
}

async function applyMinStay(params: {
  supabaseUrl: string;
  authHeader: string;
  hotelId: string;
  input: Record<string, unknown>;
}): Promise<AppliedResult> {
  const nights = Number(params.input.nights);
  const dates = Array.isArray(params.input.dates) ? params.input.dates.map(String) : [];
  const ranges = collapseDates(dates);
  if (!ranges.length) return { ok: false, error: "No minimum-stay dates were supplied" };

  const call = await invokeUserFunction(params.supabaseUrl, params.authHeader, "previo-push-restrictions", {
    hotelId: params.hotelId,
    items: ranges.map((range) => ({ date: range.date, to: range.to, minStay: nights })),
  });
  if (!call.ok || call.data?.ok !== true) {
    const failed = Array.isArray(call.data?.results)
      ? call.data.results.find((row: any) => row?.ok === false)?.message
      : null;
    return { ok: false, error: failed || call.data?.error || "Previo rejected the minimum-stay change" };
  }

  return {
    ok: true,
    summary: `Minimum stay set to ${nights} night${nights === 1 ? "" : "s"} for ${dates.length} stay date${dates.length === 1 ? "" : "s"}. Previo accepted the change and the HotelCare Revenue calendar was updated.`,
  };
}

async function applyPriceEdit(params: {
  service: any;
  supabaseUrl: string;
  authHeader: string;
  hotelId: string;
  organizationSlug: string | null;
  input: Record<string, unknown>;
}): Promise<AppliedResult> {
  const requested = Array.isArray(params.input.changes) ? params.input.changes as any[] : [];
  if (!requested.length) return { ok: false, error: "No Revenue calendar price cells were supplied" };

  // Re-read the same authoritative published payload immediately before the
  // write. A proposal may have sat on screen for minutes; stale price context
  // must never silently overwrite a newer manager/automation change.
  const { data: published, error: payloadError } = await params.service
    .from("revenue_published_payloads")
    .select("payload,sync_completed_at")
    .eq("hotel_id", params.hotelId)
    .maybeSingle();
  if (payloadError) return { ok: false, error: `Could not verify the current Revenue calendar: ${payloadError.message}` };
  const rates = Array.isArray(published?.payload?.rates) ? published.payload.rates : [];
  if (!rates.length) return { ok: false, error: "The current Revenue calendar has no verified rate cells to edit" };

  const canonical: any[] = [];
  const noops: string[] = [];
  for (const change of requested) {
    const stayDate = String(change?.stay_date ?? "");
    const roomType = normalizeName(change?.room_type_name);
    const occupancy = Number(change?.occupancy);
    const requestedObk = String(change?.obk_id ?? "").trim();
    const proposedOld = change?.old_price === null || change?.old_price === undefined ? null : Number(change.old_price);
    const newPrice = Math.round(Number(change?.new_price));

    let matches = rates.filter((rate: any) =>
      String(rate?.stay_date ?? "") === stayDate &&
      normalizeName(rate?.room_type_name) === roomType &&
      Number(rate?.occupancy) === occupancy,
    );
    if (requestedObk) matches = matches.filter((rate: any) => String(rate?.obk_id ?? "") === requestedObk);

    // A duplicated room label can exist on a multi-account property. Never
    // guess which Previo room type the user meant.
    const unique = new Map<string, any>();
    for (const rate of matches) unique.set(String(rate?.obk_id ?? ""), rate);
    const resolved = [...unique.values()];
    if (resolved.length === 0) {
      return { ok: false, error: `The price cell ${stayDate} · ${change?.room_type_name} · ${occupancy} guest(s) is no longer available. Re-open the calendar and try again.` };
    }
    if (resolved.length > 1) {
      return { ok: false, error: `${change?.room_type_name} maps to more than one PMS room type on ${stayDate}. Refresh the calendar so HotelCare can identify the exact rate cell before changing it.` };
    }

    const current = resolved[0];
    const currentPrice = Number(current?.price);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      return { ok: false, error: `HotelCare could not verify the current price for ${stayDate} · ${change?.room_type_name}` };
    }
    if (proposedOld !== null && Number.isFinite(proposedOld) && Math.abs(proposedOld - currentPrice) > 0.009) {
      return {
        ok: false,
        error: `The price for ${stayDate} · ${change?.room_type_name} · ${occupancy} guest(s) changed from €${proposedOld} to €${currentPrice} after this proposal was created. Nothing was overwritten; ask again using the latest calendar.`,
      };
    }
    if (currentPrice === newPrice) {
      noops.push(`${stayDate}|${change?.room_type_name}|${occupancy}`);
      continue;
    }

    canonical.push({
      stay_date: stayDate,
      obk_id: current?.obk_id ? String(current.obk_id) : null,
      room_type_name: String(current?.room_type_name ?? change?.room_type_name),
      occupancy,
      old_price: currentPrice,
      new_price: newPrice,
    });
  }

  if (!canonical.length) {
    return { ok: true, summary: `Those ${noops.length} Revenue calendar price cell${noops.length === 1 ? " is" : "s are"} already at the requested price. Nothing needed to be published.` };
  }

  const call = await invokeUserFunction(params.supabaseUrl, params.authHeader, "revenue-enqueue-rates", {
    hotelId: params.hotelId,
    organizationSlug: params.organizationSlug,
    source: "manual",
    changes: canonical,
  });
  if (!call.ok || call.data?.ok !== true) {
    const rejected = Array.isArray(call.data?.rejected) ? call.data.rejected[0]?.reason : null;
    return { ok: false, error: rejected || call.data?.error || "The Revenue publishing queue rejected the price edit" };
  }

  const queued = Number(call.data?.queued ?? canonical.length);
  const rejectedCount = Number(call.data?.rejectedCount ?? 0);
  const queueNote = Number(call.data?.queueAhead ?? 0) > 0 ? ` It is queued behind ${call.data.queueAhead} earlier publishing run(s).` : "";
  const rejectedNote = rejectedCount > 0 ? ` ${rejectedCount} cell(s) were rejected by the Revenue safety checks and were not sent.` : "";
  return {
    ok: true,
    recordId: typeof call.data?.runId === "string" ? call.data.runId : undefined,
    summary: `${queued} Revenue calendar price cell${queued === 1 ? "" : "s"} queued through HotelCare's safe Previo publishing pipeline.${rejectedNote}${queueNote} The calendar will reflect the PMS-confirmed values.`,
  };
}

// Derive relative prices from the published calendar, never from model-generated numbers.
async function applyRelativePrices(params: {
  service: any; supabaseUrl: string; authHeader: string; hotelId: string;
  organizationSlug: string | null; input: Record<string, unknown>;
}): Promise<AppliedResult> {
  const from = String(params.input.fromDate), to = String(params.input.toDate);
  const delta = Number(params.input.deltaEur);
  if (/increase|raise/i.test(String(params.input.intent ?? "")) && delta < 0)
    return { ok: false, error: "Increase by a negative amount is ambiguous. Say 'decrease by €2' to confirm the direction." };
  const { data, error } = await params.service.from("revenue_published_payloads")
    .select("payload,sync_completed_at").eq("hotel_id", params.hotelId).maybeSingle();
  if (error || !Array.isArray(data?.payload?.rates) || !data.payload.rates.length)
    return { ok: false, error: "Could not verify published rate cells; no price change was made." };
  const selected = data.payload.rates.filter((r: any) =>
    String(r.stay_date) >= from && String(r.stay_date) <= to);
  if (!selected.length) return { ok: false, error: "No verified rate cells exist for those dates." };
  if (selected.length > 200) return { ok: false,
    error: `The range contains ${selected.length} rate cells. Narrow the room types or dates before editing.` };
  const changes = [];
  for (const r of selected) {
    const oldPrice = Number(r.price);
    const newPrice = Math.round(oldPrice + delta);
    if (!Number.isFinite(oldPrice) || oldPrice <= 0 || newPrice <= 0) {
      return { ok: false, error: "A price could not be safely adjusted. No changes were queued." };
    }
    changes.push({
      stay_date: r.stay_date, room_type_name: r.room_type_name, occupancy: r.occupancy,
      obk_id: r.obk_id, old_price: oldPrice, new_price: newPrice,
    });
  }
  // The existing helper re-checks prices for staleness and hands them to the
  // authenticated queue, retaining floor/ladder/manual-hold controls.
  return applyPriceEdit({ ...params, input: { changes } });
}

function budapestToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

type RequestRow = Record<string, any>;

/**
 * A plan Mira prepared (rate plan or schedule plan) is approved or dismissed
 * here. The decision is recorded first — who, when, which nights or people,
 * and the exact sentence they agreed to — and can never be edited; then the
 * plan is carried out with the person's own session and the outcome stored.
 */
async function decideRequest(params: {
  service: any;
  supabaseUrl: string;
  anonKey: string;
  authHeader: string;
  userId: string;
  profile: Record<string, any>;
  body: Record<string, any>;
}): Promise<Response> {
  const { service, supabaseUrl, anonKey, authHeader, userId, profile, body } = params;
  const requestId = String(body.request_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return json({ error: "That plan was not found." }, 404);
  const { data: request, error: loadError } = await service
    .from("assistant_action_requests").select("*").eq("id", requestId).maybeSingle();
  if (loadError) return json({ error: `The plan could not be loaded: ${loadError.message}` }, 500);
  // Only the person who asked Mira decides on the plan.
  if (!request || request.requested_by !== userId) return json({ error: "That plan was not found." }, 404);
  if (request.organization_slug !== profile.organization_slug) return json({ error: "That plan belongs to another organization." }, 403);

  const decision = body.decision === "approve" ? "approve" : body.decision === "dismiss" ? "dismiss" : null;
  if (!decision) return json({ error: "Choose approve or dismiss." }, 400);
  if (request.status !== "pending") return json({ error: `This plan is already ${String(request.status).replace("_", " ")}.`, request }, 409);
  if (Date.parse(request.expires_at) < Date.now()) {
    const { data: expired } = await service.from("assistant_action_requests")
      .update({ status: "expired" }).eq("id", requestId).eq("status", "pending").select("*").maybeSingle();
    return json({ error: "This plan is too old to approve. Ask Mira to prepare it again with the latest data.", request: expired ?? { ...request, status: "expired" } }, 409);
  }

  const access = capabilitiesFor(profile);
  const hotels = await resolveAssistantHotels(service, profile as any);
  if (!hotels.some((h) => h.hotel_id === request.hotel_id)) return json({ error: "That property is outside your access." }, 403);

  const actorName = String(profile.full_name || profile.nickname || "").trim() || "Staff member";
  const decidedRole = ACCESS_ROLE_LABEL[access.accessRole];
  const decidedAt = new Date().toISOString();

  if (decision === "dismiss") {
    const { data: dismissed, error } = await service.from("assistant_action_requests")
      .update({
        status: "dismissed", decided_by: userId, decided_by_name: actorName, decided_by_role: decidedRole,
        decided_at: decidedAt, consent_text: "Dismissed — nothing was changed.",
      })
      .eq("id", requestId).eq("status", "pending").select("*").maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!dismissed) return json({ error: "This plan was already decided." }, 409);
    return json({ ok: true, request: dismissed });
  }

  const today = budapestToday();
  let approvedItems: string[] = [];
  let consentText = "";
  let execute: () => Promise<{ status: "applied" | "partially_applied" | "failed"; result: Record<string, unknown>; error: string | null; summary: string }>;

  if (request.kind === "rate_plan") {
    if (!access.revenueWrite || !canRunAction(profile.role, "adjust_revenue_prices")) {
      return json({ error: "Only top management can approve price changes." }, 403);
    }
    const plan = request.plan as RatePlan;
    const changeable = new Set(plan.days.filter((d) => Math.round(d.deltaEur) !== 0 && d.date >= today).map((d) => d.date));
    const asked = Array.isArray(body.items) ? body.items.map(String) : [...changeable];
    approvedItems = [...new Set(asked.filter((d) => changeable.has(d)))].sort();
    if (!approvedItems.length) return json({ error: "Keep at least one night with a price change." }, 400);
    const ranges = ratePlanRanges(plan.days, new Set(approvedItems));
    consentText = rateConsentText(plan, ranges);
    execute = async () => {
      const results: Array<Record<string, unknown>> = [];
      for (const range of ranges) {
        const validated = validateAction("adjust_revenue_prices", { hotelId: request.hotel_id, ...range });
        if (!validated.ok) { results.push({ ...range, ok: false, error: validated.error }); continue; }
        const applied = await applyRelativePrices({
          service, supabaseUrl, authHeader, hotelId: request.hotel_id,
          organizationSlug: profile.organization_slug, input: validated.action.input,
        });
        results.push(applied.ok
          ? { ...range, ok: true, summary: applied.summary, runId: applied.recordId ?? null }
          : { ...range, ok: false, error: applied.error });
      }
      const okCount = results.filter((r) => r.ok).length;
      const status = okCount === results.length ? "applied" : okCount > 0 ? "partially_applied" : "failed";
      const firstError = results.find((r) => !r.ok)?.error;
      return {
        status,
        result: { ranges: results },
        error: firstError ? String(firstError).slice(0, 500) : null,
        summary: `${okCount} of ${results.length} price range${results.length === 1 ? "" : "s"} queued through the Revenue publishing queue.`,
      };
    };
  } else if (request.kind === "schedule_plan") {
    if (!access.scheduleBuilder) return json({ error: "Planning the work schedule is not part of your role." }, 403);
    const plan = request.plan as { cells: PlannedCell[]; staff: Array<{ staffId: string }>; hotelName?: string; department?: string; from: string; to: string };
    const people = new Set(plan.staff.map((r) => r.staffId));
    const asked = Array.isArray(body.items) ? body.items.map(String) : [...people];
    approvedItems = [...new Set(asked.filter((id) => people.has(id)))].sort();
    if (!approvedItems.length) return json({ error: "Keep at least one person in the plan." }, 400);
    const keep = new Set(approvedItems);
    const cells = plan.cells.filter((c) => keep.has(c.staffId) && c.date >= today);
    if (!cells.length) return json({ error: "Nothing left to save: the planned days have passed." }, 400);
    const publish = body.options?.publish === true;
    consentText = scheduleConsentText({
      hotelName: plan.hotelName ?? request.hotel_id,
      department: plan.department ?? "team",
      from: plan.from,
      to: plan.to,
      shifts: cells.length,
      minutes: cells.reduce((sum, c) => sum + c.minutes, 0),
      people: new Set(cells.map((c) => c.staffId)).size,
      publish,
    });
    execute = async () => {
      // The person's own session: row-level security decides which team they may write.
      const userDb = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const rows = cells.map((c) => ({
        staff_id: c.staffId,
        work_date: c.date,
        kind: c.kind,
        code: c.code,
        start_time: c.startTime,
        end_time: c.endTime,
        day_fraction: c.dayFraction,
        extra_minutes: 0,
        hotel_id: request.hotel_id,
        note: "Planned by Mira",
        status: publish ? "published" : "draft",
      }));
      let inserted = 0;
      let failure: string | null = null;
      for (let i = 0; i < rows.length; i += 500) {
        const { data, error } = await userDb.from("workforce_entries")
          .upsert(rows.slice(i, i + 500), { onConflict: "staff_id,work_date", ignoreDuplicates: true })
          .select("staff_id");
        if (error) { failure = error.message; break; }
        inserted += (data ?? []).length;
      }
      const skipped = rows.length - inserted;
      const status = failure && inserted === 0 ? "failed" : inserted === rows.length ? "applied" : inserted > 0 ? "partially_applied" : "failed";
      return {
        status,
        result: { inserted, skipped, published: publish },
        error: failure ?? (skipped ? `${skipped} day(s) were planned in the meantime and were left as they are.` : null),
        summary: `${inserted} shift${inserted === 1 ? "" : "s"} saved as ${publish ? "published" : "draft"}${skipped ? `, ${skipped} left as already planned` : ""}.`,
      };
    };
  } else {
    return json({ error: "This kind of plan is not supported." }, 400);
  }

  // 1. The decision, recorded before anything changes.
  const { data: approved, error: claimError } = await service.from("assistant_action_requests")
    .update({
      status: "approved", approved_items: approvedItems, consent_text: consentText,
      decided_by: userId, decided_by_name: actorName, decided_by_role: decidedRole, decided_at: decidedAt,
    })
    .eq("id", requestId).eq("status", "pending").select("id").maybeSingle();
  if (claimError) return json({ error: `The approval could not be recorded: ${claimError.message}` }, 500);
  if (!approved) return json({ error: "This plan was already decided." }, 409);
  await service.from("assistant_action_requests").update({ status: "applying" }).eq("id", requestId).eq("status", "approved");

  // 2. Carry it out and keep the outcome.
  let outcome: Awaited<ReturnType<typeof execute>>;
  try {
    outcome = await execute();
  } catch (error) {
    outcome = { status: "failed", result: {}, error: error instanceof Error ? error.message : "The plan could not be carried out", summary: "Not carried out." };
  }
  const { data: finished } = await service.from("assistant_action_requests")
    .update({ status: outcome.status, result: outcome.result, error: outcome.error, applied_at: new Date().toISOString() })
    .eq("id", requestId).eq("status", "applying").select("*").maybeSingle();

  const actorFirstName = actorName.split(/\s+/)[0] || "Staff member";
  const { error: auditError } = await service.from("assistant_audit_log").insert({
    user_id: userId,
    organization_slug: profile.organization_slug,
    hotel_id: request.hotel_id,
    role: profile.role,
    question: `Mira approval · ${actorFirstName}: ${request.kind} ${requestId} — ${outcome.summary}`,
    refused: false,
    scopes_used: [`approval:${request.kind}`],
    model: "assistant-apply-action",
  });
  if (auditError) console.error("assistant approval audit failed", auditError);

  return json({ ok: outcome.status !== "failed", summary: outcome.summary, error: outcome.error, request: finished });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Configuration incomplete" }, 500);

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await authClient.auth.getUser(authHeader.slice(7));
    if (userError || !userData.user) return json({ error: "Invalid session" }, 401);

    const body = await req.json().catch(() => null);
    const kind = typeof body?.kind === "string" ? body.kind : "";
    const input = body?.input;

    const { data: profile, error: profileError } = await service
      .from("profiles")
      // "*" also returns access_role once that column exists.
      .select("*")
      .eq("id", userData.user.id)
      .is("deleted_at", null)
      .single();
    if (profileError || !profile) return json({ error: "Profile not found" }, 403);
    if (!capabilitiesFor(profile).mira) return json({ error: "Mira is not part of your role." }, 403);

    // A plan from Mira (rate plan, schedule plan) approved or dismissed on its card.
    if (typeof body?.request_id === "string") {
      return await decideRequest({ service, supabaseUrl, anonKey, authHeader, userId: userData.user.id, profile, body });
    }
    // Every refusal is logged (kind and reason only, no guest text), so a failed
    // confirmation is never again an unexplained non-2xx in the function logs.
    const refuse = (error: string, status: number) => {
      console.warn("assistant-apply-action refused", JSON.stringify({ kind, status, error: error.slice(0, 300) }));
      return json({ error }, status);
    };

    if (!canRunAction(profile.role, kind)) return refuse("Your role cannot perform that action", 403);

    const validated = validateAction(kind, input);
    if (!validated.ok) return refuse(validated.error, 400);

    const hotels = await resolveAssistantHotels(service, profile as any);
    const hotel = hotels.find((h) => h.hotel_id === validated.action.hotelId);
    if (!hotel) return refuse("That property is outside your access", 403);
    if (validated.action.kind === "create_ticket" && !ticketHotelAllowed(profile, hotel)) {
      return refuse(`Your HotelCare role can raise tickets for your own hotel only, not ${hotel.hotel_name}.`, 403);
    }

    // The person's own session for writes that row-level security and database
    // guards must judge as the signed-in user (tickets).
    const userDb = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    let result: AppliedResult;
    if (validated.action.kind === "adjust_revenue_prices") {
      result = await applyRelativePrices({
        service, supabaseUrl, authHeader, hotelId: hotel.hotel_id,
        organizationSlug: profile.organization_slug, input: validated.action.input,
      });
    } else if (validated.action.kind === "set_min_stay") {
      result = await applyMinStay({
        supabaseUrl,
        authHeader,
        hotelId: hotel.hotel_id,
        input: validated.action.input,
      });
    } else if (validated.action.kind === "edit_revenue_prices") {
      result = await applyPriceEdit({
        service,
        supabaseUrl,
        authHeader,
        hotelId: hotel.hotel_id,
        organizationSlug: profile.organization_slug,
        input: validated.action.input,
      });
    } else {
      result = await executeAction(
        service,
        {
          userId: userData.user.id,
          role: profile.role,
          organizationSlug: profile.organization_slug,
          hotelId: hotel.hotel_id,
          hotelName: hotel.hotel_name,
        },
        { kind: validated.action.kind, input: validated.action.input },
        { userDb },
      );
    }
    if (!result.ok) return refuse(result.error, 400);

    const actorFirstName = String(profile.full_name || profile.nickname || "").trim().split(/\s+/)[0] || "Staff member";
    const { error: auditError } = await service.from("assistant_audit_log").insert({
      user_id: userData.user.id,
      organization_slug: profile.organization_slug,
      hotel_id: hotel.hotel_id,
      role: profile.role,
      question: `HotelCare Operations Assistant · ${actorFirstName}: ${validated.action.kind} — ${result.summary}`,
      refused: false,
      scopes_used: [`action:${validated.action.kind}`],
      model: "assistant-apply-action",
    });
    if (auditError) console.error("assistant action audit failed", auditError);

    return json({ ok: true, summary: result.summary, recordId: result.recordId ?? null, actorFirstName, assistant: "HotelCare Operations Assistant" });
  } catch (error) {
    console.error("assistant-apply-action error", error);
    return json({ error: error instanceof Error ? error.message : "Request failed" }, 500);
  }
});
