-- Regression: Ottofiori's active whole-column boundary remains EUR 80..500.
do $$
declare
  v_hotel_floor numeric;
  v_global_floor numeric;
  v_global_ceiling numeric;
begin
  select floor_price_eur into v_hotel_floor
  from public.hotel_revenue_settings
  where hotel_id = 'ottofiori' and organization_slug = 'rdhotels';

  select max(min_price), min(max_price)
    into v_global_floor, v_global_ceiling
  from public.revenue_price_floors
  where hotel_id = 'ottofiori'
    and organization_slug = 'rdhotels'
    and is_global_safety_max = true;

  if v_hotel_floor <> 80 or v_global_floor < 80 or v_global_ceiling > 500 then
    raise exception 'Ottofiori absolute price-band regression: hotel %, global floor %, global ceiling %',
      v_hotel_floor, v_global_floor, v_global_ceiling;
  end if;

  if exists (
    select 1 from public.revenue_price_floors
    where hotel_id <> 'ottofiori'
      and organization_slug = 'rdhotels'
      and updated_at >= now() - interval '5 minutes'
  ) then
    raise exception 'Regression setup unexpectedly touched another hotel';
  end if;
end $$;
