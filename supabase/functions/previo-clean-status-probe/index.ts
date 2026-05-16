// Probe Previo REST API for any endpoint that successfully updates a room's
// housekeeping/clean status. Iterates a list of candidate method+path+body
// combinations and returns each result so we can identify which (if any)
// Previo actually supports for our account.
//
// Call:
//   POST /previo-clean-status-probe
//   { hotelId?: string, pmsRoomId?: string|number, targetStatus?: "clean"|"dirty" }
//
// Defaults: hotelId="previo-test", pmsRoomId from first room mapping, targetStatus="clean".

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { fetchPrevioWithAuth } from "../_shared/previoAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Candidate {
  label: string;
  method: "PUT" | "POST" | "PATCH";
  path: string;
  body?: unknown;
}

function buildCandidates(pmsRoomId: string, status: string): Candidate[] {
  // Previo REST often uses both verbal status ("clean"/"dirty") and
  // boolean isClean. We try a variety so we can identify what's accepted.
  const statusBodies = [
    { status },
    { cleanStatus: status },
    { housekeepingStatus: status },
    { isClean: status === "clean" },
    { clean: status === "clean" },
    { state: status },
  ];

  const list: Candidate[] = [];

  // Documented-looking paths
  const paths = [
    `/rest/rooms/${pmsRoomId}/clean-status`,
    `/rest/rooms/${pmsRoomId}/cleaning-status`,
    `/rest/rooms/${pmsRoomId}/housekeeping`,
    `/rest/rooms/${pmsRoomId}/housekeeping-status`,
    `/rest/rooms/${pmsRoomId}/status`,
    `/rest/rooms/${pmsRoomId}`,
    `/rest/housekeeping/${pmsRoomId}`,
    `/rest/housekeeping/rooms/${pmsRoomId}`,
    `/rest/cleaning/rooms/${pmsRoomId}`,
    `/rest/rooms/${pmsRoomId}/clean`,
  ];

  for (const path of paths) {
    for (const method of ["PUT", "PATCH", "POST"] as const) {
      for (const body of statusBodies) {
        list.push({ label: `${method} ${path} ${JSON.stringify(body)}`, method, path, body });
      }
    }
  }

  // No-body GETs / HEADs to confirm path existence
  list.push({ label: `GET /rest/rooms/${pmsRoomId}`, method: "POST", path: `/rest/rooms/${pmsRoomId}`, body: undefined });

  return list;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { hotelId = "previo-test", pmsRoomId, targetStatus = "clean" } = await req.json().catch(() => ({}));

    const { data: cfg, error: cfgErr } = await supabase
      .from("pms_configurations")
      .select("pms_hotel_id, credentials_secret_name, pms_room_mappings(pms_room_id, hotelcare_room_number)")
      .eq("hotel_id", hotelId)
      .eq("pms_type", "previo")
      .eq("is_active", true)
      .maybeSingle();

    if (cfgErr || !cfg) {
      return new Response(JSON.stringify({ error: `No active Previo config for ${hotelId}` }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const roomId = String(pmsRoomId ?? (cfg as any).pms_room_mappings?.[0]?.pms_room_id ?? "");
    if (!roomId) {
      return new Response(JSON.stringify({ error: "No pmsRoomId provided and no room mappings exist" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const candidates = buildCandidates(roomId, targetStatus);
    const results: any[] = [];
    const successes: any[] = [];

    for (const c of candidates) {
      try {
        const { response, source } = await fetchPrevioWithAuth({
          credentialsSecretName: (cfg as any).credentials_secret_name,
          pmsHotelId: String((cfg as any).pms_hotel_id || ""),
          path: c.path,
          method: c.method,
          body: c.body ? JSON.stringify(c.body) : undefined,
        });
        const text = await response.text();
        const entry = {
          label: c.label,
          method: c.method,
          path: c.path,
          body: c.body,
          status: response.status,
          contentType: response.headers.get("content-type") || "",
          source,
          snippet: text.slice(0, 400),
        };
        results.push(entry);
        if (response.status >= 200 && response.status < 300) successes.push(entry);
      } catch (e: any) {
        results.push({ label: c.label, error: e?.message?.slice(0, 400) });
      }
    }

    return new Response(
      JSON.stringify({
        hotelId,
        pmsRoomId: roomId,
        targetStatus,
        totalTried: results.length,
        successCount: successes.length,
        successes,
        results,
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
