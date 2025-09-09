-- Update the email lookup function to be case-insensitive
CREATE OR REPLACE FUNCTION public.get_email_by_nickname(p_nickname text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email
  FROM public.profiles
  WHERE LOWER(nickname) = LOWER(p_nickname)
  LIMIT 1;
$$;

-- Create function to get email by case-insensitive email lookup
CREATE OR REPLACE FUNCTION public.get_email_case_insensitive(p_email text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email
  FROM public.profiles
  WHERE LOWER(email) = LOWER(p_email)
  LIMIT 1;
$$;

-- Create table for OTP verification
CREATE TABLE IF NOT EXISTS public.password_reset_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  otp_code TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '10 minutes'),
  used BOOLEAN DEFAULT FALSE,
  verified BOOLEAN DEFAULT FALSE
);

-- Add RLS policies for OTP table
ALTER TABLE public.password_reset_otps ENABLE ROW LEVEL SECURITY;

-- Only allow service role to manage OTP records (edge functions will handle this)
CREATE POLICY "Service role can manage OTPs" ON public.password_reset_otps
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_password_reset_otps_email_code 
ON public.password_reset_otps(email, otp_code);

-- Add index for cleanup
CREATE INDEX IF NOT EXISTS idx_password_reset_otps_expires_at 
ON public.password_reset_otps(expires_at);