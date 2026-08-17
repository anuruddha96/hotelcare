// Temporary read-only probe: dump Previo getRates XML for one property so we
// can see where minimum-stay restrictions live in the response.
import { createClient } from "npm:@supabase/supabase-js@2";
import { callPrevioXml, loadPrevioCredentials } from "../_shared/previoCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-probe-token",
};

const TOKEN = "ms-probe-7f2c1a9e";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  if (url.searchParams.get("t") !== TOKEN) {
    return new Response("no", { status: 403, headers: corsHeaders });
  }
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const hotelId = url.searchParams.get("hotel_id") || "ottofiori";
  const from = url.searchParams.get("from") || "2026-09-10";
  const to = url.searchParams.get("to") || "2026-09-14";
  const method = url.searchParams.get("method") || "getRates";

  const { data: cfg } = await service
    .from("pms_configurations")
    .select("pms_hotel_id, credentials_secret_name")
    .eq("hotel_id", hotelId).maybeSingle();
  if (!cfg) return new Response("no config", { status: 404, headers: corsHeaders });

  const creds = loadPrevioCredentials((cfg as any).credentials_secret_name);
  const r = await callPrevioXml({
    method,
    creds,
    pmsHotelId: String((cfg as any).pms_hotel_id || ""),
    extraXml: `<term><from>${from}</from><to>${to}</to></term>`,
  });
  return new Response(JSON.stringify({ ok: r.ok, status: r.status, error: r.errorMessage, text: r.text.slice(0, 40000) }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
