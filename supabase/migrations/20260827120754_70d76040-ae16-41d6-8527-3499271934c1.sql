CREATE TABLE public.ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  organization_slug text,
  hotel_id uuid,
  function_name text not null,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  web_searches integer not null default 0,
  estimated_cost_usd numeric(10,5) not null default 0,
  ok boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);
CREATE INDEX ai_usage_log_org_created_idx ON public.ai_usage_log (organization_slug, created_at DESC);
CREATE INDEX ai_usage_log_created_idx ON public.ai_usage_log (created_at DESC);

GRANT SELECT ON public.ai_usage_log TO authenticated;
GRANT ALL ON public.ai_usage_log TO service_role;
ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai usage readable inside the organisation"
ON public.ai_usage_log FOR SELECT TO authenticated
USING (
  organization_slug IS NOT DISTINCT FROM public.get_user_organization_slug(auth.uid())
  OR public.is_super_admin(auth.uid())
);

CREATE TABLE public.ai_budget_settings (
  organization_slug text primary key,
  daily_budget_usd numeric(10,2) not null default 5,
  monthly_budget_usd numeric(10,2) not null default 100,
  competitor_scan_enabled boolean not null default true,
  event_sweep_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
GRANT SELECT, INSERT, UPDATE ON public.ai_budget_settings TO authenticated;
GRANT ALL ON public.ai_budget_settings TO service_role;
ALTER TABLE public.ai_budget_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai budget readable inside the organisation"
ON public.ai_budget_settings FOR SELECT TO authenticated
USING (
  organization_slug = public.get_user_organization_slug(auth.uid())
  OR public.is_super_admin(auth.uid())
);
CREATE POLICY "admins manage the ai budget"
ON public.ai_budget_settings FOR ALL TO authenticated
USING (
  (organization_slug = public.get_user_organization_slug(auth.uid())
    AND public.get_current_user_role() IN ('admin','top_management','top_management_manager'))
  OR public.is_super_admin(auth.uid())
)
WITH CHECK (
  (organization_slug = public.get_user_organization_slug(auth.uid())
    AND public.get_current_user_role() IN ('admin','top_management','top_management_manager'))
  OR public.is_super_admin(auth.uid())
);

CREATE OR REPLACE FUNCTION public.ai_spend_snapshot(_org text)
RETURNS TABLE (spend_today numeric, spend_month numeric, daily_budget numeric, monthly_budget numeric, within_budget boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (
    SELECT
      coalesce(sum(estimated_cost_usd) FILTER (WHERE created_at >= date_trunc('day', now())), 0) AS today,
      coalesce(sum(estimated_cost_usd) FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS month
    FROM public.ai_usage_log
    WHERE _org IS NULL OR organization_slug = _org
  ), b AS (
    SELECT coalesce(max(daily_budget_usd), 5) AS daily, coalesce(max(monthly_budget_usd), 100) AS monthly
    FROM public.ai_budget_settings WHERE _org IS NULL OR organization_slug = _org
  )
  SELECT s.today, s.month, b.daily, b.monthly, (s.today < b.daily AND s.month < b.monthly)
  FROM s CROSS JOIN b;
$$;
GRANT EXECUTE ON FUNCTION public.ai_spend_snapshot(text) TO authenticated, service_role;

UPDATE public.revenue_pickup_automation_rules SET ai_assist_enabled = false WHERE ai_assist_enabled;