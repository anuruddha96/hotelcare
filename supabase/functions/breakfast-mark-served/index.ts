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
    if (!hotel_id || !location || !room_number) return json(200, { ok: false, error: "Missing required fields (hotel_id, location, room_number)" });
    const count = Number(served_count);
    if (!Number.isFinite(count) || count < 0 || count > 50) return json(200, { ok: false, error: "Invalid served_count" });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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
        served_count: count,
        guest_names: toGuestArray(guest_names),
        served_by: served_by ?? null,
      })
      .select("id")
      .single();

    if (error) return json(200, { ok: false, error: error.message });
    return json(200, { ok: true, id: data.id });
  } catch (e: any) {
    return json(200, { ok: false, error: e?.message ?? String(e) });
  }
});
