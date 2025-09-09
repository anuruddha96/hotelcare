// Admin-only deletion of a user and their related data
// - Validates caller is admin
// - Executes DB cleanup via RPC (delete_user_profile)
// - Attempts to delete the auth user as well (if exists)
// - Uses service role to bypass RLS safely

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");

    // Client bound to the caller's JWT (for auth context)
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader ?? "" } },
    });

    // Service client (bypasses RLS)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Parse body
    const { target_user_id } = await req.json().catch(() => ({ target_user_id: null }));
    if (!target_user_id) {
      return new Response(JSON.stringify({ error: "Missing target_user_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Verify caller
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Check role (admin only)
    const { data: roleRow, error: roleErr } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (roleErr) {
      console.error("Role fetch error", roleErr);
      return new Response(JSON.stringify({ error: "Failed to verify permissions" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (!roleRow || roleRow.role !== "admin") {
      return new Response(JSON.stringify({ error: "Only admins can delete users" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    console.log(`Admin ${userData.user.id} requested delete for ${target_user_id}`);

    // 1) Run DB cleanup (uses our RPC to keep logic centralized)
    const { data: rpcRes, error: rpcErr } = await admin.rpc("delete_user_profile", {
      p_user_id: target_user_id,
    });

    if (rpcErr) {
      console.error("RPC error", rpcErr);
      return new Response(JSON.stringify({ error: rpcErr.message }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (rpcRes && rpcRes.success === false) {
      console.error("RPC returned failure", rpcRes);
      return new Response(JSON.stringify({ error: rpcRes.error || "Failed to delete user" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // 2) Attempt to delete auth user as well (safe if not present)
    const { error: authDelErr } = await admin.auth.admin.deleteUser(target_user_id).catch((e) => ({ error: e }));
    if (authDelErr) {
      console.warn("Auth delete warning (non-fatal)", authDelErr);
    }

    return new Response(
      JSON.stringify({ success: true, message: "User deleted successfully" }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (e) {
    console.error("Unhandled error in admin-delete-user", e);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
