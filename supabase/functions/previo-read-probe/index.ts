import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { fetchPrevioWithAuth } from "../_shared/previoAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const today = () => new Date().toISOString().slice(0, 10);
const tomorrow = () => {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const hotelId = String(body.hotelId || "ottofiori");
  const from = String(body.from || today());
  const to = String(body.to || tomorrow());
  const { data: cfg } = await supabase
    .from("pms_configurations")
    .select("pms_hotel_id, credentials_secret_name")
    .eq("hotel_id", hotelId)
    .eq("pms_type", "previo")
    .eq("is_active", true)
    .maybeSingle();
  if (!cfg) return new Response(JSON.stringify({ error: "No active config" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const query = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&filterFrom=${encodeURIComponent(from)}&filterTo=${encodeURIComponent(to)}&dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`;
  const paths = [
    `/rest/reservations${query}`,
    `/rest/reservation${query}`,
    `/rest/room-reservations${query}`,
    `/rest/roomReservation${query}`,
    `/rest/room-reservation${query}`,
    `/rest/commissions${query}`,
    `/rest/commission${query}`,
  ];
  const results: any[] = [];
  for (const path of paths) {
    try {
      const { response } = await fetchPrevioWithAuth({
        credentialsSecretName: (cfg as any).credentials_secret_name,
        pmsHotelId: String((cfg as any).pms_hotel_id || ""),
        path,
        headers: { "X-Previo-Language-ID": "2" },
      });
      const text = await response.text();
      results.push({ path, status: response.status, contentType: response.headers.get("content-type"), snippet: text.slice(0, 1200) });
    } catch (e: any) {
      results.push({ path, error: e?.message || String(e) });
    }
  }
  return new Response(JSON.stringify({ hotelId, from, to, results }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});