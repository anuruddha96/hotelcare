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
      .select('role, assigned_hotel, organization_slug')
      .eq('id', userData.user.id)
      .maybeSingle();

    if (callerErr || !callerProfile) {
      console.error('Caller profile error:', callerErr);
      return new Response(JSON.stringify({ error: 'Failed to verify permissions' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Check if caller has permission (admin, manager, housekeeping_manager)
    const allowedRoles = ['admin', 'manager', 'housekeeping_manager'];
    if (!allowedRoles.includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Get target user's profile
    const { data: targetProfile, error: targetErr } = await admin
      .from('profiles')
      .select('role, assigned_hotel, organization_slug, full_name')
      .eq('id', target_user_id)
      .maybeSingle();

    if (targetErr || !targetProfile) {
      console.error('Target profile error:', targetErr);
      return new Response(JSON.stringify({ error: 'Target user not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Non-admin managers can only reset passwords for housekeeping staff in their hotel
    if (callerProfile.role !== 'admin') {
      // Check if target is a housekeeper
      if (targetProfile.role !== 'housekeeping') {
        return new Response(JSON.stringify({ error: 'You can only reset passwords for housekeeping staff' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Check same hotel (or same organization if no hotel assigned)
      const sameHotel = callerProfile.assigned_hotel && 
        callerProfile.assigned_hotel === targetProfile.assigned_hotel;
      const sameOrg = callerProfile.organization_slug === targetProfile.organization_slug;

      if (!sameHotel && !sameOrg) {
        return new Response(JSON.stringify({ error: 'You can only reset passwords for staff in your hotel' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    console.log(`Manager ${userData.user.id} resetting password for ${target_user_id}`);

    // Generate or use provided password
    const finalPassword = new_password && String(new_password).trim().length >= 6
      ? String(new_password).trim()
      : `RD${crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;

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
