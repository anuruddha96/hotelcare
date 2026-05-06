import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

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

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: rosterRows } = await supabase
      .from("breakfast_roster")
      .select("room_number, guest_names, pax, breakfast_count, lunch_count, dinner_count, all_inclusive_count, departure_date, arrival_date")
      .eq("hotel_id", hotel_id)
      .eq("stay_date", stayDate)
      .ilike("room_number", String(room).trim());

    if (!rosterRows || rosterRows.length === 0) {
      return new Response(JSON.stringify({ status: "not_found", hotel_id, stay_date: stayDate }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const r: any = rosterRows[0];
    const eligible = r.breakfast_count > 0 || r.all_inclusive_count > 0;

    // Already-served count for this room/date/hotel
    const { data: served } = await supabase
      .from("breakfast_attendance")
      .select("served_count, location, created_at")
      .eq("hotel_id", hotel_id)
      .eq("stay_date", stayDate)
      .ilike("room_number", String(room).trim());
    const servedTotal = (served ?? []).reduce((a: number, x: any) => a + (x.served_count || 0), 0);

    return new Response(JSON.stringify({
      status: eligible ? "eligible" : "not_eligible",
      hotel_id, stay_date: stayDate,
      room: r.room_number, pax: r.pax, guest_names: r.guest_names,
      breakfast: r.breakfast_count, lunch: r.lunch_count, dinner: r.dinner_count,
      all_inclusive: r.all_inclusive_count,
      departure_date: r.departure_date ?? null,
      arrival_date: r.arrival_date ?? null,
      already_served: servedTotal,
      served_records: served ?? [],
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message ?? String(e) }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
