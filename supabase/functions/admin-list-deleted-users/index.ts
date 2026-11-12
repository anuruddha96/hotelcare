// Read archived staff profiles for authorized administrators without weakening
// profiles SELECT RLS for ordinary users or exposing auth.users.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return reply(401, { error: "Unauthorized" });

    const url = Deno.env.get("SUPABASE_URL")!;
    const authClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) return reply(401, { error: "Unauthorized" });

    const { data: caller, error: callerError } = await admin.from("profiles")
      .select("role, is_super_admin, organization_slug, deleted_at")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (callerError || !caller || caller.deleted_at ||
        !(caller.is_super_admin === true || caller.role === "admin")) {
      return reply(403, { error: "Administrator access required" });
    }

    const body = await req.json().catch(() => ({}));
    const requestedOrg = typeof body.organization_slug === "string" ? body.organization_slug.trim() : "";

    let query = admin.from("profiles")
      .select("id, email, full_name, nickname, phone_number, role, created_at, assigned_hotel, is_super_admin, organization_slug, deleted_at, deleted_by")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(500);

    // Organization admins can only see their own organization's deleted profiles.
    if (!caller.is_super_admin) {
      if (!caller.organization_slug) return reply(403, { error: "Missing organization scope" });
      query = query.eq("organization_slug", caller.organization_slug);
    } else if (requestedOrg) {
      query = query.eq("organization_slug", requestedOrg);
    }

    const { data, error } = await query;
    if (error) throw error;

    return reply(200, { success: true, users: data || [] });
  } catch (error) {
    console.error("admin-list-deleted-users error", error);
    return reply(500, { error: "Unable to load archived users" });
  }
});
