import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface AdminUpdateUserPayload {
  target_user_id: string;
  new_email?: string;
  new_password?: string;
  full_name?: string;
  nickname?: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: AdminUpdateUserPayload = await req.json();
    const { target_user_id, new_email, new_password, full_name, nickname } = payload;

    if (!target_user_id) {
      return new Response(JSON.stringify({ error: "target_user_id is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Client with the caller's auth to verify role
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });

    const {
      data: { user: caller },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Verify caller is admin
    const { data: roleData, error: roleErr } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .maybeSingle();

    if (roleErr || !roleData || roleData.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Service-role client for auth.admin operations
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // Update auth user if email or password provided
    if (new_email || new_password) {
      const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
        target_user_id,
        {
          ...(new_email ? { email: new_email } : {}),
          ...(new_password ? { password: new_password } : {}),
          // Optionally keep metadata in sync
          ...(full_name || nickname
            ? { user_metadata: { ...(full_name ? { full_name } : {}), ...(nickname ? { username: nickname } : {}) } }
            : {}),
        },
      );

      if (updateErr) {
        return new Response(JSON.stringify({ error: updateErr.message }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
    }

    // Update public profile for consistency (doesn't require service role)
    const updates: Record<string, any> = {};
    if (new_email) updates.email = new_email;
    if (full_name) updates.full_name = full_name;
    if (nickname) updates.nickname = nickname;

    if (Object.keys(updates).length > 0) {
      const { error: profileErr } = await supabase
        .from("profiles")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", target_user_id);

      if (profileErr) {
        return new Response(JSON.stringify({ error: profileErr.message }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: "User updated successfully" }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  } catch (e: any) {
    console.error("admin-update-user error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unexpected error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
