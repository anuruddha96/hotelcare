import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.0";

import { canEditTarget, canAssignRole, canChangeStaffAccess } from "./policy.ts";

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
  phone_number?: string | null;
  assigned_hotel?: string | null;
  role?: string;
  organization_slug?: string;
  is_super_admin?: boolean;
  acts_as_housekeeper?: boolean;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: AdminUpdateUserPayload = await req.json();
    const { target_user_id, new_email, new_password, full_name, nickname, phone_number, assigned_hotel, role, organization_slug, is_super_admin, acts_as_housekeeper } = payload;

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

    // Verify caller is admin, manager, or housekeeping_manager
    const { data: roleData, error: roleErr } = await supabase
      .from("profiles")
      .select("role, organization_slug, is_super_admin, deleted_at")
      .eq("id", caller.id)
      .maybeSingle();

    if (roleErr || !roleData || roleData.deleted_at || (!roleData.is_super_admin && !['admin', 'top_management', 'top_management_manager', 'manager', 'housekeeping_manager'].includes(roleData.role))) {
      return new Response(JSON.stringify({ error: "Forbidden: staff-management role required" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Service-role client for auth.admin operations
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // Authorize against the current target and caller before any auth or profile write.
    const fail = (error: string, status = 400) => new Response(JSON.stringify({ error }), {
      status, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
    const { data: targetProfile, error: targetScopeErr } = await supabaseAdmin
      .from('profiles')
      .select('id, role, organization_slug, is_super_admin, deleted_at, email, full_name, nickname, phone_number, assigned_hotel, acts_as_housekeeper')
      .eq('id', target_user_id)
      .maybeSingle();
    if (targetScopeErr || !targetProfile) return fail("Target user not found", 404);
    if (!canEditTarget(roleData, targetProfile)) return fail("You cannot edit this account.", 403);

    // Validate requested fields before touching credentials.
    for (const value of [new_email, new_password, full_name, role, organization_slug]) {
      if (value != null && typeof value !== 'string') return fail("Invalid user details.");
    }
    for (const value of [nickname, phone_number, assigned_hotel]) {
      if (value != null && typeof value !== 'string') return fail("Invalid user details.");
    }
    if (full_name !== undefined && !full_name?.trim()) return fail("Full name is required.");
    if (is_super_admin !== undefined && typeof is_super_admin !== 'boolean') return fail("Invalid administrator flag.");
    if (acts_as_housekeeper !== undefined && typeof acts_as_housekeeper !== 'boolean') return fail("Invalid housekeeping flag.");
    const roleChanged = role !== undefined && role !== targetProfile.role;
    const orgChanged = organization_slug !== undefined && organization_slug !== targetProfile.organization_slug;
    const superChanged = is_super_admin !== undefined && is_super_admin !== !!targetProfile.is_super_admin;
    const hybridChanged = acts_as_housekeeper !== undefined && acts_as_housekeeper !== !!targetProfile.acts_as_housekeeper;
    if (roleChanged && !canAssignRole(roleData, role!)) return fail("You cannot assign this role.", 403);
    if ((orgChanged || superChanged) && !roleData.is_super_admin) return fail("Only Super Admins can change organization or Super Admin access.", 403);
    if (hybridChanged && !canChangeStaffAccess(roleData)) return fail("You cannot change housekeeping access.", 403);
    const effectiveOrg = organization_slug ?? targetProfile.organization_slug;
    const hotelInput = assigned_hotel === undefined ? targetProfile.assigned_hotel : assigned_hotel?.trim() || null;
    if (orgChanged || hotelInput !== targetProfile.assigned_hotel) {
      if (!effectiveOrg) return fail("An organization is required.");
      const { data: org, error: orgErr } = await supabaseAdmin.from('organizations')
        .select('id').eq('slug', effectiveOrg).eq('is_active', true).maybeSingle();
      if (orgErr || !org) return fail("Select an active organization.");
      if (hotelInput) {
        const { data: hotel, error: hotelErr } = await supabaseAdmin.from('hotel_configurations')
          .select('hotel_id').eq('organization_id', org.id).eq('is_active', true).eq('hotel_name', hotelInput).limit(1).maybeSingle();
        if (hotelErr || !hotel) return fail("Select a hotel in the user's organization.");
      }
    }
    const emailInput = new_email?.trim() && new_email.trim() !== targetProfile.email ? new_email.trim() : undefined;
    const passwordInput = new_password?.trim() || undefined;
    const fullNameInput = full_name?.trim() || undefined;
    const nicknameInput = nickname?.trim() || undefined;

    const effectiveEmail = emailInput || targetProfile?.email;

    // Update or create auth user if admin provided email/password or password alone
    if (emailInput || passwordInput) {
      console.log('Updating auth user for:', target_user_id);

      // First check if auth user exists
      const { data: authUserRes, error: getUserErr } = await supabaseAdmin.auth.admin.getUserById(target_user_id);

      if (getUserErr || !authUserRes.user) {
        // Create auth user when missing (requires password and an effective email)
        if (passwordInput && effectiveEmail) {
          console.log('Creating missing auth user');
          const { data: createResult, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            id: target_user_id,
            email: effectiveEmail,
            password: passwordInput,
            email_confirm: true,
            user_metadata: {
              ...(fullNameInput ? { full_name: fullNameInput } : {}),
              ...(nicknameInput ? { username: nicknameInput } : {}),
            },
          });

          if (createErr) {
            const dup = (createErr.message || '').toLowerCase().includes('duplicate key') || 
                        (createErr.message || '').toLowerCase().includes('users_email_partial_key') ||
                        (createErr.message || '').toLowerCase().includes('already registered') ||
                        (createErr.message || '').toLowerCase().includes('email address not authorized');
            const msg = dup ? 'Email already in use by another account' : createErr.message;
            console.error('Error creating auth user:', createErr);
            return new Response(JSON.stringify({ error: msg }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
          }
          console.log('Auth user created successfully:', createResult?.user?.id);
        } else if (passwordInput && targetProfile?.email) {
          // Create auth user with profile email if we have a password but no email input
          console.log('Creating new auth user with profile email:', targetProfile.email);
          const { data: createResult, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            id: target_user_id,
            email: targetProfile.email,
            password: passwordInput,
            email_confirm: true,
            user_metadata: {
              ...(fullNameInput ? { full_name: fullNameInput } : {}),
              ...(nicknameInput ? { username: nicknameInput } : {}),
            },
          });

          if (createErr) {
            const dup = (createErr.message || '').toLowerCase().includes('duplicate key') || 
                        (createErr.message || '').toLowerCase().includes('users_email_partial_key') ||
                        (createErr.message || '').toLowerCase().includes('already registered');
            const msg = dup ? 'Email already in use by another account' : createErr.message;
            console.error('Error creating auth user:', createErr);
            return new Response(JSON.stringify({ error: msg }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
          }
          console.log('Auth user created successfully with profile email:', createResult?.user?.id);
        } else {
          return fail('This account has no login credentials. Set a password before changing its email.');
        }
      } else {
        // Auth user exists, update it
        console.log('Updating existing auth user');
        const updateData: any = {};
        
        if (emailInput) {
          updateData.email = emailInput;
          updateData.email_confirm = true; // Auto-confirm updated emails
        }
        
        if (passwordInput) {
          updateData.password = passwordInput;
          // Force password update by invalidating existing sessions
          updateData.email_confirm = true;
        }
        
        if (fullNameInput || nicknameInput) {
          updateData.user_metadata = {
            ...(authUserRes.user.user_metadata || {}),
            ...(fullNameInput ? { full_name: fullNameInput } : {}),
            ...(nicknameInput ? { username: nicknameInput } : {}),
          };
        }

        const { data: updateResult, error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(target_user_id, updateData);

        if (updateErr) {
          const dup = (updateErr.message || '').toLowerCase().includes('duplicate key') || 
                      (updateErr.message || '').toLowerCase().includes('users_email_partial_key') ||
                      (updateErr.message || '').toLowerCase().includes('already registered') ||
                      (updateErr.message || '').toLowerCase().includes('email address not authorized');
          const msg = dup ? 'Email already in use by another account' : updateErr.message;
          console.error('Error updating auth user:', updateErr);
          return new Response(JSON.stringify({ error: msg }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        console.log('Auth user updated successfully:', updateResult?.user?.id);
      }
    }

    // Update public profile for consistency (doesn't require service role)
    const updates: Record<string, any> = {};
    if (emailInput) updates.email = emailInput;
    if (fullNameInput) updates.full_name = fullNameInput;
    if (nickname !== undefined) updates.nickname = nickname?.trim() || null;
    if (phone_number !== undefined) updates.phone_number = phone_number?.trim() || null;
    if (assigned_hotel !== undefined) updates.assigned_hotel = assigned_hotel?.trim() || null;

    if (roleChanged) updates.role = role;
    if (orgChanged) updates.organization_slug = organization_slug;
    if (superChanged) updates.is_super_admin = is_super_admin;
    if (hybridChanged) updates.acts_as_housekeeper = acts_as_housekeeper;
    if (orgChanged || assigned_hotel !== undefined) updates.assigned_hotel = hotelInput;

    // Require an actual updated row rather than reporting success on a zero-row update.
    if (Object.keys(updates).length > 0) {
      // Use the already-authorized service-role client for the target write. Managers
      // are scope-checked above, so this avoids profile RLS silently blocking edits.
      let query = supabaseAdmin.from('profiles')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', target_user_id).is('deleted_at', null);
      if (!roleData.is_super_admin) query = query.eq('organization_slug', roleData.organization_slug).eq('role', targetProfile.role);
      const { data: saved, error: profileErr } = await query.select('id').maybeSingle();

      if (profileErr || !saved) {
        console.error('Error updating profile:', profileErr);
        return new Response(JSON.stringify({ error: emailInput || passwordInput ? 'Credentials may have changed, but profile details were not saved. Reload the account and try again.' : (profileErr?.message || 'Account changed or was removed. Reload and try again.') }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      console.log('Profile updated successfully');
    }

    console.log("User update completed successfully");
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
