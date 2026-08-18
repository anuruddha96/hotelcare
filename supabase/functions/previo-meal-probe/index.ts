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
  // Personal data is redacted from every response, so an anon call is safe.
  const redact = (s: string) =>
    s.replace(/<(firstName|surname|email|phone|mobile|street|city|zip|company|birthDate|documentNumber)>([^<]*)<\/\1>/gi,
      (_m, tag) => `<${tag}>[redacted]</${tag}>`);

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

    // Meal-signal report: correlate per-guest <guestMealId>, OTA note "Meals x"
    // and the kitchen note prefix so we can pick a reliable breakfast source.
    const mealIdCounts: Record<string, number> = {};
    const noteMealCounts: Record<string, number> = {};
    const kitchenCounts: Record<string, number> = {};
    const combos: Record<string, number> = {};
    for (const b of blocks) {
      const ids = Array.from(b.matchAll(/<guestMealId>(\d+)<\/guestMealId>/g)).map((m) => m[1]);
      const uniq = Array.from(new Set(ids)).sort().join("+") || "none";
      mealIdCounts[uniq] = (mealIdCounts[uniq] || 0) + 1;
      const note = (b.match(/<note>([\s\S]*?)<\/note>/) || [, ""])[1];
      const noteMeal = (note.match(/Meals[^a-zA-Z]{0,12}([A-Za-z ]{3,30})/) || [, ""])[1].trim().toLowerCase().slice(0, 24) || "none";
      noteMealCounts[noteMeal] = (noteMealCounts[noteMeal] || 0) + 1;
      const kitchen = /breakfast\s*(in|included)/i.test(note) ? "breakfast_in"
        : /kuchyn[eě][^<]{0,40}?(no breakfast|without)/i.test(note) ? "no_breakfast" : "unclear";
      kitchenCounts[kitchen] = (kitchenCounts[kitchen] || 0) + 1;
      const k = `mealIds=${uniq}|note=${noteMeal}|kitchen=${kitchen}`;
      combos[k] = (combos[k] || 0) + 1;
    }

    return new Response(JSON.stringify({
      ok: r.ok,
      status: r.status,
      method,
      hotelId,
      window: { from, to },
      totalLength: text.length,
      mealIdCounts,
      noteMealCounts,
      kitchenCounts,
      combos,
      reservationCount: blocks.length,
      tags: Array.from(tagStats.entries())
        .map(([tag, s]) => ({ tag, count: s.count, sample: /name|mail|phone|street|city|zip|birth|document/i.test(tag) ? "[redacted]" : s.sample }))
        .sort((a, b) => b.count - a.count),
      firstBlock: redact(blocks[0]?.slice(0, 6000) ?? text.slice(0, 4000)),
      secondBlock: blocks[1] ? redact(blocks[1].slice(0, 6000)) : null,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
