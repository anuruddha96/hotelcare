import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SMSOTPRequest {
  phone: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone }: SMSOTPRequest = await req.json();

    if (!phone) {
      return new Response(JSON.stringify({ error: "Phone number is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Check if user exists in profiles table with this phone number
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, phone_number, email')
      .eq('phone_number', phone)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "No account found with this phone number" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Generate 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Store OTP in database
    const { error: otpError } = await supabase
      .from('password_reset_otps')
      .insert({
        email: profile.email, // We use email as primary key for OTP table
        phone_number: phone,
        otp_code: otpCode,
      });

    if (otpError) {
      console.error('OTP storage error:', otpError);
      return new Response(JSON.stringify({ error: "Failed to generate OTP" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // For now, log the OTP since we don't have SMS service configured
    // In production, you would integrate with Twilio, AWS SNS, or similar
    console.log(`SMS OTP for ${phone}: ${otpCode}`);
    
    // Simulate SMS sending - replace with actual SMS service
    const smsSuccess = true; // This would be the result of your SMS API call
    
    if (!smsSuccess) {
      return new Response(JSON.stringify({ error: "Failed to send SMS" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Verification code sent to your phone",
        phone: phone
      }),
      { 
        status: 200, 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      }
    );

  } catch (error: any) {
    console.error("SMS OTP function error:", error);
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