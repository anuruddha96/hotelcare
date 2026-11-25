// Restore an existing soft-deleted HotelCare user without recreating their account.
// Only a current admin in the same organization, or a super admin, may restore.
// Elevated target accounts can only be restored by super admins.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: authData, error: authError } = await anon.auth.getUser();
    if (authError || !authData.user) return json(401, { error: "Unauthorized" });

    const { data: caller, error: callerError } = await admin
      .from("profiles")
      .select("role, is_super_admin, organization_slug, deleted_at")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (callerError || !caller || caller.deleted_at ||
        !(caller.is_super_admin === true || caller.role === "admin")) {
      return json(403, { error: "Only active administrators can restore users" });
    }

    const body = await req.json().catch(() => ({}));
    const targetId = typeof body.target_user_id === "string" ? body.target_user_id : "";
    if (!uuidPattern.test(targetId)) return json(400, { error: "Invalid target user ID" });
    if (targetId === authData.user.id) return json(400, { error: "Cannot restore own account" });

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id, role, is_super_admin, organization_slug, deleted_at, deleted_by")
      .eq("id", targetId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) return json(404, { error: "User profile not found" });
    if (!target.deleted_at) return json(409, { error: "This user is not deleted" });

    // Do not allow administrators to cross tenant boundaries or restore elevated accounts.
    if (!caller.is_super_admin) {
      if (!caller.organization_slug || caller.organization_slug !== target.organization_slug) {
        return json(403, { error: "Cannot restore a user outside your organization" });
      }
      if (target.is_super_admin ||
          ["admin", "top_management", "top_management_manager"].includes(target.role)) {
        return json(403, { error: "Super administrator permission required" });
      }
    }

    // If auth was hard-deleted, never make the profile active without a login account.
    const { data: targetAuth, error: targetAuthError } = await admin.auth.admin.getUserById(targetId);
    if (targetAuthError || !targetAuth.user ||
        (targetAuth.user as { deleted_at?: string | null }).deleted_at) {
      return json(409, { error: "Authentication account is missing; manual recovery required" });
    }

    // Restore profile in place, preserving roles, hotel, password, history, and user ID.
    const { data: restored, error: restoreError } = await admin
      .from("profiles")
      .update({ deleted_at: null, deleted_by: null })
      .eq("id", targetId)
      .not("deleted_at", "is", null)
      .select("id")
      .maybeSingle();
    if (restoreError) throw restoreError;
    if (!restored) return json(409, { error: "User was already restored by another administrator" });

    // GoTrue 'none' clears the 100-year sign-in ban set by admin-delete-user.
    const { error: unbanError } = await admin.auth.admin.updateUserById(targetId, {
      ban_duration: "none",
    });
    if (unbanError) {
      // Best effort: keep an inaccessible profile archived if auth unban failed.
      const { error: rollbackError } = await admin.from("profiles")
        .update({ deleted_at: target.deleted_at, deleted_by: target.deleted_by })
        .eq("id", targetId).is("deleted_at", null);
      console.error("Restore failed to unban", { targetId, rollbackFailed: !!rollbackError });
      return json(500, { error: rollbackError
        ? "Auth restoration failed and profile requires administrator review"
        : "Auth restoration failed; profile remains archived" });
    }

    const { data: verified, error: verifyError } = await admin.auth.admin.getUserById(targetId);
    if (verifyError || !verified.user || (verified.user.banned_until &&
        new Date(verified.user.banned_until).getTime() > Date.now())) {
      console.error("Restored user auth unban could not be verified", { targetId });
      return json(500, { error: "Account restoration could not be verified" });
    }

    console.info("user_restored", {
      actor_id: authData.user.id,
      target_user_id: targetId,
      organization_slug: target.organization_slug,
      restored_at: new Date().toISOString(),
    });
    return json(200, { success: true, message: "User restored. Existing login credentials remain valid." });
  } catch (error) {
    console.error("admin-restore-user error", error);
    return json(500, { error: "Unable to restore user. Contact an administrator." });
  }
});
