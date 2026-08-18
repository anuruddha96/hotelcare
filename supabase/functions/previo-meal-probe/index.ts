// TEMPORARY diagnostic: dump the raw structure of Previo reservations so we can
// locate where board / meal (breakfast) entitlement lives for a hotel.
// Protected: requires the service role key as Bearer token.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { callPrevioXml, loadPrevioCredentials } from "../_shared/previoCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (token !== SERVICE) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({} as any));
  const hotelId = body.hotelId || "ottofiori";
  const today = new Date().toISOString().slice(0, 10);
  const from = body.from || today;
  const to = body.to || new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const method = body.method || "searchReservations";
  const extra = body.extraXml ?? `<term><from>${from}</from><to>${to}</to></term>`;

  const service = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE);
  const { data: cfg } = await service
    .from("pms_configurations")
    .select("pms_hotel_id, credentials_secret_name")
    .eq("hotel_id", hotelId).eq("pms_type", "previo").maybeSingle();
  if (!cfg) {
    return new Response(JSON.stringify({ error: "no previo config" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const creds = loadPrevioCredentials(cfg.credentials_secret_name);
    const r = await callPrevioXml({
      method,
      creds,
      pmsHotelId: String(cfg.pms_hotel_id || ""),
      extraXml: extra,
    });
    const text = r.text || "";
    const blocks = text.match(/<reservation>[\s\S]*?<\/reservation>/g) || [];

    // Distinct tag census across all blocks (including nested tags).
    const tagStats = new Map<string, { count: number; sample: string }>();
    for (const b of blocks) {
      for (const raw of b.match(/<([a-zA-Z][\w:.-]*)>([^<]*)<\/\1>/g) || []) {
        const m = raw.match(/<([a-zA-Z][\w:.-]*)>([^<]*)<\/\1>/)!;
        const st = tagStats.get(m[1]) || { count: 0, sample: "" };
        st.count++;
        if (!st.sample && m[2].trim()) st.sample = m[2].trim().slice(0, 160);
        tagStats.set(m[1], st);
      }
    }

    return new Response(JSON.stringify({
      ok: r.ok,
      status: r.status,
      method,
      hotelId,
      window: { from, to },
      totalLength: text.length,
      reservationCount: blocks.length,
      tags: Array.from(tagStats.entries())
        .map(([tag, s]) => ({ tag, count: s.count, sample: s.sample }))
        .sort((a, b) => b.count - a.count),
      firstBlock: blocks[0]?.slice(0, 6000) ?? text.slice(0, 4000),
      secondBlock: blocks[1]?.slice(0, 6000) ?? null,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
