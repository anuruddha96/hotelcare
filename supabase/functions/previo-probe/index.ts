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
  const tests = [
    { m: "GET", p: `/rest/rooms?date=${today}` },
    { m: "GET", p: `/rest/rooms?dateFrom=${today}&dateTo=${today}` },
    { m: "GET", p: `/rest/room?date=${today}` },
    { m: "POST", p: `/rest/reservation/search`, body: JSON.stringify({ dateFrom: today, dateTo: today }) },
    { m: "POST", p: `/rest/reservation/find`, body: JSON.stringify({ dateFrom: today, dateTo: today }) },
    { m: "POST", p: `/rest/reservation/list`, body: JSON.stringify({ dateFrom: today, dateTo: today }) },
    { m: "POST", p: `/rest/reservation`, body: JSON.stringify({ dateFrom: today, dateTo: today }) },
    { m: "POST", p: `/rest/calendar`, body: JSON.stringify({ dateFrom: today, dateTo: today }) },
    { m: "POST", p: `/rest/roomReservation/search`, body: JSON.stringify({ dateFrom: today, dateTo: today }) },
    { m: "POST", p: `/rest/roomReservation`, body: JSON.stringify({ dateFrom: today, dateTo: today }) },
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
        body: t.body,
      });
      const text = await response.text();
      results.push({ test: `${t.m} ${t.p}`, status: response.status, snippet: text.slice(0, 500) });
    } catch (e: any) {
      results.push({ test: `${t.m} ${t.p}`, error: e?.message?.slice(0, 250) });
    }
  }
  return new Response(JSON.stringify({ today, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
