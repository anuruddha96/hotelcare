import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { dispatchBreakfastPushes } from "./notifications.ts";
import { verifiedBreakfastStaff } from "./staffAccess.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ipHits = new Map<string, { count: number; reset: number }>();
function rateLimit(ip: string, limit = 120, windowMs = 60_000): boolean {
  const now = Date.now();
  const e = ipHits.get(ip);
  if (!e || now > e.reset) { ipHits.set(ip, { count: 1, reset: now + windowMs }); return true; }
  e.count++;
  return e.count <= limit;
}

function toGuestArray(input: unknown): string[] | null {
  if (input == null) return null;
  if (Array.isArray(input)) {
    const arr = input.map((v) => String(v ?? "").trim()).filter(Boolean);
    return arr.length ? arr : null;
  }
  const s = String(input).trim();
  if (!s) return null;
  // Split on commas / newlines; ignore Previo "(N)" prefix
  const cleaned = s.replace(/^\(\d+\)\s*/, "");
  const parts = cleaned.split(/[,\n;]+/).map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts : [s];
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function tokenHash(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!rateLimit(ip)) return json(429, { error: "Too many requests" });

    const body = await req.json().catch(() => null);
    if (!body) return json(200, { ok: false, error: "Invalid JSON body" });

    const { hotel_id, location, stay_date, room_number, served_count, guest_names, served_by } = body;
    const projectUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(projectUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    if (body.action === "housekeeping_dispatch") {
      const provided = req.headers.get("x-hotelcare-push-secret");
      if (!provided) return json(401, { error: "Unauthorized" });
      const { data: secret, error: secretError } = await supabase.rpc("get_hotelcare_push_secret", { _name: "hotelcare_push_dispatch_key" });
      if (secretError || !secret || provided !== secret) return json(401, { error: "Unauthorized" });
      return json(200, { ok: true, ...(await dispatchBreakfastPushes(supabase, projectUrl, secret)) });
    }
    if (typeof hotel_id !== "string" || !hotel_id) return json(200, { ok: false, error: "Missing hotel_id" });

    const { data: hotelRow } = await supabase
      .from("hotel_configurations")
      .select("organization_id,hotel_name,breakfast_enabled,is_active,organizations:organization_id(slug)")
      .eq("hotel_id", hotel_id)
      .maybeSingle();
    const orgSlug = (hotelRow as any)?.organizations?.slug ?? null;

    if (body.action === "housekeeping_status") {
      // Return a single boolean; unauthorized callers cannot inspect hotel settings.
      try {
        const uid = await verifiedBreakfastStaff(supabase, req, hotel_id, orgSlug);
        if (!uid || !hotelRow?.breakfast_enabled || hotelRow.is_active === false) return json(200, { ok: true, housekeeping_link_on: false });
        const { data: rows, error: settingsError } = await supabase.from("housekeeping_automation_settings")
          .select("hotel_id,breakfast_signal_enabled")
          .eq("organization_slug", orgSlug).in("hotel_id", [hotel_id, hotelRow.hotel_name].filter(Boolean));
        const settings = rows?.find((row: any) => row.hotel_id === hotel_id) ?? rows?.[0];
        return json(200, { ok: true, housekeeping_link_on: !settingsError && (settings?.breakfast_signal_enabled ?? true) });
      } catch {
        return json(200, { ok: true, housekeeping_link_on: false });
      }
    }
    if (body.action === "housekeeping_push_status") {
      try {
        const uid = await verifiedBreakfastStaff(supabase, req, hotel_id, orgSlug);
        if (!uid || !orgSlug || !Array.isArray(body.attendance_ids)) return json(200, { ok: true, marks: [] });
        const ids = [...new Set(body.attendance_ids.filter((id: unknown) => typeof id === "string" && uuid.test(id)))].slice(0, 50);
        if (!ids.length) return json(200, { ok: true, marks: [] });
        const { data: marks, error: statusError } = await supabase.rpc("breakfast_mark_push_status", { _actor_id: uid, _hotel_id: hotel_id, _org: orgSlug, _attendance_ids: ids });
        return json(200, { ok: true, marks: statusError ? [] : marks ?? [] });
      } catch {
        return json(200, { ok: true, marks: [] });
      }
    }
    if (body.action === "undo") {
      try {
        if (!orgSlug || typeof body.attendance_id !== "string" || !uuid.test(body.attendance_id) ||
            typeof body.undo_token !== "string" || !uuid.test(body.undo_token)) return json(200, { ok: false });
        const uid = await verifiedBreakfastStaff(supabase, req, hotel_id, orgSlug);
        const { data: undone, error: undoError } = await supabase.rpc("undo_breakfast_mark", {
          _attendance_id: body.attendance_id, _token_hash: await tokenHash(body.undo_token),
          _actor_id: uid, _hotel_id: hotel_id, _org: orgSlug,
        });
        return json(200, { ok: !undoError && undone === true });
      } catch {
        return json(200, { ok: false });
      }
    }
    if (body.action && body.action !== "mark") return json(200, { ok: false, error: "Unknown action" });
    if (!location || !room_number) return json(200, { ok: false, error: "Missing required fields (hotel_id, location, room_number)" });
    const count = Number(served_count);
    if (!Number.isFinite(count) || count < 0 || count > 50) return json(200, { ok: false, error: "Invalid served_count" });

    const { data, error } = await supabase
      .from("breakfast_attendance")
      .insert({
        hotel_id,
        organization_slug: orgSlug,
        location,
        stay_date: stay_date || new Date().toISOString().slice(0, 10),
        room_number: String(room_number).trim(),
        served_count: count,
        guest_names: toGuestArray(guest_names),
        served_by: served_by ?? null,
      })
      .select("id,created_at")
      .single();

    if (error) return json(200, { ok: false, error: error.message });
    // Public counting stays independent of receipt/signal/push failures.
    let uid: string | null = null;
    let undoToken: string | undefined;
    try { uid = await verifiedBreakfastStaff(supabase, req, hotel_id, orgSlug); } catch { /* fail closed for signal */ }
    if (orgSlug) {
      try {
        const candidate = crypto.randomUUID();
        const { error: receiptError } = await supabase.from("housekeeping_breakfast_mark_receipts").insert({
          attendance_id: data.id, organization_slug: orgSlug, hotel_id, actor_id: uid,
          token_hash: await tokenHash(candidate), created_at: data.created_at,
        });
        if (!receiptError) undoToken = candidate;
      } catch { /* attendance already saved */ }
    }
    try {
      if (uid && Number.isInteger(count) && count > 0) {
        const { data: signals, error: signalError } = await supabase.rpc("record_breakfast_signal", {
          _hotel_id: hotel_id, _room_number: String(room_number).trim(),
          _served_count: count, _location: location, _attendance_id: data.id,
        });
        if (signalError) console.warn("Breakfast signal unavailable", signalError.code);
        else if (signals?.[0]?.signal_id) {
          const { error: queueError } = await supabase.rpc("enqueue_breakfast_pushes", { _signal_id: signals[0].signal_id });
          if (queueError) console.warn("Breakfast push queue unavailable", queueError.code);
        }
      }
    } catch {
      console.warn("Breakfast signal unavailable; attendance saved");
    }
    // A queued notification is not a delivered push. The board may query its
    // own receipt status asynchronously, without slowing the next room mark.
    return json(200, { ok: true, id: data.id, housekeeping_informed: false, ...(undoToken ? { undo_token: undoToken, undo_expires_at: new Date(Date.parse(data.created_at) + 60_000).toISOString() } : {}) });
  } catch (e: any) {
    return json(200, { ok: false, error: e?.message ?? String(e) });
  }
});
