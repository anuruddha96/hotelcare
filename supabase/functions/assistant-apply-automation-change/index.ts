// Applies an automation-rule change the Hotel Care Assistant proposed and the
// user confirmed. Everything is re-validated here: session, role, organization,
// hotel, field allowlist and ranges. The chat function never writes rules.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { canChangeAutomation, validateChanges } from "../_shared/assistantAutomationFields.ts";
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
    const hotelId = typeof body?.hotel_id === "string" ? body.hotel_id : "";
    const ruleId = typeof body?.rule_id === "string" ? body.rule_id : "";
    const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : "";
    if (!hotelId || !ruleId) return json({ error: "A hotel and rule are required" }, 400);

    const validated = validateChanges(body?.changes);
    if (!validated.ok) return json({ error: validated.error }, 400);

    const { data: profile, error: profileError } = await service
      .from("profiles")
      .select("id,role,assigned_hotel,organization_slug")
      .eq("id", userData.user.id)
      .is("deleted_at", null)
      .single();
    if (profileError || !profile) return json({ error: "Profile not found" }, 403);
    if (!canChangeAutomation(profile.role)) return json({ error: "Your role cannot change automation rules" }, 403);

    const hotels = await resolveAssistantHotels(service, profile as any);
    if (!hotels.some((h) => h.hotel_id === hotelId)) {
      return json({ error: "That property is outside your access" }, 403);
    }

    const { data: rule, error: ruleError } = await service
      .from("revenue_pickup_automation_rules")
      .select("*")
      .eq("id", ruleId)
      .eq("hotel_id", hotelId)
      .eq("organization_slug", profile.organization_slug)
      .maybeSingle();
    if (ruleError) return json({ error: `Rule lookup failed: ${ruleError.message}` }, 500);
    if (!rule) return json({ error: "Automation configuration not found" }, 404);

    const patch: Record<string, unknown> = {
      version: Number(rule.version ?? 1) + 1,
      updated_by: userData.user.id,
      updated_at: new Date().toISOString(),
    };
    const applied: { field: string; label: string; from: unknown; to: unknown }[] = [];
    for (const change of validated.changes) {
      patch[change.field] = change.value;
      applied.push({ field: change.field, label: change.label, from: rule[change.field] ?? null, to: change.value });
    }

    const { error: updateError } = await service
      .from("revenue_pickup_automation_rules")
      .update(patch)
      .eq("id", ruleId)
      .eq("hotel_id", hotelId)
      .eq("organization_slug", profile.organization_slug);
    if (updateError) return json({ error: `Could not save the change: ${updateError.message}` }, 500);

    const { error: auditError } = await service.from("assistant_audit_log").insert({
      user_id: userData.user.id,
      organization_slug: profile.organization_slug,
      hotel_id: hotelId,
      role: profile.role,
      question: `Applied automation change: ${applied
        .map((row) => `${row.field} ${String(row.from)} → ${String(row.to)}`)
        .join("; ")}${reason ? ` (${reason})` : ""}`,
      refused: false,
      scopes_used: ["automation_write"],
      model: "assistant-apply-automation-change",
    });
    if (auditError) console.error("assistant automation audit failed", auditError);

    return json({ ok: true, hotelId, version: patch.version, applied });
  } catch (error) {
    console.error("assistant-apply-automation-change error", error);
    return json({ error: error instanceof Error ? error.message : "Request failed" }, 500);
  }
});
