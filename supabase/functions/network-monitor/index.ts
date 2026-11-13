import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANAGERS = new Set([
  "admin", "manager", "housekeeping_manager", "maintenance_manager",
  "marketing_manager", "reception_manager", "back_office_manager",
  "control_manager", "finance_manager", "top_management", "top_management_manager",
]);
const EXECUTIVES = new Set(["admin", "top_management", "top_management_manager"]);

async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Server not configured" }, 503);

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const action = String(input.action || "");

  // Heartbeats are device-authenticated so they continue across reception user
  // changes, including while the application's sign-in screen is displayed.
  if (action === "heartbeat") {
    const id = String(input.monitor_id || "");
    const token = String(input.token || "");
    if (!ID.test(id) || token.length < 40 || token.length > 128) return json({ error: "Invalid device credentials" }, 400);
    const hash = await sha256(token);
    const { data, error } = await admin.from("network_monitors")
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq("id", id).eq("token_sha256", hash).eq("enabled", true)
      .select("id").maybeSingle();
    if (error) return json({ error: "Heartbeat storage failed" }, 503);
    if (!data) return json({ error: "Monitoring device disabled or unrecognized" }, 403);
    return json({ ok: true });
  }

  // Managers must authenticate for enrollment, status and deactivation; no
  // browser can simply enroll an arbitrary hotel or read another tenant.
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Sign in as a hotel manager" }, 401);
  const { data: identity, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !identity.user?.id) return json({ error: "Invalid session" }, 401);
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id,role,organization_slug,assigned_hotel,is_super_admin")
    .eq("id", identity.user.id).maybeSingle();
  if (profileError || !profile || !MANAGERS.has(String(profile.role))) {
    return json({ error: "Manager access required" }, 403);
  }
  const hotelId = String(input.hotel_id || "").trim();
  if (!hotelId || hotelId.length > 120) return json({ error: "Select a hotel" }, 400);
  const { data: hotel, error: hotelError } = await admin.from("hotel_configurations")
    .select("hotel_id,hotel_name,organization_id")
    .eq("hotel_id", hotelId).eq("is_active", true).maybeSingle();
  if (hotelError || !hotel) return json({ error: "Hotel not found" }, 404);
  const { data: org } = await admin.from("organizations")
    .select("slug").eq("id", hotel.organization_id).maybeSingle();
  const orgSlug = String(org?.slug || "");
  if (orgSlug !== "rdhotels" || profile.organization_slug !== orgSlug) {
    return json({ error: "Internet monitoring is only enabled for RD Hotels" }, 403);
  }
  const privileged = Boolean(profile.is_super_admin) || EXECUTIVES.has(String(profile.role));
  const assignedHotel = String(profile.assigned_hotel || "").trim();
  if (!privileged && ![hotel.hotel_id, hotel.hotel_name].includes(assignedHotel)) {
    return json({ error: "You can only manage your assigned hotel" }, 403);
  }

  if (action === "list") {
    const { data: devices, error } = await admin.from("network_monitors")
      .select("id,device_label,enabled,last_heartbeat_at,created_at")
      .eq("organization_slug", orgSlug).eq("hotel_id", hotel.hotel_id)
      .order("created_at", { ascending: false });
    if (error) return json({ error: error.message }, 500);
    const monitorIds = (devices || []).map((d) => d.id);
    const { data: incidents, error: incidentError } = monitorIds.length
      ? await admin.from("network_monitor_incidents")
        .select("id,monitor_id,started_at,detected_at,recovered_at,closed_reason")
        .in("monitor_id", monitorIds).order("detected_at", { ascending: false }).limit(30)
      : { data: [], error: null };
    if (incidentError) return json({ error: incidentError.message }, 500);
    return json({ hotel: hotel.hotel_name, monitors: devices || [], incidents: incidents || [], recipient: "anu@rdhotels.hu" });
  }

  if (action === "register") {
    const label = String(input.device_label || "").trim();
    const token = String(input.token || "");
    if (label.length < 1 || label.length > 100 || token.length < 40 || token.length > 128) {
      return json({ error: "Provide a computer name and secure device token" }, 400);
    }
    const { data, error } = await admin.from("network_monitors").insert({
      organization_slug: orgSlug,
      hotel_id: hotel.hotel_id,
      device_label: label,
      token_sha256: await sha256(token),
      created_by: profile.id,
      enabled: true,
      last_heartbeat_at: new Date().toISOString(),
    }).select("id").single();
    if (error || !data) return json({ error: error?.message || "Registration failed" }, 500);
    return json({ ok: true, id: data.id });
  }

  if (action === "disable") {
    const id = String(input.monitor_id || "");
    if (!ID.test(id)) return json({ error: "Invalid monitor ID" }, 400);
    const { data, error } = await admin.from("network_monitors")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("id", id).eq("hotel_id", hotel.hotel_id).eq("organization_slug", orgSlug)
      .select("id").maybeSingle();
    if (error || !data) return json({ error: "Monitor not found or cannot be disabled" }, 404);
    await admin.from("network_monitor_incidents").update({
      recovered_at: new Date().toISOString(), closed_reason: "disabled",
    }).eq("monitor_id", id).is("recovered_at", null);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});
