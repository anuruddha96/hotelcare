alter table public.next_day_housekeeping_plans
  add column if not exists release_adjustment_notified_at timestamptz,
  add column if not exists release_adjustment_notification_error text;