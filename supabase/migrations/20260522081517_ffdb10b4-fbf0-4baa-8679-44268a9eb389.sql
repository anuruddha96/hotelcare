
CREATE TABLE IF NOT EXISTS public.previo_reference_prices (
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date NOT NULL,
  rate_eur numeric(10,2) NOT NULL,
  persons integer,
  currency text NOT NULL DEFAULT 'EUR',
  pricelist_id text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, stay_date)
);

ALTER TABLE public.previo_reference_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "previo_ref_prices_select"
ON public.previo_reference_prices
FOR SELECT
TO authenticated
USING (
  public.is_revenue_user(auth.uid())
  AND organization_slug = public.get_user_organization_slug(auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_previo_ref_prices_hotel_date
  ON public.previo_reference_prices (hotel_id, stay_date);

ALTER TABLE public.pms_configurations
  ADD COLUMN IF NOT EXISTS last_sync_status text,
  ADD COLUMN IF NOT EXISTS last_sync_error text;

DELETE FROM public.daily_rates WHERE source = 'previo_realized';
