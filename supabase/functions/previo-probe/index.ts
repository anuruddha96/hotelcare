import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { fetchPrevioWithAuth } from "../_shared/previoAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
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
  const headers = { "X-Previo-Language-ID": "2" };
  // Common Previo RESTful patterns + likely list endpoints
  const tests = [
    { m: "GET", p: `/rest/rooms?date=${today}&extended=1` },
    { m: "GET", p: `/rest/rooms?date=${today}&withReservation=1` },
    { m: "GET", p: `/rest/rooms?date=${today}&include=reservation` },
    { m: "GET", p: `/rest/availability?dateFrom=${today}&dateTo=${today}` },
    { m: "GET", p: `/rest/occupancy?dateFrom=${today}&dateTo=${today}` },
    { m: "GET", p: `/rest/dayState?date=${today}` },
    { m: "GET", p: `/rest/dayUse?date=${today}` },
    { m: "GET", p: `/rest/checkin?date=${today}` },
    { m: "GET", p: `/rest/checkout?date=${today}` },
    { m: "GET", p: `/rest/arrival?date=${today}` },
    { m: "GET", p: `/rest/departure?date=${today}` },
    { m: "GET", p: `/rest/billing?dateFrom=${today}&dateTo=${today}` },
    { m: "GET", p: `/rest/guest?dateFrom=${today}&dateTo=${today}` },
    { m: "GET", p: `/rest/crm?dateFrom=${today}&dateTo=${today}` },
    { m: "GET", p: `/rest/roomKind` },
  ];
  const results: any[] = [];
  for (const t of tests) {
    try {
      const { response } = await fetchPrevioWithAuth({
        credentialsSecretName: cfg?.credentials_secret_name,
        path: t.p,
        pmsHotelId: String(cfg?.pms_hotel_id || ""),
        method: t.m,
        headers,
      });
      const text = await response.text();
      const has = /reservation|departure|arrival/i.test(text);
      results.push({ test: `${t.m} ${t.p}`, status: response.status, has, snippet: text.slice(0, 350) });
    } catch (e: any) {
      results.push({ test: `${t.m} ${t.p}`, error: e?.message?.slice(0, 250) });
    }
  }
  return new Response(JSON.stringify({ today, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
