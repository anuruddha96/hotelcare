import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};


// Module-level, best-effort short circuit. A shared DB gate below protects
// multiple Edge Function instances; this cache avoids hitting it for floods.
const recentAttempts = new Map<string, { count: number; endsAt: number }>();

function localRateLimit(key: string, maximum: number, windowMs: number): number {
  const now = Date.now();
  if (recentAttempts.size > 4096) {
    for (const [k, v] of recentAttempts) {
      if (v.endsAt <= now) recentAttempts.delete(k);
    }
    if (recentAttempts.size > 4096) recentAttempts.clear();
  }
  const current = recentAttempts.get(key);
  if (!current || current.endsAt <= now) {
    recentAttempts.set(key, { count: 1, endsAt: now + windowMs });
    return 0;
  }
  current.count += 1;
  return current.count > maximum ? Math.max(1, Math.ceil((current.endsAt - now) / 1000)) : 0;
}

function jsonResponse(status: number, message: string, retryAfter?: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
      ...corsHeaders,
    },
  });
}

// HMAC keeps raw IPs and email addresses out of the persistent throttle table.
async function opaqueRateKey(serviceKey: string, scope: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(serviceKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const result = await crypto.subtle.sign("HMAC", key, encoder.encode(`${scope}:${value}`));
  return Array.from(new Uint8Array(result)).map((n) => n.toString(16).padStart(2, "0")).join("");
}

interface VerifyOTPRequest {
  email: string;
  otp_code: string;
  new_password: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, "Method not allowed");
  }
  if (Number(req.headers.get("content-length") || 0) > 4096) {
    return jsonResponse(413, "Request body too large");
  }

  // Only trust the Cloudflare-supplied connecting IP (not user-supplied X-Forwarded-For).
  const clientIp = req.headers.get("cf-connecting-ip")?.trim() || "unknown";
  const ipRetry = localRateLimit(`ip:${clientIp}`, 12, 60_000);
  if (ipRetry) {
    return jsonResponse(429, "Too many verification attempts. Please try again later.", ipRetry);
  }

  try {
    const body: Partial<VerifyOTPRequest> = await req.json();
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const otp_code = typeof body?.otp_code === "string" ? body.otp_code.trim() : "";
    const new_password = typeof body?.new_password === "string" ? body.new_password : "";

    if (!email || !otp_code || !new_password) {
      return jsonResponse(400, "Email, OTP code, and new password are required");
    }
    if (email.length > 254 || !/^[^@\s]+@[^@\s]+\\.[^@\s]+$/.test(email)
        || !/^\d{6}$/.test(otp_code) || new_password.length < 6
        || new_password.length > 1024) {
      return jsonResponse(400, "Invalid verification details");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!supabaseUrl || !serviceKey) return jsonResponse(503, "Verification temporarily unavailable");
    const emailKey = await opaqueRateKey(serviceKey, "email", email.toLowerCase());
    const emailRetry = localRateLimit(`email:${emailKey}`, 5, 900_000);
    if (emailRetry) {
      return jsonResponse(429, "Too many verification attempts. Please try again later.", emailRetry);
    }
    const ipKey = await opaqueRateKey(serviceKey, "ip", clientIp);
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Durable cross-instance gate. Fail closed if the protection isn't available.
    const { data: gate, error: gateError } = await supabase.rpc("check_password_reset_attempt", {
      p_ip_hash: ipKey,
      p_email_hash: emailKey,
    });
    const decision = Array.isArray(gate) ? gate[0] : gate;
    if (gateError || !decision || typeof decision.allowed !== "boolean") {
      console.error("Password reset attempt gate unavailable", gateError?.message);
      return jsonResponse(503, "Verification temporarily unavailable");
    }
    if (!decision.allowed) {
      return jsonResponse(
        429, "Too many verification attempts. Please try again later.",
        Math.max(1, Number(decision.retry_after_seconds) || 900),
      );
    }

    // Only a rate-limited request may reach the OTP lookup.
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