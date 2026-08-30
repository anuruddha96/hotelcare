ALTER TABLE public.revenue_pickup_automation_rules
  ADD COLUMN IF NOT EXISTS adr_guard_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS adr_target_eur numeric,
  ADD COLUMN IF NOT EXISTS adr_window_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS competitor_max_age_hours_near integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS competitor_max_age_hours_far integer NOT NULL DEFAULT 96,
  ADD COLUMN IF NOT EXISTS seasonal_anchor_enabled boolean NOT NULL DEFAULT false;

UPDATE public.revenue_pickup_automation_rules
   SET manual_hold_hours = 2,
       adr_guard_enabled = true,
       adr_target_eur = 130,
       adr_window_days = 7,
       seasonal_anchor_enabled = true,
       updated_at = now()
 WHERE hotel_id = 'ottofiori';

CREATE TABLE IF NOT EXISTS public.revenue_manual_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date NOT NULL,
  locked_until timestamptz NOT NULL,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, stay_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.revenue_manual_locks TO authenticated;
GRANT ALL ON public.revenue_manual_locks TO service_role;
ALTER TABLE public.revenue_manual_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Revenue users read manual locks in their organisation"
  ON public.revenue_manual_locks FOR SELECT TO authenticated
  USING (public.is_revenue_user(auth.uid())
         AND organization_slug = public.get_user_organization_slug(auth.uid()));

CREATE POLICY "Revenue users manage manual locks in their organisation"
  ON public.revenue_manual_locks FOR ALL TO authenticated
  USING (public.is_revenue_user(auth.uid())
         AND organization_slug = public.get_user_organization_slug(auth.uid()))
  WITH CHECK (public.is_revenue_user(auth.uid())
         AND organization_slug = public.get_user_organization_slug(auth.uid()));

CREATE TRIGGER revenue_manual_locks_updated_at
  BEFORE UPDATE ON public.revenue_manual_locks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.revenue_automation_runs
  ADD COLUMN IF NOT EXISTS push_run_id uuid;

ALTER TABLE public.revenue_date_decisions
  ADD COLUMN IF NOT EXISTS hold_kind text,
  ADD COLUMN IF NOT EXISTS adr_required_rate numeric,
  ADD COLUMN IF NOT EXISTS adr_feasible boolean,
  ADD COLUMN IF NOT EXISTS anchor_price numeric;

ALTER TABLE public.competitor_properties
  ADD COLUMN IF NOT EXISTS scan_tier smallint NOT NULL DEFAULT 2;

CREATE INDEX IF NOT EXISTS revenue_pickup_ledger_unspent_idx
  ON public.revenue_pickup_ledger (hotel_id, stay_date)
  WHERE increase_spent_at IS NULL AND cancelled_at IS NULL;

DROP FUNCTION IF EXISTS public.revenue_latest_snapshots(text, date, date);
CREATE FUNCTION public.revenue_latest_snapshots(p_hotel_id text, p_from date, p_to date)
RETURNS TABLE(stay_date date, occupancy_pct numeric, rooms_sold integer, rooms_available integer,
              revenue_eur numeric, adr_eur numeric, captured_date date, rn integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT s.stay_date, s.occupancy_pct, s.rooms_sold, s.rooms_available,
         s.revenue_eur, s.adr_eur, s.captured_date, s.rn
  FROM (
    SELECT d.stay_date, d.occupancy_pct, d.rooms_sold, d.rooms_available,
           d.revenue_eur, d.adr_eur, d.captured_date,
           row_number() OVER (PARTITION BY d.stay_date ORDER BY d.captured_at DESC)::int AS rn
    FROM public.revenue_daily_snapshots d
    WHERE d.hotel_id = p_hotel_id
      AND d.stay_date >= p_from AND d.stay_date <= p_to
  ) s
  WHERE s.rn <= 2
$function$;

GRANT EXECUTE ON FUNCTION public.revenue_latest_snapshots(text, date, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revenue_seasonal_anchor(p_hotel_id text, p_min_samples integer DEFAULT 4)
RETURNS TABLE(month integer, dow integer, anchor_eur numeric, samples integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXTRACT(MONTH FROM t.stay_date)::int AS month,
         EXTRACT(ISODOW FROM t.stay_date)::int AS dow,
         round(avg(t.adr_eur))::numeric AS anchor_eur,
         count(*)::int AS samples
  FROM (
    SELECT DISTINCT ON (d.stay_date) d.stay_date, d.adr_eur
    FROM public.revenue_daily_snapshots d
    WHERE d.hotel_id = p_hotel_id
      AND d.stay_date < current_date
      AND d.stay_date >= current_date - interval '400 days'
      AND d.adr_eur IS NOT NULL AND d.adr_eur > 0
      AND d.rooms_sold IS NOT NULL AND d.rooms_sold > 0
    ORDER BY d.stay_date, d.captured_at DESC
  ) t
  GROUP BY 1, 2
  HAVING count(*) >= p_min_samples
$function$;

GRANT EXECUTE ON FUNCTION public.revenue_seasonal_anchor(text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revenue_manual_hold_state(
  p_hotel_id text, p_since timestamptz, p_sources text[])
RETURNS TABLE(stay_date date, hold_until timestamptz, hold_kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT l.stay_date, l.locked_until AS hold_until, 'hard'::text AS hold_kind
  FROM public.revenue_manual_locks l
  WHERE l.hotel_id = p_hotel_id AND l.locked_until > now()
  UNION ALL
  SELECT a.stay_date, max(a.performed_at) AS hold_until, 'soft'::text AS hold_kind
  FROM public.rate_change_audit a
  WHERE a.hotel_id = p_hotel_id
    AND a.performed_at >= p_since
    AND a.stay_date >= current_date
    AND a.source = ANY (p_sources)
  GROUP BY a.stay_date
$function$;

GRANT EXECUTE ON FUNCTION public.revenue_manual_hold_state(text, timestamptz, text[]) TO authenticated, service_role;