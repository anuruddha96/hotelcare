// Temporary read-only probe: dump Previo getRates XML for one property so we
// can see where minimum-stay restrictions live in the response.
import { createClient } from "npm:@supabase/supabase-js@2";
import { writePrevioRestrictions } from "../_shared/previoRateWrite.ts";
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

  if (url.searchParams.get("run") === "sync") {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/previo-revenue-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ hotelId, horizonDays: 60 }),
    });
    return new Response(await r.text(), { status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { data: cfg } = await service
    .from("pms_configurations")
    .select("pms_hotel_id, credentials_secret_name")
    .eq("hotel_id", hotelId).maybeSingle();
  if (!cfg) return new Response("no config", { status: 404, headers: corsHeaders });

  const creds = loadPrevioCredentials((cfg as any).credentials_secret_name);
  if (req.method === "POST") {
    const raw = await req.text();
    const key = (creds as any).eqcApiKey || (creds as any).apiKey || (creds as any).password;
    const resp = await fetch("https://api.previo.app/eqc1/ar", {
      method: "POST",
      headers: { "Content-Type": "application/xml; charset=utf-8", "Authorization": `ApiKey ${key}` },
      body: raw.replace(/__HOTID__/g, String((cfg as any).pms_hotel_id || "")),
    });
    return new Response(JSON.stringify({ status: resp.status, text: await resp.text() }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (url.searchParams.get("setmin") || url.searchParams.get("setinv")) {
    const { data: maps } = await service
      .from("previo_rate_plan_mapping")
      .select("previo_rate_plan_id, previo_room_type_id").eq("hotel_id", hotelId);
    const out: unknown[] = [];
    for (const m of (maps ?? []) as any[]) {
      const res = await writePrevioRestrictions({
        creds,
        pmsHotelId: String((cfg as any).pms_hotel_id || ""),
        target: {
          obkId: String(m.previo_room_type_id).split(":").pop()!,
          prlId: String(m.previo_rate_plan_id),
          from, to,
          minStay: url.searchParams.get("setmin") ? Number(url.searchParams.get("setmin")) : null,
          roomsToSell: url.searchParams.get("setinv") ? Number(url.searchParams.get("setinv")) : null,
        },
      });
      out.push({ obk: m.previo_room_type_id, ...res.attempts[0] });
    }
    return new Response(JSON.stringify(out, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

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
