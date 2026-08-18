// Public read endpoint for the /bb page: today's restaurant (brunch) reservations
// for one hotel. Mirrors the access model of breakfast-public-lookup — the BB page
// is used by restaurant staff on shared devices without a login.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!rateLimit(ip)) {
      return new Response(JSON.stringify({ error: "Too many requests" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { hotel_id, date } = await req.json();
    if (!hotel_id) throw new Error("Missing hotel_id");
    const serviceDate = (date as string) || new Date().toISOString().slice(0, 10);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: source } = await supabase
      .from("restaurant_webhook_sources")
      .select("property_slug")
      .eq("hotel_id", hotel_id)
      .eq("is_active", true)
      .maybeSingle();

    const { data, error } = await supabase
      .from("restaurant_reservations")
      .select("id, guest_name, guest_phone, party_size, starts_at, ends_at, status, occasion, special_requests, notes, outlet_slug")
      .eq("hotel_id", hotel_id)
      .eq("service_date", serviceDate)
      .order("starts_at", { ascending: true });

    if (error) throw error;

    const rows = data ?? [];
    const active = rows.filter((r) => r.status !== "cancelled");
    return new Response(JSON.stringify({
      reservations: rows,
      service_date: serviceDate,
      total_reservations: active.length,
      total_covers: active.reduce((a, r) => a + (r.party_size || 0), 0),
      configured: Boolean(source),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message ?? String(e) }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
