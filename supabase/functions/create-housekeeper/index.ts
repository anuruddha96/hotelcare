// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization')! } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const {
      full_name,
      email,
      phone_number,
      assigned_hotel,
      role = 'housekeeping',
      username,
      password,
    } = await req.json();

    // 1) Verify caller
    const {
      data: { user },
      error: getUserError,
    } = await supabase.auth.getUser();
    if (getUserError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    const { data: roleRow } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    const callerRole = roleRow?.role as string | undefined;
    if (!callerRole || !['admin', 'housekeeping_manager', 'manager', 'top_management'].includes(callerRole)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Insufficient permissions' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    if (callerRole === 'housekeeping_manager' && role !== 'housekeeping') {
      return new Response(
        JSON.stringify({ success: false, error: 'Housekeeping managers can only create housekeeping staff' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    // 2) Generate credentials when needed
    const generatedUsername = username && String(username).trim().length
      ? String(username).trim().toLowerCase()
      : `${String(full_name).trim().toLowerCase().replace(/\s+/g, '.')}.${Math.floor(Math.random() * 10000)
          .toString()
          .padStart(4, '0')}`;

    const generatedPassword = password && String(password).trim().length
      ? String(password).trim()
      : `RD${crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;

    const finalEmail = email && String(email).trim().length
      ? String(email).trim()
      : `${generatedUsername}@rdhotels.local`;

    // 3) Create auth user with service role
    const { data: createdUser, error: createErr } = await admin.auth.admin.createUser({
      email: finalEmail,
      password: generatedPassword,
      email_confirm: true,
      user_metadata: {
        full_name,
        username: generatedUsername,
        assigned_hotel,
      },
    });

    if (createErr || !createdUser.user) {
      return new Response(
        JSON.stringify({ success: false, error: createErr?.message || 'Failed to create auth user' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    const newUserId = createdUser.user.id;

    // 4) Insert profile with same id
    const { error: insertProfileErr } = await admin
      .from('profiles')
      .insert({
        id: newUserId,
        email: finalEmail,
        full_name,
        role,
        phone_number: phone_number || null,
        assigned_hotel: !assigned_hotel || assigned_hotel === 'none' ? null : assigned_hotel,
        nickname: generatedUsername,
      });

    if (insertProfileErr) {
      // Rollback: delete auth user to keep things clean
      await admin.auth.admin.deleteUser(newUserId).catch(() => {});
      return new Response(
        JSON.stringify({ success: false, error: insertProfileErr.message }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: newUserId,
        username: generatedUsername,
        password: generatedPassword,
        email: finalEmail,
        message: 'User created successfully',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: e?.message || 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }
};

Deno.serve(handler);
