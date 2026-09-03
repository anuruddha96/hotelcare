-- Fix the Revenue Engine V2 occupancy snapshot read that could time out under
-- the :00/:10/:20/:30 cron load spike. The previous implementation windowed
-- hundreds of thousands of historical snapshot rows for Ottofiori on every run.
--
-- Keep the same RPC contract, but fetch only the newest two indexed rows for
-- each stay date. Also offset the 10-minute automation wake-up by three minutes
-- so it no longer collides with the heaviest exact-minute jobs.

create or replace function public.revenue_latest_snapshots(
  p_hotel_id text,
  p_from date,
  p_to date
)
returns table(
  stay_date date,
  occupancy_pct numeric,
  rooms_sold integer,
  rooms_available integer,
  revenue_eur numeric,
  adr_eur numeric,
  captured_date date,
  rn integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with allowed as (
    select 1
    where auth.role() = 'service_role'
       or (
         auth.uid() is not null
         and public.user_can_access_hotel(auth.uid(), p_hotel_id)
       )
  )
  select q.stay_date,
         q.occupancy_pct,
         q.rooms_sold,
         q.rooms_available,
         q.revenue_eur,
         q.adr_eur,
         q.captured_date,
         q.rn
  from allowed
  cross join generate_series(p_from, p_to, interval '1 day') as g(stay_ts)
  cross join lateral (
    select x.stay_date,
           x.occupancy_pct,
           x.rooms_sold,
           x.rooms_available,
           x.revenue_eur,
           x.adr_eur,
           x.captured_date,
           row_number() over (order by x.captured_at desc)::int as rn
    from (
      select d.stay_date,
             d.occupancy_pct,
             d.rooms_sold,
             d.rooms_available,
             d.revenue_eur,
             d.adr_eur,
             d.captured_date,
             d.captured_at
      from public.revenue_daily_snapshots d
      where d.hotel_id = p_hotel_id
        and d.stay_date = g.stay_ts::date
      order by d.captured_at desc
      limit 2
    ) x
  ) q;
$function$;

select cron.alter_job(
  15,
  schedule := '3-59/10 * * * *'
);
