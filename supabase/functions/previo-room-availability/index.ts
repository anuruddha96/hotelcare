// Read-only Previo room-kind availability for the Revenue calendar.
// Previo's calendar/availability is authoritative for "rooms left"; reservation
// counts are only a fallback because a manager may close otherwise-empty inventory.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { loadPrevioCredentials } from "../_shared/previoCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service = createClient(SUPABASE_URL, SERVICE);

  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!token) return json({ error: "Unauthorized" }, 401);
  const anon = createClient(SUPABASE_URL, ANON);
  const { data: userRes } = await anon.auth.getUser(token);
  if (!userRes?.user) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const hotelId = String(body.hotelId || "");
  const from = String(body.from || "");
  const to = String(body.to || "");
  if (!hotelId || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return json({ error: "hotelId, from and to are required" }, 400);
  }

  const [{ data: profile }, { data: cfg }] = await Promise.all([
    service.from("profiles").select("organization_slug,role").eq("id", userRes.user.id).maybeSingle(),
    service.from("pms_configurations")
      .select("pms_hotel_id,credentials_secret_name,organization_slug")
      .eq("hotel_id", hotelId).eq("pms_type", "previo").maybeSingle(),
  ]);
  if (!profile || !cfg || (cfg as any).organization_slug !== (profile as any).organization_slug) {
    return json({ error: "Forbidden" }, 403);
  }

  const creds = loadPrevioCredentials((cfg as any).credentials_secret_name);
  const apiKey = creds.protocol === "xml" ? creds.apiKey : (creds.apiKey || creds.password);
  if (!apiKey) return json({ error: "Previo API key unavailable" }, 500);

  const hotId = String((cfg as any).pms_hotel_id || "");
  const params = new URLSearchParams({ filterFrom: from, filterTo: to, includeOfflineRooms: "true" });
  const resp = await fetch(`https://api.previo.app/rest/calendar/availability?${params.toString()}`, {
    headers: {
      "Authorization": `ApiKey ${apiKey}`,
      "X-Previo-Hotel-Id": hotId,
      "X-Previo-Language-ID": "2",
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 300);
    return json({ error: `Previo availability failed [${resp.status}]`, detail }, resp.status);
  }

  const raw = await resp.json();
  const ratePlans = Array.isArray(raw) ? raw : [raw];
  const rows: Array<{ stay_date: string; room_kind_id: string; availability: number }> = [];
  for (const plan of ratePlans) {
    for (const day of (plan?.availability ?? [])) {
      for (const kind of (day?.roomKinds ?? [])) {
        const id = kind?.id ?? kind?.roomKindId;
        const availability = Number(kind?.availability);
        if (!day?.date || id == null || !Number.isFinite(availability)) continue;
        rows.push({
          stay_date: String(day.date).slice(0, 10),
          room_kind_id: String(id),
          availability: Math.max(0, Math.trunc(availability)),
        });
      }
    }
  }

  return json({ hotelId, from, to, source: "previo_calendar_availability", rows });
});
