-- Restore Ottofiori's documented whole-column absolute safety band.
-- Scoped to Hotel Ottofiori / rdhotels only. Existing prices are not rewritten;
-- future engine and AI moves are constrained to EUR 80..500.

update public.hotel_revenue_settings
set floor_price_eur = 80,
    updated_at = now()
where hotel_id = 'ottofiori'
  and organization_slug = 'rdhotels';

update public.revenue_price_floors
set max_price = least(coalesce(max_price, 500), 500),
    min_price = case
      when is_global_safety_max then greatest(coalesce(min_price, 0), 80)
      else min_price
    end,
    notes = case
      when is_global_safety_max
        then 'Ottofiori absolute lockstep safety floor EUR 80; ceiling EUR 500.'
      else notes
    end,
    updated_at = now()
where hotel_id = 'ottofiori'
  and organization_slug = 'rdhotels';

do $$
declare
  v_floor numeric;
  v_ceiling numeric;
begin
  select max(min_price), min(max_price)
    into v_floor, v_ceiling
  from public.revenue_price_floors
  where hotel_id = 'ottofiori'
    and organization_slug = 'rdhotels'
    and is_global_safety_max = true;

  if v_floor is null or v_floor < 80 then
    raise exception 'Ottofiori global lockstep floor was not restored to EUR 80';
  end if;
  if v_ceiling is null or v_ceiling > 500 then
    raise exception 'Ottofiori global lockstep ceiling was not restored to EUR 500';
  end if;
end $$;
