import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.0";
import { Resend } from "npm:resend@4.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

interface PasswordResetRequest {
  email: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email }: PasswordResetRequest = await req.json();

    if (!email) {
      return new Response(JSON.stringify({ error: "Email is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Check if user exists in profiles table
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('email', email)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "No account found with this email address" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Generate password reset link
    const redirectUrl = `${Deno.env.get("SITE_URL") || "http://localhost:3000"}/auth?mode=recovery`;
    
    const { error: resetError } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: email,
      options: {
        redirectTo: redirectUrl
      }
    });

    if (resetError) {
      console.error('Password reset error:', resetError);
      return new Response(JSON.stringify({ error: "Failed to send password reset email" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Send email using Resend
    const emailHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset - RD Hotels</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
          .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); padding: 40px 30px; text-align: center; }
          .logo { font-size: 28px; font-weight: bold; color: white; margin-bottom: 8px; }
          .subtitle { color: rgba(255,255,255,0.9); font-size: 16px; }
          .content { padding: 40px 30px; }
          .greeting { font-size: 18px; color: #1f2937; margin-bottom: 20px; }
          .message { color: #4b5563; line-height: 1.6; margin-bottom: 30px; }
          .reset-button { display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; text-align: center; margin: 20px 0; }
          .footer { background: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb; }
          .footer-text { color: #6b7280; font-size: 14px; line-height: 1.5; }
          .security-note { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 20px 0; border-radius: 4px; }
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
              We received a request to reset your password for your RD Hotels account. Click the button below to create a new password:
            </div>
            
            <div style="text-align: center;">
              <a href="${redirectUrl}" class="reset-button">Reset My Password</a>
            </div>
            
            <div class="security-note">
              <strong>Security Notice:</strong> This password reset link will expire in 1 hour for your security. If you didn't request this reset, please contact your system administrator immediately.
            </div>
            
            <div class="message">
              If the button above doesn't work, you can copy and paste this link into your browser:<br>
              <a href="${redirectUrl}" style="color: #2563eb; word-break: break-all;">${redirectUrl}</a>
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
      to: [email],
      subject: "Reset Your Password - RD Hotels",
      html: emailHtml,
    });

    if (emailError) {
      console.error('Email sending error:', emailError);
      return new Response(JSON.stringify({ error: "Failed to send password reset email" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Password reset email sent successfully" 
      }),
      { 
        status: 200, 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      }
    );

  } catch (error: any) {
    console.error("Password reset function error:", error);
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