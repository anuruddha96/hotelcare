ALTER TABLE public.hotel_revenue_settings
  ADD COLUMN IF NOT EXISTS base_currency text NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS eur_conversion_rate numeric,
  ADD COLUMN IF NOT EXISTS eur_rate_source text,
  ADD COLUMN IF NOT EXISTS eur_rate_updated_at timestamptz;