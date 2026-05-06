import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { normalizeRoomNumber, roomTypeLabel } from "../_shared/roomCode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ipHits = new Map<string, { count: number; reset: number }>();
function rateLimit(ip: string, limit = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const e = ipHits.get(ip);
  if (!e || now > e.reset) { ipHits.set(ip, { count: 1, reset: now + windowMs }); return true; }
  e.count++;
  return e.count <= limit;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!rateLimit(ip)) {
      return new Response(JSON.stringify({ error: "Too many requests" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { hotel_id, room, date } = await req.json();
    if (!hotel_id || !room) throw new Error("Missing hotel_id or room");
    const stayDate = (date as string) || new Date().toISOString().slice(0, 10);
    const normRoom = normalizeRoomNumber(String(room));

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1) Try exact-date snapshot for this hotel
    let { data: snaps } = await supabase
      .from("daily_overview_snapshots")
      .select("room_number, room_type_code, room_suffix, room_label, guest_names, pax, breakfast, lunch, dinner, all_inclusive, business_date, arrival_date, departure_date, status")
      .eq("hotel_id", hotel_id)
      .eq("business_date", stayDate);

    let snapshotDate = stayDate;

    // 2) Fallback: most recent snapshot date <= stayDate for this hotel
    if (!snaps || snaps.length === 0) {
      const { data: latest } = await supabase
        .from("daily_overview_snapshots")
        .select("business_date")
        .eq("hotel_id", hotel_id)
        .lte("business_date", stayDate)
        .order("business_date", { ascending: false })
        .limit(1);
      if (latest && latest.length) {
        snapshotDate = latest[0].business_date;
        const { data: fallback } = await supabase
          .from("daily_overview_snapshots")
          .select("room_number, room_type_code, room_suffix, room_label, guest_names, pax, breakfast, lunch, dinner, all_inclusive, business_date, arrival_date, departure_date, status")
          .eq("hotel_id", hotel_id)
          .eq("business_date", snapshotDate);
        snaps = fallback ?? [];
      }
    }

    const match: any = (snaps ?? []).find((r: any) => normalizeRoomNumber(r.room_number ?? "") === normRoom) ?? null;

    if (match) {
      const breakfast = match.breakfast ?? 0;
      const allInc = match.all_inclusive ?? 0;
      const eligible = breakfast > 0 || allInc > 0;
      const status = eligible ? "eligible" : "not_eligible_no_breakfast";
      const { data: served } = await supabase
        .from("breakfast_attendance")
        .select("served_count, location, created_at, guest_names")
        .eq("hotel_id", hotel_id)
        .eq("stay_date", stayDate)
        .eq("room_number", match.room_number)
        .order("created_at", { ascending: true });
      const servedTotal = (served ?? []).reduce((a: number, x: any) => a + (x.served_count || 0), 0);
      return new Response(JSON.stringify({
        status,
        source: "daily_overview",
        hotel_id, stay_date: stayDate, snapshot_date: snapshotDate,
        room: match.room_number,
        room_type_code: match.room_type_code,
        room_type_label: roomTypeLabel(match.room_type_code),
        room_suffix: match.room_suffix,
        pax: match.pax,
        guest_names: match.guest_names,
        breakfast,
        lunch: match.lunch,
        dinner: match.dinner,
        all_inclusive: allInc,
        already_served: servedTotal,
        served_records: served ?? [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3) Fallback to legacy breakfast_roster (exact room_number match) for the requested hotel
    const { data: rosterRows } = await supabase
      .from("breakfast_roster")
      .select("room_number, guest_names, pax, breakfast_count, lunch_count, dinner_count, all_inclusive_count, source_notes")
      .eq("hotel_id", hotel_id)
      .eq("stay_date", stayDate);
    const r: any = (rosterRows ?? []).find((x: any) => normalizeRoomNumber(x.room_number ?? "") === normRoom);

    if (!r) {
      return new Response(JSON.stringify({ status: "not_found", hotel_id, stay_date: stayDate, snapshot_date: snapshotDate }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const eligible = r.breakfast_count > 0 || r.all_inclusive_count > 0;
    const { data: served } = await supabase
      .from("breakfast_attendance")
      .select("served_count, location, created_at, guest_names")
      .eq("hotel_id", hotel_id)
      .eq("stay_date", stayDate)
      .eq("room_number", r.room_number)
      .order("created_at", { ascending: true });
    const servedTotal = (served ?? []).reduce((a: number, x: any) => a + (x.served_count || 0), 0);

    return new Response(JSON.stringify({
      status: eligible ? "eligible" : "not_eligible_no_breakfast",
      source: "roster",
      hotel_id, stay_date: stayDate,
      room: r.room_number, pax: r.pax, guest_names: r.guest_names,
      breakfast: r.breakfast_count, lunch: r.lunch_count, dinner: r.dinner_count,
      all_inclusive: r.all_inclusive_count,
      notes: r.source_notes ?? null,
      already_served: servedTotal,
      served_records: served ?? [],
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message ?? String(e) }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
