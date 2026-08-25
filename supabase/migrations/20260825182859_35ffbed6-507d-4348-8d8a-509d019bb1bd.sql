CREATE OR REPLACE FUNCTION public.revenue_portfolio_latest_snapshots(_hotel_ids text[], _from date, _to date)
 RETURNS TABLE(hotel_id text, stay_date date, rooms_sold numeric, rooms_available numeric, occupancy_pct numeric, adr_eur numeric, revenue_eur numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with allowed as (
    select h as hotel_id
    from unnest(_hotel_ids) as h
    where public.user_can_access_hotel(auth.uid(), h)
  )
  select distinct on (s.hotel_id, s.stay_date)
    s.hotel_id, s.stay_date, s.rooms_sold, s.rooms_available,
    s.occupancy_pct, s.adr_eur, s.revenue_eur
  from public.revenue_daily_snapshots s
  join allowed a on a.hotel_id = s.hotel_id
  where s.stay_date between _from and _to
  order by s.hotel_id, s.stay_date, s.captured_at desc nulls last
$function$;