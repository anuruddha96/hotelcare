CREATE TABLE public.revenue_automation_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text,
  notification_type text NOT NULL DEFAULT 'pickup_automation',
  run_source text NOT NULL DEFAULT 'automatic',
  actor_name text NOT NULL DEFAULT 'Automatic pricing',
  actor_user_id uuid,
  rule_id uuid,
  push_run_id uuid,
  action_ids uuid[] NOT NULL DEFAULT '{}',
  pickups_count integer NOT NULL DEFAULT 0,
  actions_count integer NOT NULL DEFAULT 0,
  pushed_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  currency text,
  severity text NOT NULL DEFAULT 'info',
  summary text,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.revenue_automation_notifications TO authenticated;
GRANT ALL ON public.revenue_automation_notifications TO service_role;

ALTER TABLE public.revenue_automation_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Revenue users read notifications for their hotels"
ON public.revenue_automation_notifications
FOR SELECT
TO authenticated
USING (
  public.is_revenue_user(auth.uid())
  AND public.user_can_access_hotel(auth.uid(), hotel_id)
);

CREATE INDEX idx_rev_auto_notif_hotel_created
  ON public.revenue_automation_notifications (hotel_id, created_at DESC);

CREATE TRIGGER trg_rev_auto_notif_updated_at
BEFORE UPDATE ON public.revenue_automation_notifications
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.revenue_notification_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.revenue_automation_notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  seen_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, user_id)
);

GRANT SELECT, INSERT, UPDATE ON public.revenue_notification_reads TO authenticated;
GRANT ALL ON public.revenue_notification_reads TO service_role;

ALTER TABLE public.revenue_notification_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own notification state"
ON public.revenue_notification_reads
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users create own notification state"
ON public.revenue_notification_reads
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own notification state"
ON public.revenue_notification_reads
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_rev_notif_reads_user ON public.revenue_notification_reads (user_id, notification_id);

CREATE TRIGGER trg_rev_notif_reads_updated_at
BEFORE UPDATE ON public.revenue_notification_reads
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.revenue_automation_notifications REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.revenue_automation_notifications;