import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.0";
import { Resend } from "npm:resend@4.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

interface OTPRequest {
  email: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email }: OTPRequest = await req.json();

    if (!email) {
      return new Response(JSON.stringify({ error: "Email is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Check if user exists in profiles table (case-insensitive)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .ilike('email', email)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "No account found with this email address" }), {
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
        email: profile.email,
        otp_code: otpCode,
      });

    if (otpError) {
      console.error('OTP storage error:', otpError);
      return new Response(JSON.stringify({ error: "Failed to generate OTP" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Send email with OTP
    const emailHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset OTP - RD Hotels</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
          .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #359FDB 0%, #6B6B6B 100%); padding: 40px 30px; text-align: center; }
          .logo { font-size: 28px; font-weight: bold; color: white; margin-bottom: 8px; }
          .subtitle { color: rgba(255,255,255,0.9); font-size: 16px; }
          .content { padding: 40px 30px; text-align: center; }
          .greeting { font-size: 18px; color: #1f2937; margin-bottom: 20px; }
          .message { color: #4b5563; line-height: 1.6; margin-bottom: 30px; }
          .otp-code { display: inline-block; background: linear-gradient(135deg, #359FDB 0%, #6B6B6B 100%); color: white; font-size: 32px; font-weight: bold; padding: 20px 40px; border-radius: 12px; letter-spacing: 8px; margin: 20px 0; font-family: 'Courier New', monospace; }
          .footer { background: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb; }
          .footer-text { color: #6b7280; font-size: 14px; line-height: 1.5; }
          .security-note { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 20px 0; border-radius: 4px; text-align: left; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🏨 RD Hotels</div>
            <div class="subtitle">Hotel Management System</div>
          </div>
          
          <div class="content">
            <div class="greeting">Hello ${profile.full_name || 'Team Member'},</div>
            
            <div class="message">
              We received a request to reset your password. Use the verification code below to reset your password:
            </div>
            
            <div class="otp-code">${otpCode}</div>
            
            <div class="security-note">
              <strong>Security Notice:</strong> This verification code will expire in 10 minutes for your security. If you didn't request this reset, please contact your system administrator immediately.
            </div>
            
            <div class="message">
              Enter this code in the password reset form to continue with resetting your password.
            </div>
          </div>
          
          <div class="footer">
            <div class="footer-text">
              <strong>RD Hotels Management System</strong><br>
              This is an automated message. Please do not reply to this email.<br>
              If you need assistance, contact your system administrator.
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const { error: emailError } = await resend.emails.send({
      from: "RD Hotels <noreply@rdhotels.com>",
      to: [profile.email],
      subject: "Password Reset Verification Code - RD Hotels",
      html: emailHtml,
    });

    if (emailError) {
      console.error('Email sending error:', emailError);
      return new Response(JSON.stringify({ error: "Failed to send verification code" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Verification code sent successfully",
        email: profile.email
      }),
      { 
        status: 200, 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      }
    );

  } catch (error: any) {
    console.error("OTP function error:", error);
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