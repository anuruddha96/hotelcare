
CREATE TABLE public.daily_overview_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text,
  business_date date NOT NULL,
  room_label text,
  arrival_date date,
  departure_date date,
  status text,
  guest_names text,
  pax int DEFAULT 0,
  breakfast int DEFAULT 0,
  lunch int DEFAULT 0,
  dinner int DEFAULT 0,
  all_inclusive int DEFAULT 0,
  housekeeping_stay text,
  housekeeping_dep text,
  source_filename text,
  uploaded_by uuid,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_daily_overview_snapshots_hotel_date
  ON public.daily_overview_snapshots(hotel_id, business_date DESC);

CREATE TABLE public.daily_overview_meal_totals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text,
  business_date date NOT NULL,
  breakfast int DEFAULT 0,
  lunch int DEFAULT 0,
  dinner int DEFAULT 0,
  all_inclusive int DEFAULT 0,
  adults int DEFAULT 0,
  children int DEFAULT 0,
  source_filename text,
  uploaded_by uuid,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_daily_overview_meal_totals_hotel_date
  ON public.daily_overview_meal_totals(hotel_id, business_date DESC);

ALTER TABLE public.daily_overview_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_overview_meal_totals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins/top_management can view daily overview snapshots"
  ON public.daily_overview_snapshots FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin','top_management')
        AND (p.organization_slug IS NULL OR p.organization_slug = daily_overview_snapshots.organization_slug)
    )
  );

CREATE POLICY "Admins/top_management can view daily overview meal totals"
  ON public.daily_overview_meal_totals FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin','top_management')
        AND (p.organization_slug IS NULL OR p.organization_slug = daily_overview_meal_totals.organization_slug)
    )
  );
