// Executes an operational action the Hotel Care Assistant proposed and the
// user confirmed (maintenance ticket, room assignment, ticket status).
// Session, role, organization, property and every field are re-validated here;
// the chat function never writes.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { canRunAction, executeAction, validateAction } from "../_shared/assistantActions.ts";
import { resolveAssistantHotels } from "../_shared/assistantHotels.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Configuration incomplete" }, 500);

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await authClient.auth.getUser(authHeader.slice(7));
    if (userError || !userData.user) return json({ error: "Invalid session" }, 401);

    const body = await req.json().catch(() => null);
    const kind = typeof body?.kind === "string" ? body.kind : "";
    const input = body?.input;

    const { data: profile, error: profileError } = await service
      .from("profiles")
      .select("id,role,assigned_hotel,organization_slug")
      .eq("id", userData.user.id)
      .is("deleted_at", null)
      .single();
    if (profileError || !profile) return json({ error: "Profile not found" }, 403);
    if (!canRunAction(profile.role, kind)) return json({ error: "Your role cannot perform that action" }, 403);

    const validated = validateAction(kind, input);
    if (!validated.ok) return json({ error: validated.error }, 400);

    const hotels = await resolveAssistantHotels(service, profile as any);
    const hotel = hotels.find((h) => h.hotel_id === validated.action.hotelId);
    if (!hotel) return json({ error: "That property is outside your access" }, 403);

    const result = await executeAction(
      service,
      {
        userId: userData.user.id,
        role: profile.role,
        organizationSlug: profile.organization_slug,
        hotelId: hotel.hotel_id,
        hotelName: hotel.hotel_name,
      },
      { kind: validated.action.kind, input: validated.action.input },
    );
    if (!result.ok) return json({ error: result.error }, 400);

    const { error: auditError } = await service.from("assistant_audit_log").insert({
      user_id: userData.user.id,
      organization_slug: profile.organization_slug,
      hotel_id: hotel.hotel_id,
      role: profile.role,
      question: `Applied assistant action ${validated.action.kind}: ${result.summary}`,
      refused: false,
      scopes_used: [`action:${validated.action.kind}`],
      model: "assistant-apply-action",
    });
    if (auditError) console.error("assistant action audit failed", auditError);

    return json({ ok: true, summary: result.summary, recordId: result.recordId ?? null });
  } catch (error) {
    console.error("assistant-apply-action error", error);
    return json({ error: error instanceof Error ? error.message : "Request failed" }, 500);
  }
});
