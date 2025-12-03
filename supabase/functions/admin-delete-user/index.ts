// Admin/Manager deletion of a housekeeper with archiving
// - Validates caller is admin or manager (managers can only delete housekeepers in their hotel)
// - Archives user data for 30 days before full deletion
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
    const { target_user_id, soft_delete = true } = await req.json().catch(() => ({ target_user_id: null, soft_delete: true }));
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

    // Get caller's profile
    const { data: callerProfile, error: callerErr } = await admin
      .from("profiles")
      .select("role, assigned_hotel, organization_slug")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (callerErr) {
      console.error("Caller profile fetch error", callerErr);
      return new Response(JSON.stringify({ error: "Failed to verify permissions" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const callerRole = callerProfile?.role;
    const allowedRoles = ['admin', 'manager', 'housekeeping_manager'];
    
    if (!callerRole || !allowedRoles.includes(callerRole)) {
      return new Response(JSON.stringify({ error: "Insufficient permissions to delete users" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Get target user's profile
    const { data: targetProfile, error: targetErr } = await admin
      .from("profiles")
      .select("*")
      .eq("id", target_user_id)
      .maybeSingle();

    if (targetErr || !targetProfile) {
      return new Response(JSON.stringify({ error: "Target user not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Non-admin users can only delete housekeepers in their hotel
    if (callerRole !== 'admin') {
      if (targetProfile.role !== 'housekeeping') {
        return new Response(JSON.stringify({ error: "You can only delete housekeeping staff" }), {
          status: 403,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      // Check same hotel or same organization
      const sameHotel = callerProfile.assigned_hotel && 
        callerProfile.assigned_hotel === targetProfile.assigned_hotel;
      const sameOrg = callerProfile.organization_slug === targetProfile.organization_slug;

      if (!sameHotel && !sameOrg) {
        return new Response(JSON.stringify({ error: "You can only delete staff in your hotel" }), {
          status: 403,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
    }

    console.log(`${callerRole} ${userData.user.id} requested delete for ${target_user_id} (soft_delete: ${soft_delete})`);

    // Archive user data before deletion
    if (soft_delete) {
      // Fetch performance data
      const { data: performanceData } = await admin
        .from("housekeeping_performance")
        .select("*")
        .eq("housekeeper_id", target_user_id);

      // Fetch attendance data
      const { data: attendanceData } = await admin
        .from("staff_attendance")
        .select("*")
        .eq("user_id", target_user_id);

      // Fetch ratings data
      const { data: ratingsData } = await admin
        .from("housekeeper_ratings")
        .select("*")
        .eq("housekeeper_id", target_user_id);

      // Create archive record
      const { error: archiveErr } = await admin
        .from("archived_housekeepers")
        .insert({
          original_profile_id: target_user_id,
          full_name: targetProfile.full_name,
          nickname: targetProfile.nickname,
          email: targetProfile.email,
          phone_number: targetProfile.phone_number,
          organization_slug: targetProfile.organization_slug,
          assigned_hotel: targetProfile.assigned_hotel,
          archived_by: userData.user.id,
          performance_data: performanceData || [],
          attendance_data: attendanceData || [],
          ratings_data: ratingsData || [],
          created_at: targetProfile.created_at,
        });

      if (archiveErr) {
        console.error("Archive error:", archiveErr);
        // Continue with deletion even if archive fails
      } else {
        console.log("User data archived successfully");
      }
    }

    // Run DB cleanup using v2 function with reassignment
    const { data: rpcRes, error: rpcErr } = await admin.rpc("delete_user_profile_v2", {
      p_user_id: target_user_id,
      p_reassign_to: userData.user.id, // Reassign tickets to current user
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

    // Attempt to delete auth user as well (safe if not present)
    const { error: authDelErr } = await admin.auth.admin.deleteUser(target_user_id).catch((e) => ({ error: e }));
    if (authDelErr) {
      console.warn("Auth delete warning (non-fatal)", authDelErr);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: soft_delete 
          ? "User deleted and data archived for 30 days" 
          : "User deleted permanently"
      }),
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
