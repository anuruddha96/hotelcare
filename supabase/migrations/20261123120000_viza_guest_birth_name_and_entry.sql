-- VIZA arrival message: birth name pair and, for third-country guests, the
-- date and place of entry into Hungary (PMS-THF-VIZA guide v700, 4.2).
-- Additive only; existing rows stay NULL and nothing is reported until a
-- hotel has VIZA enabled.
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS birth_last_name text;
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS birth_first_name text;
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS entry_date date;
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS entry_place text;
