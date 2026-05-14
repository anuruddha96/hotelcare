import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function clean(v: any): string {
  const s = String(v ?? "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1).trim();
  return s;
}
function parseCreds(raw: string): { user: string; pass: string } | null {
  const r = clean(raw);
  try {
    const j = JSON.parse(r);
    if (j && typeof j === "object") {
      const u = j.username ?? j.user ?? j.login ?? j.email;
      const p = j.password ?? j.pass ?? j.secret;
      if (u && p) return { user: clean(u), pass: clean(p) };
    }
  } catch {}
  const m = r.match(/^([^:\s]+):(.+)$/);
  if (m) return { user: clean(m[1]), pass: clean(m[2]) };
  return null;
}

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
  const secret = clean(Deno.env.get(cfg?.credentials_secret_name || "") || "");
  const creds = parseCreds(secret);
  if (!creds) {
    return new Response(JSON.stringify({ error: "no creds" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const xmlBody = `<?xml version="1.0"?>
<request>
<login>${creds.user}</login>
<password>${creds.pass}</password>
<hotId>${hotId}</hotId>
<term><from>${today}</from><to>${tomorrow}</to></term>
</request>`;

  const urls = [
    "https://api.previo.cz/x1/hotel/searchReservations/",
    "https://api.previo.app/x1/hotel/searchReservations/",
  ];
  const results: any[] = [];
  for (const u of urls) {
    try {
      const r = await fetch(u, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=UTF-8" },
        body: xmlBody,
      });
      const t = await r.text();
      results.push({ url: u, status: r.status, snippet: t.slice(0, 8000) });
    } catch (e: any) {
      results.push({ url: u, error: e?.message });
    }
  }
  return new Response(JSON.stringify({ today, hotId, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
