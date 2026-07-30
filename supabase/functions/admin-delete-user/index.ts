// Soft-deletion of users by admins/managers/housekeeping_managers.
// - Marks profile as deleted (deleted_at/deleted_by) instead of removing the row.
// - Also disables the auth user so they can no longer sign in.
// - Admins retain visibility of deleted users; other roles no longer see them (via RLS).

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

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader ?? "" } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { target_user_id } = await req.json().catch(() => ({ target_user_id: null }));
    if (!target_user_id) {
      return new Response(JSON.stringify({ error: "Missing target_user_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const callerId = userData.user.id;

    // Perform soft delete via SECURITY DEFINER function (handles permission checks).
    // The service-role client carries no user JWT, so auth.uid() would be NULL
    // inside the function — pass the caller id derived from the verified JWT.
    const { data: rpcRes, error: rpcErr } = await admin.rpc("soft_delete_user_profile", {
      p_target_user_id: target_user_id,
      p_caller_id: callerId,
    });

    if (rpcErr) {
      console.error("soft_delete_user_profile error", rpcErr);
      return new Response(JSON.stringify({ error: rpcErr.message }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const result = rpcRes as { success?: boolean; error?: string; already_deleted?: boolean };
    if (!result?.success) {
      return new Response(JSON.stringify({ error: result?.error || "Failed to delete user" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Stamp deleted_by with the caller (RPC already did this; retained as safety net).
    await admin
      .from("profiles")
      .update({ deleted_by: callerId })
      .eq("id", target_user_id)
      .is("deleted_by", null);

    // Disable auth login by banning the user for 100 years (safer than hard delete).
    const banUntil = new Date();
    banUntil.setFullYear(banUntil.getFullYear() + 100);
    const { error: banErr } = await admin.auth.admin.updateUserById(target_user_id, {
      ban_duration: `${100 * 365 * 24}h`,
    }).catch((e) => ({ error: e } as any));
    if (banErr) {
      console.warn("Auth ban warning (non-fatal)", banErr);
    }

    return new Response(
      JSON.stringify({ success: true, message: "User deleted" }),
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
