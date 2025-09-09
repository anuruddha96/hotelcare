-- Add phone_number column to password_reset_otps table
ALTER TABLE public.password_reset_otps 
ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- Create index for phone lookups
CREATE INDEX IF NOT EXISTS idx_password_reset_otps_phone 
ON public.password_reset_otps(phone_number) 
WHERE phone_number IS NOT NULL;