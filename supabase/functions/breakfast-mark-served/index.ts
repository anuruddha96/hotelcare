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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!rateLimit(ip)) {
      return new Response(JSON.stringify({ error: "Too many requests" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { hotel_id, location, stay_date, room_number, served_count, guest_names, served_by } = body;
    if (!hotel_id || !location || !room_number) throw new Error("Missing required fields");
    if (typeof served_count !== "number" || served_count < 0 || served_count > 50) throw new Error("Invalid served_count");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Look up org slug from hotel
    const { data: hotelRow } = await supabase
      .from("hotel_configurations")
      .select("organization_id, organizations:organization_id(slug)")
      .eq("hotel_id", hotel_id)
      .maybeSingle();
    const orgSlug = (hotelRow as any)?.organizations?.slug ?? null;

    const { data, error } = await supabase
      .from("breakfast_attendance")
      .insert({
        hotel_id,
        organization_slug: orgSlug,
        location,
        stay_date: stay_date || new Date().toISOString().slice(0, 10),
        room_number: String(room_number).trim(),
        served_count,
        guest_names: guest_names ?? null,
        served_by: served_by ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return new Response(JSON.stringify({ ok: true, id: data.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message ?? String(e) }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
