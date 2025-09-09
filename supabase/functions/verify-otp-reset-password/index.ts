import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface VerifyOTPRequest {
  email: string;
  otp_code: string;
  new_password: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, otp_code, new_password }: VerifyOTPRequest = await req.json();

    if (!email || !otp_code || !new_password) {
      return new Response(JSON.stringify({ error: "Email, OTP code, and new password are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify OTP
    const { data: otpRecord, error: otpError } = await supabase
      .from('password_reset_otps')
      .select('*')
      .eq('email', email)
      .eq('otp_code', otp_code)
      .eq('used', false)
      .eq('verified', false)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (otpError || !otpRecord) {
      return new Response(JSON.stringify({ error: "Invalid or expired OTP code" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Get user profile to find user ID
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email')
      .ilike('email', email)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Check if auth user exists
    const { data: authUser, error: authUserError } = await supabase.auth.admin.getUserById(profile.id);

    if (authUserError || !authUser.user) {
      // Create auth user if it doesn't exist
      const { data: newAuthUser, error: createError } = await supabase.auth.admin.createUser({
        id: profile.id,
        email: profile.email,
        password: new_password,
        email_confirm: true,
      });

      if (createError) {
        console.error('Error creating auth user:', createError);
        return new Response(JSON.stringify({ error: "Failed to create user authentication" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
    } else {
      // Update existing auth user password
      const { error: updateError } = await supabase.auth.admin.updateUserById(profile.id, {
        password: new_password,
      });

      if (updateError) {
        console.error('Error updating password:', updateError);
        return new Response(JSON.stringify({ error: "Failed to update password" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
    }

    // Mark OTP as used and verified
    const { error: markUsedError } = await supabase
      .from('password_reset_otps')
      .update({ 
        used: true, 
        verified: true 
      })
      .eq('id', otpRecord.id);

    if (markUsedError) {
      console.error('Error marking OTP as used:', markUsedError);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Password reset successfully. You can now log in with your new password." 
      }),
      { 
        status: 200, 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      }
    );

  } catch (error: any) {
    console.error("OTP verification error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);