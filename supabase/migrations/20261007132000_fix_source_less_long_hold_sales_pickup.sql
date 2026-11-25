-- Keep source-less multi-year Previo inventory holds out of "bookings created"
-- KPIs. These records remain in revenue_booking_nights and continue to affect
-- on-the-books inventory/revenue exactly as before; only sale/pickup creation
-- counts are suppressed.
--
-- The frontend and previo-revenue-sync use the same rule: a source/channel
-- always counts, and source-less stays up to a full leap year (366 nights)
-- remain normal sales.

create or replace function public.revenue_snapshot_before_write_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sold integer := 0;
  v_priced integer := 0;
  v_revenue numeric := 0;
  v_new integer := 0;
begin
  if new.hotel_id = 'slnt-group' then
    return new;
  end if;

  select
    count(*),
    count(*) filter (where coalesce(nightly_price_eur, 0) > 0),
    coalesce(sum(coalesce(nightly_price_eur, 0)), 0),
    count(*) filter (
      where coalesce(nightly_price_eur, 0) > 0
        and created_at_pms is not null
        and (created_at_pms at time zone 'Europe/Budapest')::date = new.captured_date
        and not (
          coalesce(trim(source_name), '') = ''
          and stay_from is not null
          and stay_to is not null
          and (stay_to - stay_from) > 366
        )
    )
  into v_sold, v_priced, v_revenue, v_new
  from public.revenue_booking_nights
  where hotel_id = new.hotel_id
    and stay_date = new.stay_date;

  new.rooms_sold := v_sold;
  new.revenue_eur := round(v_revenue, 2);
  new.adr_eur := case when v_priced > 0 then round(v_revenue / v_priced, 2) else null end;
  new.new_bookings := v_new;
  if coalesce(new.rooms_available, 0) > 0 then
    new.occupancy_pct := round((v_sold::numeric / new.rooms_available) * 100, 1);
  else
    new.occupancy_pct := 0;
  end if;

  return new;
end;
$$;
