// Temporary probe to discover the correct Previo reservations endpoint.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { fetchPrevioWithAuth } from "../_shared/previoAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const service = createClient(SUPABASE_URL, SERVICE);

    const { data: cfg } = await service
      .from("pms_configurations")
      .select("pms_hotel_id, credentials_secret_name")
      .eq("hotel_id", "previo-test")
      .eq("pms_type", "previo")
      .maybeSingle();

    const today = new Date().toISOString().slice(0, 10);
    const paths = [
      `/rest/reservation`,
      `/rest/reservation/list`,
      `/rest/reservation?dateFrom=${today}&dateTo=${today}`,
      `/rest/reservations/list`,
      `/rest/reservations/find?dateFrom=${today}&dateTo=${today}`,
      `/rest/stay`,
      `/rest/stay?dateFrom=${today}&dateTo=${today}`,
      `/rest/stay/list?dateFrom=${today}&dateTo=${today}`,
      `/rest/calendar?dateFrom=${today}&dateTo=${today}`,
      `/rest/calendar/reservations?dateFrom=${today}&dateTo=${today}`,
      `/rest/booking`,
      `/rest/booking?dateFrom=${today}&dateTo=${today}`,
      `/rest/bookings?dateFrom=${today}&dateTo=${today}`,
      `/rest/reports/departures?date=${today}`,
      `/rest/reports/arrivals?date=${today}`,
    ];

    const results: any[] = [];
    for (const p of paths) {
      try {
        const { response } = await fetchPrevioWithAuth({
          credentialsSecretName: cfg?.credentials_secret_name,
          path: p,
          pmsHotelId: String(cfg?.pms_hotel_id || ""),
        });
        const text = await response.text();
        results.push({ path: p, status: response.status, snippet: text.slice(0, 250) });
      } catch (e: any) {
        results.push({ path: p, error: e?.message?.slice(0, 250) });
      }
    }
    return new Response(JSON.stringify({ today, results }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
