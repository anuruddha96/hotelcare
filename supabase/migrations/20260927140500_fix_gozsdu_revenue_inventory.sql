-- Fix Gozsdu Court portfolio revenue metrics.
--
-- Previo exposes 82 mapped physical objects for Gozsdu, but Hotel Care's
-- housekeeping mapping currently marks only 66 as guest-operating; 13 are
-- unavailable and 3 are non-guest/internal spaces.  The portfolio comparison
-- previously trusted the raw revenue snapshots, so the blocked/internal PMS
-- objects were counted as sold room-nights and diluted ADR / distorted OCC and
-- RevPAR.
--
-- Keep the correction scoped to Gozsdu. Other hotels continue to use their
-- existing snapshot values unchanged.  For Gozsdu, derive the portfolio card
-- from booking nights attached to physical rooms whose housekeeping
-- gozsduAvailability status is `operating`, and derive inventory from that same
-- source of truth.  This intentionally does not mutate housekeeping mappings.

create or replace function public.revenue_portfolio_latest_snapshots(
  _hotel_ids text[],
  _from date,
  _to date
)
returns table(
  hotel_id text,
  stay_date date,
  rooms_sold numeric,
  rooms_available numeric,
  occupancy_pct numeric,
  adr_eur numeric,
  revenue_eur numeric
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
  ),
  gozsdu_operating as materialized (
    select distinct prm.pms_room_id
    from public.pms_room_mappings prm
    join public.pms_configurations pc on pc.id = prm.pms_config_id
    join public.rooms r
      on r.hotel = pc.hotel_id
     and r.room_number = prm.hotelcare_room_number
    where pc.hotel_id = 'gozsdu-court'
      and prm.is_active is distinct from false
      and r.pms_metadata -> 'gozsduAvailability' ->> 'status' = 'operating'
  ),
  gozsdu_inventory as materialized (
    select count(*)::numeric as rooms_available
    from public.rooms r
    where r.hotel = 'gozsdu-court'
      and r.pms_metadata -> 'gozsduAvailability' ->> 'status' = 'operating'
  )
  select
    a.hotel_id,
    s.stay_date,
    case when a.hotel_id = 'gozsdu-court' and gi.rooms_available > 0
      then coalesce(gb.rooms_sold, 0)::numeric
      else s.rooms_sold::numeric
    end as rooms_sold,
    case when a.hotel_id = 'gozsdu-court' and gi.rooms_available > 0
      then gi.rooms_available
      else s.rooms_available::numeric
    end as rooms_available,
    case when a.hotel_id = 'gozsdu-court' and gi.rooms_available > 0
      then round((coalesce(gb.rooms_sold, 0)::numeric / gi.rooms_available) * 100, 1)
      else s.occupancy_pct
    end as occupancy_pct,
    case when a.hotel_id = 'gozsdu-court' and gi.rooms_available > 0
      then case when coalesce(gb.rooms_sold, 0) > 0
        then round(coalesce(gb.revenue_eur, 0)::numeric / gb.rooms_sold, 2)
        else null
      end
      else s.adr_eur
    end as adr_eur,
    case when a.hotel_id = 'gozsdu-court' and gi.rooms_available > 0
      then round(coalesce(gb.revenue_eur, 0)::numeric, 2)
      else s.revenue_eur
    end as revenue_eur
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
  left join gozsdu_inventory gi on a.hotel_id = 'gozsdu-court'
  left join lateral (
    select
      count(*)::numeric as rooms_sold,
      sum(coalesce(b.nightly_price_eur, 0))::numeric as revenue_eur
    from public.revenue_booking_nights b
    where a.hotel_id = 'gozsdu-court'
      and b.hotel_id = a.hotel_id
      and b.stay_date = s.stay_date
      and exists (
        select 1
        from gozsdu_operating go
        where go.pms_room_id = b.obj_id
      )
  ) gb on a.hotel_id = 'gozsdu-court'
  order by a.hotel_id, s.stay_date;
$function$;
