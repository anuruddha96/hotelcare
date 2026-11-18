// Manager password reset for housekeepers in their hotel
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authHeader = req.headers.get('Authorization');

    // Client bound to the caller's JWT
    const supabase = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader ?? '' } },
    });

    // Service client (bypasses RLS)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Parse body
    const { target_user_id, new_password } = await req.json().catch(() => ({ target_user_id: null, new_password: null }));
    
    if (!target_user_id) {
      return new Response(JSON.stringify({ error: 'Missing target_user_id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Verify caller
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Get caller's profile (role and assigned hotel)
    const { data: callerProfile, error: callerErr } = await admin
      .from('profiles')
      .select('role, assigned_hotel, organization_slug, is_super_admin, deleted_at')
      .eq('id', userData.user.id)
      .maybeSingle();

    if (callerErr || !callerProfile || callerProfile.deleted_at) {
      console.error('Caller profile error:', callerErr);
      return new Response(JSON.stringify({ error: 'Failed to verify permissions' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Check if caller has permission (admin, manager, housekeeping_manager)
    const allowedRoles = ['admin', 'top_management', 'top_management_manager', 'manager', 'housekeeping_manager'];
    if (!allowedRoles.includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Get target user's profile
    const { data: targetProfile, error: targetErr } = await admin
      .from('profiles')
      .select('role, assigned_hotel, organization_slug, full_name, is_super_admin, deleted_at')
      .eq('id', target_user_id)
      .maybeSingle();

    if (targetErr || !targetProfile || targetProfile.deleted_at) {
      console.error('Target profile error:', targetErr);
      return new Response(JSON.stringify({ error: 'Target user not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Tenant scope applies to every management role, including top management.
    const sameOrganization = !!callerProfile.organization_slug &&
      callerProfile.organization_slug === targetProfile.organization_slug;
    if (!sameOrganization && !callerProfile.is_super_admin) {
      return new Response(JSON.stringify({ error: 'Cannot reset passwords outside your organization' }), { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }
    if (targetProfile.is_super_admin && !callerProfile.is_super_admin) {
      return new Response(JSON.stringify({ error: 'Only a super administrator can reset this password' }), { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // Protect privileged accounts from role-based password-reset escalation.
    if (['admin', 'top_management', 'top_management_manager'].includes(targetProfile.role) &&
      !callerProfile.is_super_admin && callerProfile.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only an administrator can reset this account' }), { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // Property managers may reset non-managerial staff at their assigned hotel.
    if (!['admin', 'top_management', 'top_management_manager'].includes(callerProfile.role)) {
      // Housekeeping managers are limited to housekeepers; hotel managers may
      // also assist other non-managerial staff at the same property.
      const protectedRoles = ['admin', 'top_management', 'top_management_manager', 'manager', 'housekeeping_manager', 'maintenance_manager', 'reception_manager', 'marketing_manager', 'back_office_manager', 'control_manager', 'finance_manager'];
      if ((callerProfile.role === 'housekeeping_manager' && targetProfile.role !== 'housekeeping') || protectedRoles.includes(targetProfile.role)) {
        return new Response(JSON.stringify({ error: 'You can only reset non-managerial staff in your hotel' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Must be the same organization AND the same assigned hotel
      const sameOrg = !!callerProfile.organization_slug &&
        callerProfile.organization_slug === targetProfile.organization_slug;
      const aliases = await admin.from('hotel_configurations').select('hotel_id, hotel_name').eq('is_active', true);
      if (aliases.error) return new Response(JSON.stringify({ error: 'Unable to verify hotel access' }), { status: 503, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      const resolveHotel = (value: string | null) => (aliases.data || []).find(h => h.hotel_id === value || h.hotel_name === value)?.hotel_id || value;
      const sameHotel = !!callerProfile.assigned_hotel &&
        resolveHotel(callerProfile.assigned_hotel) === resolveHotel(targetProfile.assigned_hotel);

      if (!sameOrg || !sameHotel) {
        return new Response(JSON.stringify({ error: 'You can only reset passwords for staff in your hotel' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }


    // Do not log plaintext passwords or recovery tokens.
    console.log('Authorized staff password reset requested', { actor: userData.user.id, target: target_user_id });

    // Reject short custom passwords instead of silently replacing them with generated ones.
    if (new_password && (String(new_password).length < 12 || String(new_password).length > 128)) {
      return new Response(JSON.stringify({ error: 'A custom password must contain 12–128 characters' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }
    const finalPassword = new_password || crypto.randomUUID().replace(/-/g, '') + '!aA9';

    // Update the user's password
    const { error: updateErr } = await admin.auth.admin.updateUserById(target_user_id, {
      password: finalPassword,
    });

    if (updateErr) {
      console.error('Password update error:', updateErr);
      return new Response(JSON.stringify({ error: updateErr.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        password: finalPassword,
        message: `Password reset successfully for ${targetProfile.full_name}` 
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  } catch (e: unknown) {
    console.error('Unhandled error in manager-reset-password', e);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
});
