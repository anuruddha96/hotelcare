import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Naive in-memory rate limiter (per cold-start instance)
const ipHits = new Map<string, { count: number; reset: number }>();
function rateLimit(ip: string, limit = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const e = ipHits.get(ip);
  if (!e || now > e.reset) {
    ipHits.set(ip, { count: 1, reset: now + windowMs });
    return true;
  }
  e.count++;
  return e.count <= limit;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!rateLimit(ip)) {
      return new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { code, room, date } = await req.json();
    if (!code || !room) throw new Error("Missing code or room");

    const stayDate = (date as string) || new Date().toISOString().slice(0, 10);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: codeRow } = await supabase
      .from("hotel_breakfast_codes")
      .select("hotel_id, organization_slug, is_active")
      .eq("code", String(code).trim())
      .maybeSingle();

    if (!codeRow || !codeRow.is_active) {
      return new Response(JSON.stringify({ status: "invalid_code" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Case-insensitive room match
    const { data: rosterRows } = await supabase
      .from("breakfast_roster")
      .select("room_number, guest_names, pax, breakfast_count, lunch_count, dinner_count, all_inclusive_count")
      .eq("hotel_id", codeRow.hotel_id)
      .eq("stay_date", stayDate)
      .ilike("room_number", String(room).trim());

    if (!rosterRows || rosterRows.length === 0) {
      return new Response(JSON.stringify({ status: "not_found", hotel_id: codeRow.hotel_id, stay_date: stayDate }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const r = rosterRows[0];
    const eligible = r.breakfast_count > 0 || r.all_inclusive_count > 0;

    return new Response(
      JSON.stringify({
        status: eligible ? "eligible" : "not_eligible",
        hotel_id: codeRow.hotel_id,
        stay_date: stayDate,
        room: r.room_number,
        pax: r.pax,
        guest_names: r.guest_names,
        breakfast: r.breakfast_count,
        lunch: r.lunch_count,
        dinner: r.dinner_count,
        all_inclusive: r.all_inclusive_count,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("breakfast-lookup error", e);
    return new Response(JSON.stringify({ error: e.message ?? String(e) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
