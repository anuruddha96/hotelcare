ALTER TABLE public.revenue_rate_drafts
  ADD COLUMN IF NOT EXISTS push_run_id uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS push_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confirmation_status text NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS revenue_rate_drafts_push_run_idx
  ON public.revenue_rate_drafts (push_run_id)
  WHERE push_run_id IS NOT NULL;

CREATE TABLE public.revenue_pickup_automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  name text NOT NULL DEFAULT 'Pickup pricing',
  is_enabled boolean NOT NULL DEFAULT false,
  auto_publish boolean NOT NULL DEFAULT true,
  booking_window_tiers jsonb NOT NULL DEFAULT '[{"max_days":31,"increase":8},{"max_days":93,"increase":18},{"max_days":null,"increase":22}]'::jsonb,
  same_hour_window_minutes integer NOT NULL DEFAULT 60,
  second_pickup_surcharge numeric NOT NULL DEFAULT 25,
  minimum_adr numeric,
  maximum_increase numeric,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revenue_pickup_automation_rules TO authenticated;
GRANT ALL ON public.revenue_pickup_automation_rules TO service_role;
ALTER TABLE public.revenue_pickup_automation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Revenue users view accessible pickup rules"
  ON public.revenue_pickup_automation_rules FOR SELECT TO authenticated
  USING (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id));
CREATE POLICY "Revenue users create accessible pickup rules"
  ON public.revenue_pickup_automation_rules FOR INSERT TO authenticated
  WITH CHECK (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id));
CREATE POLICY "Revenue users update accessible pickup rules"
  ON public.revenue_pickup_automation_rules FOR UPDATE TO authenticated
  USING (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id))
  WITH CHECK (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id));
CREATE POLICY "Revenue users delete accessible pickup rules"
  ON public.revenue_pickup_automation_rules FOR DELETE TO authenticated
  USING (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id));
CREATE TRIGGER touch_revenue_pickup_automation_rules_updated_at
  BEFORE UPDATE ON public.revenue_pickup_automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.revenue_pickup_automation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.revenue_pickup_automation_rules(id) ON DELETE CASCADE,
  rule_version integer NOT NULL,
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  reservation_id text NOT NULL,
  stay_date date NOT NULL,
  pickup_at timestamptz NOT NULL,
  pickup_sequence integer NOT NULL DEFAULT 1,
  room_type_name text NOT NULL,
  obk_id text NOT NULL,
  occupancy integer NOT NULL,
  old_price numeric,
  increase_amount numeric NOT NULL,
  new_price numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  push_error text,
  pushed_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, rule_version, reservation_id, stay_date, obk_id, occupancy)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revenue_pickup_automation_actions TO authenticated;
GRANT ALL ON public.revenue_pickup_automation_actions TO service_role;
ALTER TABLE public.revenue_pickup_automation_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Revenue users view accessible pickup actions"
  ON public.revenue_pickup_automation_actions FOR SELECT TO authenticated
  USING (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id));
CREATE POLICY "Revenue users create accessible pickup actions"
  ON public.revenue_pickup_automation_actions FOR INSERT TO authenticated
  WITH CHECK (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id));
CREATE POLICY "Revenue users update accessible pickup actions"
  ON public.revenue_pickup_automation_actions FOR UPDATE TO authenticated
  USING (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id))
  WITH CHECK (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id));
CREATE POLICY "Revenue users delete accessible pickup actions"
  ON public.revenue_pickup_automation_actions FOR DELETE TO authenticated
  USING (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id));
CREATE TRIGGER touch_revenue_pickup_automation_actions_updated_at
  BEFORE UPDATE ON public.revenue_pickup_automation_actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX revenue_pickup_automation_actions_hotel_date_idx
  ON public.revenue_pickup_automation_actions (hotel_id, stay_date, created_at DESC);
CREATE INDEX revenue_pickup_automation_actions_status_idx
  ON public.revenue_pickup_automation_actions (status, created_at)
  WHERE status IN ('pending', 'failed');