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

  console.log('🚀 Edge function called');

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    console.log('📦 Environment variables loaded');

    // Parse request body
    const body = await req.json();
    console.log('📥 Request body:', body);

    const {
      full_name,
      email,
      phone_number,
      assigned_hotel,
      role = 'housekeeping',
      password,
      organization_slug,
    } = body;

    console.log('🔐 Creating Supabase clients');
    
    const supabase = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization')! } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    console.log('🔍 Verifying caller permissions');

    // 1) Verify caller
    const {
      data: { user },
      error: getUserError,
    } = await supabase.auth.getUser();
    
    if (getUserError || !user) {
      console.error('❌ Auth error:', getUserError);
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    console.log('👤 User verified:', user.id);

    const { data: roleRow } = await supabase
      .from('profiles')
      .select('role, organization_slug')
      .eq('id', user.id)
      .maybeSingle();

    const callerRole = roleRow?.role as string | undefined;
    const callerOrgSlug = roleRow?.organization_slug as string | undefined;
    console.log('🎭 Caller role:', callerRole, 'Org:', callerOrgSlug);
    
    if (!callerRole || !['admin', 'housekeeping_manager', 'manager', 'top_management'].includes(callerRole)) {
      console.error('❌ Insufficient permissions for role:', callerRole);
      return new Response(
        JSON.stringify({ success: false, error: 'Insufficient permissions' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    if (callerRole === 'housekeeping_manager' && role !== 'housekeeping') {
      console.error('❌ Housekeeping manager cannot create non-housekeeping staff');
      return new Response(
        JSON.stringify({ success: false, error: 'Housekeeping managers can only create housekeeping staff' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    // Use caller's org if not super admin and no org provided
    const finalOrgSlug = organization_slug || callerOrgSlug || 'rdhotels';
    
    console.log('✅ Permission check passed, using org:', finalOrgSlug);

    // Helper function to sanitize strings for email (remove accents and special chars)
    const sanitizeForEmail = (text: string): string => {
      return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove diacritics/accents
        .replace(/[^a-zA-Z0-9_.-]/g, '')  // Keep only email-safe chars
        .toLowerCase();
    };

    // 2) Get the next sequence number for this organization
    console.log('🔢 Getting next sequence number for org:', finalOrgSlug);
    
    const { data: seqData, error: seqError } = await admin.rpc('get_next_housekeeper_sequence', {
      p_org_slug: finalOrgSlug
    });

    if (seqError) {
      console.error('❌ Sequence error:', seqError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to generate sequence number' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    const sequenceNumber = seqData as number;
    console.log('🔢 Got sequence number:', sequenceNumber);

    // 3) Generate username in format: Firstname_XXX (e.g., Nam_024)
    const firstName = String(full_name).trim().split(' ')[0];
    const generatedUsername = `${firstName}_${String(sequenceNumber).padStart(3, '0')}`;

    const generatedPassword = (password && String(password).trim().length
      ? String(password).trim()
      : `RD${crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`);

    // Sanitize username and org slug for email to avoid invalid characters
    const sanitizedUsername = sanitizeForEmail(generatedUsername);
    const sanitizedOrgSlug = sanitizeForEmail(finalOrgSlug);
    
    let finalEmail = email && String(email).trim().length
      ? String(email).trim()
      : `${sanitizedUsername}@${sanitizedOrgSlug}.local`;

    console.log('🔑 Generated credentials:', { username: generatedUsername, email: finalEmail });

    // 4) Create auth user with service role - handle email conflicts
    console.log('👤 Creating auth user...');
    let authResult = await admin.auth.admin.createUser({
      email: finalEmail,
      password: generatedPassword,
      email_confirm: true,
      user_metadata: {
        full_name,
        username: generatedUsername,
        assigned_hotel,
      },
    });

    // If email already exists, try with a unique generated email
    if (authResult.error?.message?.includes('already been registered')) {
      console.log('⚠️ Email already exists, trying with unique email...');
      const timestamp = Date.now().toString().slice(-4);
      // Use sanitized values for email to avoid invalid characters
      finalEmail = `${sanitizedUsername}.${timestamp}@${sanitizedOrgSlug}.local`;
      authResult = await admin.auth.admin.createUser({
        email: finalEmail,
        password: generatedPassword,
        email_confirm: true,
        user_metadata: {
          full_name,
          username: generatedUsername,
          assigned_hotel,
        },
      });
    }

    if (authResult.error || !authResult.data.user) {
      console.error('❌ Auth user creation failed:', authResult.error);
      return new Response(
        JSON.stringify({ success: false, error: authResult.error?.message || 'Failed to create auth user' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    const newUserId = authResult.data.user.id;
    console.log('✅ Auth user created:', newUserId);

    // 5) Insert profile with same id
    console.log('📝 Creating profile...');
    const { error: insertProfileErr } = await admin
      .from('profiles')
      .upsert({
        id: newUserId,
        email: finalEmail,
        full_name,
        role,
        phone_number: phone_number || null,
        assigned_hotel: !assigned_hotel || assigned_hotel === 'none' ? null : assigned_hotel,
        nickname: generatedUsername,
        organization_slug: finalOrgSlug,
      }, {
        onConflict: 'id'
      });

    if (insertProfileErr) {
      console.error('❌ Profile creation failed:', insertProfileErr);
      // Rollback: delete auth user to keep things clean
      await admin.auth.admin.deleteUser(newUserId).catch((deleteErr) => {
        console.error('⚠️ Failed to cleanup auth user:', deleteErr);
      });
      return new Response(
        JSON.stringify({ success: false, error: insertProfileErr.message }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    console.log('✅ Profile created successfully');

    const result = {
      success: true,
      user_id: newUserId,
      username: generatedUsername,
      password: generatedPassword,
      email: finalEmail,
      message: 'User created successfully',
    };

    console.log('🎉 Success! Returning result:', result);

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  } catch (e: any) {
    console.error('💥 Unhandled error:', e);
    return new Response(
      JSON.stringify({ success: false, error: e?.message || 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }
};

Deno.serve(handler);
