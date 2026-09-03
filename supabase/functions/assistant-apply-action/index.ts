// Executes an action the Hotel Care Assistant proposed and the user confirmed.
// Session, role, organization, property and every field are re-validated here;
// the chat function never writes. Revenue actions are deliberately handed to
// the same Revenue/Previo endpoints used by the calendar UI, so Assistant edits
// inherit all existing mapping, ladder-safety, authorization and PMS checks.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { canRunAction, executeAction, validateAction } from "../_shared/assistantActions.ts";
import { resolveAssistantHotels } from "../_shared/assistantHotels.ts";

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
      .select("id,role,assigned_hotel,organization_slug")
      .eq("id", userData.user.id)
      .is("deleted_at", null)
      .single();
    if (profileError || !profile) return json({ error: "Profile not found" }, 403);
    if (!canRunAction(profile.role, kind)) return json({ error: "Your role cannot perform that action" }, 403);

    const validated = validateAction(kind, input);
    if (!validated.ok) return json({ error: validated.error }, 400);

    const hotels = await resolveAssistantHotels(service, profile as any);
    const hotel = hotels.find((h) => h.hotel_id === validated.action.hotelId);
    if (!hotel) return json({ error: "That property is outside your access" }, 403);

    let result: AppliedResult;
    if (validated.action.kind === "set_min_stay") {
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
      );
    }
    if (!result.ok) return json({ error: result.error }, 400);

    const { error: auditError } = await service.from("assistant_audit_log").insert({
      user_id: userData.user.id,
      organization_slug: profile.organization_slug,
      hotel_id: hotel.hotel_id,
      role: profile.role,
      question: `Applied assistant action ${validated.action.kind}: ${result.summary}`,
      refused: false,
      scopes_used: [`action:${validated.action.kind}`],
      model: "assistant-apply-action",
    });
    if (auditError) console.error("assistant action audit failed", auditError);

    return json({ ok: true, summary: result.summary, recordId: result.recordId ?? null });
  } catch (error) {
    console.error("assistant-apply-action error", error);
    return json({ error: error instanceof Error ? error.message : "Request failed" }, 500);
  }
});
