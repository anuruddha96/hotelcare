-- Smart minimum-stay automation for Hotel Ottofiori.
--
-- Minimum stay is a yield restriction, not a permanent weekend rule. The
-- automation keeps low-demand months and the final selling week open to
-- one-night guests, while retaining a two-night minimum only on genuinely
-- compressed weekends / high-impact events.

alter table public.revenue_pickup_automation_rules
  add column if not exists min_stay_automation_enabled boolean not null default false,
  add column if not exists min_stay_automation_horizon_days integer not null default 90,
  add column if not exists min_stay_max_nights integer not null default 2,
  add column if not exists min_stay_change_cooldown_hours integer not null default 12;

update public.revenue_pickup_automation_rules
set min_stay_automation_enabled = true,
    min_stay_automation_horizon_days = 90,
    min_stay_max_nights = 2,
    min_stay_change_cooldown_hours = 12
where hotel_id = 'ottofiori';

create table if not exists public.revenue_min_stay_automation_runs (
  id uuid primary key default gen_random_uuid(),
  hotel_id text not null,
  organization_slug text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'in_progress',
  dates_evaluated integer not null default 0,
  changes_attempted integer not null default 0,
  changes_applied integer not null default 0,
  changes_failed integer not null default 0,
  summary jsonb not null default '{}'::jsonb
);

create index if not exists idx_revenue_min_stay_runs_hotel_started
  on public.revenue_min_stay_automation_runs(hotel_id, started_at desc);

create table if not exists public.revenue_min_stay_decisions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.revenue_min_stay_automation_runs(id) on delete cascade,
  hotel_id text not null,
  organization_slug text,
  stay_date date not null,
  days_out integer not null,
  current_min_stay integer,
  target_min_stay integer not null,
  occupancy_pct numeric,
  rooms_left integer,
  pickup_24h integer not null default 0,
  month_occupancy_pct numeric,
  event_impact text,
  event_title text,
  reason text not null,
  status text not null default 'held',
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_revenue_min_stay_decisions_hotel_date
  on public.revenue_min_stay_decisions(hotel_id, stay_date, created_at desc);

alter table public.revenue_min_stay_automation_runs enable row level security;
alter table public.revenue_min_stay_decisions enable row level security;

-- Reuse an already-authorized pg_net header set instead of storing a new key in
-- source control. On a fresh project this block simply waits until the standard
-- competitor scan cron exists.
do $$
declare
  v_command text;
begin
  if not exists (
    select 1 from cron.job where jobname = 'revenue-minstay-automation-hourly'
  ) then
    select regexp_replace(
             replace(command, '/competitor-rate-scan', '/revenue-minstay-automation'),
             'body:=''[^'']*''::jsonb',
             'body:=''{"scheduled":true,"trigger":"cron"}''::jsonb'
           )
      into v_command
      from cron.job
     where jobname = 'competitor-rate-scan-daily'
     limit 1;

    if v_command is not null then
      perform cron.schedule(
        'revenue-minstay-automation-hourly',
        '37 * * * *',
        v_command
      );
    end if;
  end if;
end $$;
