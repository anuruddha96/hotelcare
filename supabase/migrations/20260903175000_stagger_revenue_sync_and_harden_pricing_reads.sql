-- Reduce I/O collisions between the PMS revenue sync and the pricing evaluator.
-- Job 23 is named 5min but had drifted to every 2 minutes; restore a true 5-minute
-- cadence and offset it from the pricing scheduler (:03/:13/:23/...).
select cron.alter_job(23, schedule := '1-59/5 * * * *');

-- The V2 evaluator frequently asks for recent non-hold decisions. Avoid scanning
-- thousands of hold rows during an I/O spike.
create index if not exists idx_rdd_hotel_recent_movement
  on public.revenue_date_decisions (hotel_id, created_at desc, stay_date)
  where direction <> 'hold';

-- These read-only RPCs are deliberately bounded and safe to let finish during a
-- transient storage spike instead of inheriting PostgREST's short request timeout.
alter function public.revenue_latest_snapshots(text, date, date)
  set statement_timeout = '20s';
alter function public.revenue_manual_hold_state(text, timestamptz, text[])
  set statement_timeout = '20s';
alter function public.revenue_seasonal_anchor(text, integer)
  set statement_timeout = '20s';
