-- Same-day sell-out automation: current stay date only, every 30 minutes until 15:00 local time.
-- The dedicated Edge Function is deliberately separate from the normal hourly
-- revenue engine so tomorrow/future dates keep their existing cadence.

alter table public.revenue_pickup_automation_rules
  add column if not exists same_day_sellout_enabled boolean not null default false,
  add column if not exists same_day_check_interval_minutes integer not null default 30,
  add column if not exists same_day_cutoff_local time without time zone not null default '15:00',
  add column if not exists same_day_min_rate_eur numeric(10,2) not null default 100,
  add column if not exists same_day_last_checked_at timestamptz,
  add column if not exists same_day_last_status text,
  add column if not exists same_day_last_error text,
  add column if not exists same_day_handover_date date,
  add column if not exists same_day_floor_alerted_at timestamptz;

alter table public.revenue_pickup_automation_rules
  drop constraint if exists revenue_pickup_automation_rules_same_day_interval_check;
alter table public.revenue_pickup_automation_rules
  add constraint revenue_pickup_automation_rules_same_day_interval_check
  check (same_day_check_interval_minutes between 15 and 120);

alter table public.revenue_pickup_automation_rules
  drop constraint if exists revenue_pickup_automation_rules_same_day_min_rate_check;
alter table public.revenue_pickup_automation_rules
  add constraint revenue_pickup_automation_rules_same_day_min_rate_check
  check (same_day_min_rate_eur >= 1);

-- Enable the agreed policy for Hotel Ottofiori only. Other hotels remain off
-- until a manager deliberately enables the setting.
update public.revenue_pickup_automation_rules
set same_day_sellout_enabled = true,
    same_day_check_interval_minutes = 30,
    same_day_cutoff_local = '15:00',
    same_day_min_rate_eur = 100
where hotel_id = 'ottofiori';

-- Wake the dedicated current-day checker twice per hour. The function itself
-- is idempotent and refuses to run again before the per-hotel 30-minute interval.
do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'revenue-same-day-sellout-30min';
exception when others then
  null;
end $$;

select cron.schedule(
  'revenue-same-day-sellout-30min',
  '*/30 * * * *',
  $cron$
    select net.http_post(
      url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/revenue-same-day-sellout',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjbXN6cXFrbGtvbHZ2bGFib2hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4NjgxMDEsImV4cCI6MjA2OTQ0NDEwMX0.1PrIMW4wOXdmDNW6SrlBJa68H0k20n68hHy9PYOEvVo"}'::jsonb,
      body := jsonb_build_object('scheduled', true, 'triggered_at', now())
    );
  $cron$
);
