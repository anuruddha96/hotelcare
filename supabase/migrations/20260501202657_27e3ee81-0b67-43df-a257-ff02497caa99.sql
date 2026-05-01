
CREATE TABLE public.revenue_ai_insights (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id TEXT NOT NULL,
  organization_slug TEXT NOT NULL,
  focus_date DATE,
  payload JSONB NOT NULL,
  generated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_revenue_ai_insights_hotel ON public.revenue_ai_insights(hotel_id, created_at DESC);

ALTER TABLE public.revenue_ai_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/top_mgmt can view ai insights in their org"
ON public.revenue_ai_insights FOR SELECT
TO authenticated
USING (
  organization_slug = (SELECT organization_slug FROM public.profiles WHERE id = auth.uid())
  AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','top_management')
);

CREATE POLICY "Admin/top_mgmt can insert ai insights in their org"
ON public.revenue_ai_insights FOR INSERT
TO authenticated
WITH CHECK (
  organization_slug = (SELECT organization_slug FROM public.profiles WHERE id = auth.uid())
  AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','top_management')
);
