import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

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

// All consequential housekeeping actions require verified staff and current hotel access.
async function verifiedBreakfastStaff(supabase: any, req: Request, hotelId: string, orgSlug: string | null): Promise<string | null> {
  const token = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !orgSlug) return null;
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  const uid = authData?.user?.id;
  if (authError || !uid) return null;
  const { data: staff, error: profileError } = await supabase.from("profiles")
    .select("role,organization_slug,deleted_at").eq("id", uid).maybeSingle();
  const permitted = ["breakfast_staff","reception","front_office","reception_manager","manager","housekeeping_manager","supervisor","top_management","top_management_manager","admin"];
  if (profileError || !staff || staff.deleted_at || staff.organization_slug !== orgSlug || !permitted.includes(staff.role)) return null;
  const { data: allowed, error: accessError } = await supabase.rpc("user_can_access_hotel", { _uid: uid, _hotel_id: hotelId });
  return !accessError && allowed === true ? uid : null;
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
    if (typeof hotel_id !== "string" || !hotel_id) return json(200, { ok: false, error: "Missing hotel_id" });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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
      .select("id")
      .single();

    if (error) return json(200, { ok: false, error: error.message });
    // Public breakfast counting stays independent of housekeeping.
    const housekeepingInformed = false;
    try {
      if (orgSlug && Number.isInteger(count) && count > 0) {
        const uid = await verifiedBreakfastStaff(supabase, req, hotel_id, orgSlug);
        if (uid) {
          const { error: signalError } = await supabase.rpc("record_breakfast_signal", {
            _hotel_id: hotel_id, _room_number: String(room_number).trim(),
            _served_count: count, _location: location, _attendance_id: data.id,
          });
          if (signalError) console.warn("Breakfast signal unavailable", signalError.code);
        }
      }
    } catch {
      console.warn("Breakfast signal unavailable; attendance saved");
    }
    return json(200, { ok: true, id: data.id, housekeeping_informed: housekeepingInformed });
  } catch (e: any) {
    return json(200, { ok: false, error: e?.message ?? String(e) });
  }
});
