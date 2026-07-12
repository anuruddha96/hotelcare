import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { callPrevioXml, loadPrevioCredentials } from "../_shared/previoCredentials.ts";

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
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const hotId = String(cfg?.pms_hotel_id || "");
  const results: any[] = [];
  try {
    const creds = loadPrevioCredentials(cfg?.credentials_secret_name);
    const r = await callPrevioXml({
      method: "searchReservations",
      creds,
      pmsHotelId: hotId,
      extraXml: `<term><from>${today}</from><to>${tomorrow}</to></term>`,
    });
    results.push({ url: "https://api.previo.app/x1/hotel/searchReservations/", status: r.status, ok: r.ok, error: r.errorMessage, snippet: r.text.slice(0, 8000) });
  } catch (e: any) {
    results.push({ url: "https://api.previo.app/x1/hotel/searchReservations/", error: e?.message });
  }
  return new Response(JSON.stringify({ today, hotId, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
