-- Guest registration fields required for Hungarian VIZA / NTAK reporting.
-- Additive only; nothing is reported anywhere yet.
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS birth_place text;
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS gender text
  CHECK (gender IS NULL OR gender IN ('male','female','other'));
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS mother_name text;
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS visa_number text;
