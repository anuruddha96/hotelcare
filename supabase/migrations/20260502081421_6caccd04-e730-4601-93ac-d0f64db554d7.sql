DROP FUNCTION IF EXISTS public.expire_stale_recommendations();

CREATE TABLE IF NOT EXISTS public.rate_change_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date,
  action text NOT NULL,
  old_rate_eur numeric,
  new_rate_eur numeric,
  delta_eur numeric,
  recommendation_id uuid,
  source text,
  performed_by uuid,
  performed_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  payload jsonb
);

CREATE INDEX IF NOT EXISTS idx_rate_change_audit_hotel_date ON public.rate_change_audit (hotel_id, stay_date DESC);
CREATE INDEX IF NOT EXISTS idx_rate_change_audit_org ON public.rate_change_audit (organization_slug, performed_at DESC);

ALTER TABLE public.rate_change_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_select_admin_topmgmt" ON public.rate_change_audit;
CREATE POLICY "audit_select_admin_topmgmt"
  ON public.rate_change_audit FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin','top_management')
        AND p.organization_slug = rate_change_audit.organization_slug
    )
  );

DROP POLICY IF EXISTS "audit_insert_authenticated" ON public.rate_change_audit;
CREATE POLICY "audit_insert_authenticated"
  ON public.rate_change_audit FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.organization_slug = rate_change_audit.organization_slug
    )
  );

ALTER TABLE public.pickup_snapshots
  ADD COLUMN IF NOT EXISTS snapshot_label text;

ALTER TABLE public.hotel_revenue_settings
  ADD COLUMN IF NOT EXISTS notify_email text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS notify_sms text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS notify_on jsonb NOT NULL DEFAULT '{"abnormal":true,"new_recs":true,"ai_ready":true}'::jsonb;

CREATE OR REPLACE FUNCTION public.audit_rate_recommendation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_source text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'engine_create';
    v_source := CASE WHEN NEW.reason ILIKE 'AI:%' THEN 'ai' ELSE 'engine' END;
    INSERT INTO public.rate_change_audit
      (hotel_id, organization_slug, stay_date, action, old_rate_eur, new_rate_eur, delta_eur,
       recommendation_id, source, performed_by, notes)
    VALUES
      (NEW.hotel_id, NEW.organization_slug, NEW.stay_date, v_action,
       NEW.current_rate_eur, NEW.recommended_rate_eur, NEW.delta_eur,
       NEW.id, v_source, NEW.reviewed_by, NEW.reason);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_action := CASE NEW.status::text
      WHEN 'approved' THEN 'approve'
      WHEN 'overridden' THEN 'override'
      WHEN 'expired' THEN 'dismiss'
      WHEN 'pushed' THEN 'pushed'
      ELSE NEW.status::text
    END;
    INSERT INTO public.rate_change_audit
      (hotel_id, organization_slug, stay_date, action, old_rate_eur, new_rate_eur, delta_eur,
       recommendation_id, source, performed_by, notes)
    VALUES
      (NEW.hotel_id, NEW.organization_slug, NEW.stay_date, v_action,
       NEW.current_rate_eur, NEW.recommended_rate_eur, NEW.delta_eur,
       NEW.id, 'manual', NEW.reviewed_by, NEW.reason);
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_rate_recommendation ON public.rate_recommendations;
CREATE TRIGGER trg_audit_rate_recommendation
AFTER INSERT OR UPDATE ON public.rate_recommendations
FOR EACH ROW EXECUTE FUNCTION public.audit_rate_recommendation();

CREATE OR REPLACE FUNCTION public.expire_stale_recommendations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.rate_recommendations
  SET status = 'expired'
  WHERE status = 'pending'
    AND created_at < now() - interval '24 hours';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;