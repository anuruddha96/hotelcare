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
  const hotelId = String(cfg?.pms_hotel_id || "");

  // Try Previo XML API: searchReservations
  const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<request>
  <method>searchReservations</method>
  <params>
    <hotId>${hotelId}</hotId>
    <dateFrom>${today}</dateFrom>
    <dateTo>${today}</dateTo>
    <dateType>stay</dateType>
  </params>
</request>`;

  const tests = [
    { m: "POST", p: `/`, headers: { "Content-Type": "text/xml" }, body: xmlBody },
    { m: "POST", p: `/api`, headers: { "Content-Type": "text/xml" }, body: xmlBody },
    { m: "POST", p: `/xml`, headers: { "Content-Type": "text/xml" }, body: xmlBody },
    { m: "POST", p: `/xml/`, headers: { "Content-Type": "text/xml" }, body: xmlBody },
  ];
  const results: any[] = [];
  for (const t of tests) {
    try {
      const { response } = await fetchPrevioWithAuth({
        credentialsSecretName: cfg?.credentials_secret_name,
        path: t.p,
        pmsHotelId: hotelId,
        method: t.m,
        headers: t.headers,
        body: t.body,
      });
      const text = await response.text();
      results.push({ test: `${t.m} ${t.p}`, status: response.status, snippet: text.slice(0, 600) });
    } catch (e: any) {
      results.push({ test: `${t.m} ${t.p}`, error: e?.message?.slice(0, 250) });
    }
  }
  return new Response(JSON.stringify({ today, hotelId, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
