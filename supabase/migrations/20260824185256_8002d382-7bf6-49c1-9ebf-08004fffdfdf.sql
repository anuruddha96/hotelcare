create or replace function public.revenue_portfolio_latest_snapshots(
  _hotel_ids text[], _from date, _to date
) returns table (
  hotel_id text, stay_date date, rooms_sold numeric, rooms_available numeric,
  occupancy_pct numeric, adr_eur numeric, revenue_eur numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (s.hotel_id, s.stay_date)
    s.hotel_id, s.stay_date, s.rooms_sold, s.rooms_available,
    s.occupancy_pct, s.adr_eur, s.revenue_eur
  from public.revenue_daily_snapshots s
  where s.hotel_id = any(_hotel_ids)
    and s.stay_date between _from and _to
    and public.user_can_access_hotel(auth.uid(), s.hotel_id)
  order by s.hotel_id, s.stay_date, s.captured_date desc, s.captured_at desc nulls last
$$;

revoke all on function public.revenue_portfolio_latest_snapshots(text[], date, date) from public;
grant execute on function public.revenue_portfolio_latest_snapshots(text[], date, date) to authenticated;