CREATE TABLE public.revenue_rate_push_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text,
  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','partial','failed')),
  requested_count integer NOT NULL DEFAULT 0,
  processed_count integer NOT NULL DEFAULT 0,
  accepted_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  compressed_message_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.revenue_rate_push_runs TO authenticated;
GRANT ALL ON public.revenue_rate_push_runs TO service_role;
ALTER TABLE public.revenue_rate_push_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Revenue users view accessible rate push runs" ON public.revenue_rate_push_runs FOR SELECT TO authenticated USING (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id));
CREATE POLICY "Revenue users create accessible rate push runs" ON public.revenue_rate_push_runs FOR INSERT TO authenticated WITH CHECK (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id) AND created_by = auth.uid());

CREATE TABLE public.revenue_rate_push_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.revenue_rate_push_runs(id) ON DELETE CASCADE,
  hotel_id text NOT NULL,
  organization_slug text,
  stay_date date NOT NULL,
  obk_id text,
  room_type_name text NOT NULL,
  occupancy integer NOT NULL CHECK (occupancy > 0),
  old_price numeric,
  target_price numeric NOT NULL CHECK (target_price > 0),
  currency text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','accepted','confirmed','different','failed')),
  draft_id uuid REFERENCES public.revenue_rate_drafts(id) ON DELETE SET NULL,
  actual_previo_price numeric,
  attempt_count integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  accepted_at timestamptz,
  confirmed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, stay_date, room_type_name, occupancy)
);
GRANT SELECT, INSERT ON public.revenue_rate_push_items TO authenticated;
GRANT ALL ON public.revenue_rate_push_items TO service_role;
ALTER TABLE public.revenue_rate_push_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Revenue users view accessible rate push items" ON public.revenue_rate_push_items FOR SELECT TO authenticated USING (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id));
CREATE POLICY "Revenue users create accessible rate push items" ON public.revenue_rate_push_items FOR INSERT TO authenticated WITH CHECK (public.is_revenue_user(auth.uid()) AND public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE INDEX revenue_rate_push_runs_recovery_idx ON public.revenue_rate_push_runs (status, created_at) WHERE status IN ('queued','processing');
CREATE INDEX revenue_rate_push_items_run_status_idx ON public.revenue_rate_push_items (run_id, status);
CREATE INDEX revenue_rate_push_items_hotel_date_idx ON public.revenue_rate_push_items (hotel_id, stay_date);

CREATE TRIGGER touch_revenue_rate_push_runs_updated_at BEFORE UPDATE ON public.revenue_rate_push_runs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER touch_revenue_rate_push_items_updated_at BEFORE UPDATE ON public.revenue_rate_push_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.revenue_pickup_automation_rules
  ADD COLUMN positive_pickup_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN pickup_lookback_hours integer NOT NULL DEFAULT 48,
  ADD COLUMN no_pickup_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN no_pickup_lookback_hours integer NOT NULL DEFAULT 8,
  ADD COLUMN future_booking_window_days integer NOT NULL DEFAULT 183,
  ADD COLUMN no_pickup_run_times text[] NOT NULL DEFAULT ARRAY['08:00','14:00','20:00']::text[],
  ADD COLUMN run_timezone text NOT NULL DEFAULT 'Europe/Budapest',
  ADD COLUMN no_pickup_decrease numeric NOT NULL DEFAULT 2,
  ADD COLUMN max_daily_decrease_per_date numeric NOT NULL DEFAULT 10,
  ADD COLUMN no_pickup_scope text NOT NULL DEFAULT 'all_room_types',
  ADD COLUMN currency text NOT NULL DEFAULT 'EUR',
  ADD COLUMN last_no_pickup_slot text,
  ADD CONSTRAINT pickup_lookback_hours_range CHECK (pickup_lookback_hours BETWEEN 1 AND 168),
  ADD CONSTRAINT no_pickup_lookback_hours_range CHECK (no_pickup_lookback_hours BETWEEN 1 AND 168),
  ADD CONSTRAINT future_booking_window_days_range CHECK (future_booking_window_days BETWEEN 1 AND 730),
  ADD CONSTRAINT no_pickup_run_times_limit CHECK (cardinality(no_pickup_run_times) BETWEEN 1 AND 3),
  ADD CONSTRAINT no_pickup_decrease_range CHECK (no_pickup_decrease BETWEEN 1 AND 3),
  ADD CONSTRAINT max_daily_decrease_positive CHECK (max_daily_decrease_per_date > 0),
  ADD CONSTRAINT no_pickup_scope_valid CHECK (no_pickup_scope IN ('booked_room_type','all_room_types'));

ALTER TABLE public.revenue_pickup_automation_actions
  ALTER COLUMN reservation_id DROP NOT NULL,
  ALTER COLUMN pickup_at DROP NOT NULL,
  ADD COLUMN decision_type text NOT NULL DEFAULT 'positive_pickup',
  ADD COLUMN observation_from timestamptz,
  ADD COLUMN observation_to timestamptz,
  ADD COLUMN net_pickup integer,
  ADD COLUMN schedule_slot text,
  ADD COLUMN local_business_date date,
  ADD COLUMN cap_applied numeric,
  ADD COLUMN push_run_id uuid REFERENCES public.revenue_rate_push_runs(id) ON DELETE SET NULL,
  ADD CONSTRAINT automation_decision_type_valid CHECK (decision_type IN ('positive_pickup','no_pickup_markdown'));

CREATE UNIQUE INDEX revenue_automation_markdown_once_idx
  ON public.revenue_pickup_automation_actions (hotel_id, stay_date, obk_id, occupancy, rule_version, schedule_slot, local_business_date)
  WHERE decision_type = 'no_pickup_markdown';