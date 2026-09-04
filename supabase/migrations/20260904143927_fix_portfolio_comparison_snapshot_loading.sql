-- Comparison cards previously sorted every historical capture in the requested
-- horizon. Four hotels / 193 nights read over 500,000 rows before returning 772.
-- Fetch one indexed row per hotel/night, keeping the RPC contract and access
-- checks intact. captured_at is NOT NULL, so DESC uses the existing lookup index.
create or replace function public.revenue_portfolio_latest_snapshots(
  _hotel_ids text[], _from date, _to date
)
returns table (
  hotel_id text, stay_date date, rooms_sold numeric, rooms_available numeric,
  occupancy_pct numeric, adr_eur numeric, revenue_eur numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with allowed as materialized (
    select distinct h as hotel_id
    from unnest(_hotel_ids) as h
    where auth.uid() is not null
      and public.user_can_access_hotel(auth.uid(), h)
  )
  select a.hotel_id, s.stay_date, s.rooms_sold::numeric, s.rooms_available::numeric,
         s.occupancy_pct, s.adr_eur, s.revenue_eur
  from allowed a
  cross join generate_series(0, _to - _from) as g(day_offset)
  cross join lateral (
    select d.stay_date, d.rooms_sold, d.rooms_available,
           d.occupancy_pct, d.adr_eur, d.revenue_eur
    from public.revenue_daily_snapshots d
    where d.hotel_id = a.hotel_id
      and d.stay_date = _from + g.day_offset
    order by d.captured_at desc
    limit 1
  ) s
  order by a.hotel_id, s.stay_date;
$function$;

-- The existing privileged RPC must only be callable by signed-in app users.
revoke execute on function public.revenue_portfolio_latest_snapshots(text[], date, date) from public, anon;
grant execute on function public.revenue_portfolio_latest_snapshots(text[], date, date) to authenticated;
