// Read-only feasibility probe for the Revenue Management rebuild.
// Calls candidate Previo XML methods for rates / pricelists / room types and
// reports, per method, whether the account is entitled and what came back.
// No writes. Admin-only (or service-role) access.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { callPrevioXml, loadPrevioCredentials } from "../_shared/previoCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function iso(d: Date) { return d.toISOString().slice(0, 10); }

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service = createClient(SUPABASE_URL, SERVICE);

  const url = new URL(req.url);
  let hotelId = url.searchParams.get("hotel_id") || "ottofiori";
  let from = url.searchParams.get("from") || iso(new Date());
  let to = url.searchParams.get("to") || iso(new Date(Date.now() + 6 * 86400000));
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    hotelId = body.hotelId || hotelId;
    from = body.from || from;
    to = body.to || to;
  }

  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (token !== SERVICE) {
    const anon = createClient(SUPABASE_URL, ANON);
    const { data: userRes } = await anon.auth.getUser(token);
    if (!userRes?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: p } = await service.from("profiles").select("role").eq("id", userRes.user.id).maybeSingle();
    if ((p as any)?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const { data: cfg } = await service
    .from("pms_configurations")
    .select("pms_hotel_id, credentials_secret_name")
    .eq("hotel_id", hotelId).eq("pms_type", "previo").maybeSingle();
  if (!cfg) {
    return new Response(JSON.stringify({ error: `No Previo config for ${hotelId}` }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const creds = loadPrevioCredentials((cfg as any).credentials_secret_name);
  const hotId = String((cfg as any).pms_hotel_id || "");

  const term = `<term><from>${from}</from><to>${to}</to></term>`;
  const candidates: Array<{ method: string; extraXml: string }> = [
    { method: "getRates", extraXml: term },
    { method: "getRates", extraXml: `<dateFrom>${from}</dateFrom><dateTo>${to}</dateTo>` },
    { method: "getPricelists", extraXml: "" },
    { method: "getPricelist", extraXml: term },
    { method: "getRateplans", extraXml: "" },
    { method: "getObjects", extraXml: "" },
    { method: "getObjectTypes", extraXml: "" },
    { method: "getAvailability", extraXml: term },
    { method: "getPrices", extraXml: term },
  ];

  const results: any[] = [];
  for (const c of candidates) {
    try {
      const r = await callPrevioXml({ method: c.method, creds, pmsHotelId: hotId, extraXml: c.extraXml });
      const tags = Array.from(new Set((r.text.match(/<([a-zA-Z][a-zA-Z0-9_]*)[ >]/g) || [])
        .map((t) => t.replace(/[<> ]/g, "")))).slice(0, 60);
      results.push({
        method: c.method,
        extraXml: c.extraXml.slice(0, 60),
        ok: r.ok,
        status: r.status,
        error: r.errorMessage,
        bytes: r.text.length,
        tags,
        sample: r.text.slice(0, 1500),
      });
    } catch (e) {
      results.push({ method: c.method, ok: false, error: String(e) });
    }
  }

  return new Response(JSON.stringify({ hotelId, hotId, from, to, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
