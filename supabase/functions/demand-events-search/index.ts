// Finds demand-driving events for a city and month, on request.
//
// The search itself lives in _shared/eventSearch.ts so the weekly automatic
// sweep (demand-events-auto) behaves identically. This function only handles
// access control and records who ran the search.
//
// It only RETURNS candidates: nothing reaches pricing until a revenue manager
// approves the rows in the app.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { searchEvents } from "../_shared/eventSearch.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Missing auth" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) return json({ ok: false, error: "OPENAI_API_KEY is not configured" }, 200);

    const userClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: userRes } = await userClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
    if (!userRes?.user) return json({ ok: false, error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: profile } = await admin
      .from("profiles").select("role, organization_slug, full_name").eq("id", userRes.user.id).maybeSingle();
    if (!profile || !["admin", "top_management", "top_management_manager"].includes(String(profile.role))) {
      return json({ ok: false, error: "Only administrators and top management can search for events." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const city = String(body.city ?? "Budapest").slice(0, 80);
    const country = String(body.country ?? "Hungary").slice(0, 80);
    const month = /^\d{4}-\d{2}$/.test(String(body.month ?? ""))
      ? String(body.month)
      : new Date().toISOString().slice(0, 7);
    const hotelId = typeof body.hotelId === "string" ? body.hotelId : null;
    const organizationSlug = String(profile.organization_slug ?? "");

    const result = await searchEvents({ admin, openaiKey: OPENAI_API_KEY, organizationSlug, city, country, month });
    if (result.error && result.all.length === 0) return json({ ok: false, error: result.error }, 200);

    await admin.from("demand_event_search_runs").insert({
      organization_slug: organizationSlug,
      hotel_id: hotelId,
      city,
      country,
      months_scanned: 1,
      events_found: result.all.length,
      events_added: 0,
      source: "manual",
      run_by: userRes.user.id,
      run_by_name: (profile.full_name as string | null) ?? null,
    });

    return json({
      ok: true,
      month,
      city,
      country,
      found: result.all.length,
      candidates: result.candidates,
      duplicates: result.duplicates,
    });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: (e as Error)?.message ?? "Unexpected error" }, 200);
  }
});
