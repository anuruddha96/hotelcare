-- Revenue integrity hardening for Previo reservation mutations and group bookings.
-- Raw PMS amounts stay in original_*; normalized revenue fields are repaired only
-- when HotelCare has a trustworthy positive total/rate. SLNT is intentionally
-- excluded from these normalizations because it uses a different base currency.

create index if not exists idx_revenue_booking_nights_hotel_res
  on public.revenue_booking_nights (hotel_id, res_id);

create index if not exists idx_reservations_previo_base_ref
  on public.reservations (hotel_id, (split_part(source_reservation_id, ':', 1)))
  where source = 'previo';

create or replace function public.preserve_previo_known_reservation_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source = 'previo'
     and old.source = 'previo'
     and new.hotel_id <> 'slnt-group'
     and new.source_reservation_id = old.source_reservation_id
     and coalesce(old.total_amount, 0) > 0
     and coalesce(new.total_amount, 0) <= 0 then
    new.total_amount := old.total_amount;
    if coalesce(old.rate_per_night, 0) > 0 then
      new.rate_per_night := old.rate_per_night;
    end if;
    if coalesce(new.balance_due, 0) <= 0 and coalesce(old.balance_due, 0) > 0 then
      new.balance_due := old.balance_due;
      new.payment_status := old.payment_status;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tr_reservations_preserve_previo_price on public.reservations;
create trigger tr_reservations_preserve_previo_price
before update on public.reservations
for each row execute function public.preserve_previo_known_reservation_price();

create or replace function public.allocate_revenue_booking_total(
  p_hotel_id text,
  p_res_id text,
  p_total numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_total is null or p_total <= 0 then
    return;
  end if;

  with ranked as (
    select
      id,
      row_number() over (order by stay_date, room_key, id) as rn,
      count(*) over () as cnt,
      round(p_total / count(*) over (), 2) as base_amount
    from public.revenue_booking_nights
    where hotel_id = p_hotel_id and res_id = p_res_id
  ), allocated as (
    select
      id,
      case
        when rn = cnt then round(p_total - (base_amount * (cnt - 1)), 2)
        else base_amount
      end as nightly_amount
    from ranked
  )
  update public.revenue_booking_nights b
  set nightly_price_eur = a.nightly_amount
  from allocated a
  where b.id = a.id;

  with segment_totals as (
    select
      room_key,
      stay_from,
      stay_to,
      round(sum(coalesce(nightly_price_eur, 0)), 2) as segment_total
    from public.revenue_booking_nights
    where hotel_id = p_hotel_id and res_id = p_res_id
    group by room_key, stay_from, stay_to
  )
  update public.revenue_booking_nights b
  set total_price_eur = s.segment_total
  from segment_totals s
  where b.hotel_id = p_hotel_id
    and b.res_id = p_res_id
    and b.room_key = s.room_key
    and b.stay_from = s.stay_from
    and b.stay_to = s.stay_to;
end;
$$;

create or replace function public.reconcile_revenue_booking_price(
  p_hotel_id text,
  p_res_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_count integer := 0;
  v_zero_count integer := 0;
  v_exact_total numeric := null;
  v_exact_rate numeric := null;
  v_exact_expected integer := null;
  v_group_total numeric := null;
  v_group_expected integer := null;
  v_raw_group_total numeric := null;
  v_room_count integer := 0;
  v_period_count integer := 0;
  v_base_currency text := 'EUR';
begin
  if p_hotel_id is null or p_res_id is null or p_hotel_id = 'slnt-group' then
    return;
  end if;

  select coalesce(base_currency, 'EUR')
    into v_base_currency
  from public.hotel_revenue_settings
  where hotel_id = p_hotel_id
  limit 1;
  v_base_currency := coalesce(v_base_currency, 'EUR');
  if upper(v_base_currency) <> 'EUR' then
    return;
  end if;

  select
    count(*),
    count(*) filter (where coalesce(nightly_price_eur, 0) <= 0),
    count(distinct room_key),
    count(distinct (coalesce(stay_from::text, '') || '|' || coalesce(stay_to::text, '')))
  into v_current_count, v_zero_count, v_room_count, v_period_count
  from public.revenue_booking_nights
  where hotel_id = p_hotel_id and res_id = p_res_id;

  if v_current_count = 0 or v_zero_count = 0 then
    return;
  end if;

  select
    total_amount,
    rate_per_night,
    greatest(1, check_out_date - check_in_date)
  into v_exact_total, v_exact_rate, v_exact_expected
  from public.reservations
  where hotel_id = p_hotel_id
    and source = 'previo'
    and source_reservation_id = p_res_id
    and coalesce(total_amount, 0) > 0
  order by updated_at desc
  limit 1;

  if coalesce(v_exact_total, 0) > 0 then
    if v_current_count = v_exact_expected then
      perform public.allocate_revenue_booking_total(p_hotel_id, p_res_id, v_exact_total);
    elsif coalesce(v_exact_rate, 0) > 0 then
      update public.revenue_booking_nights
      set nightly_price_eur = round(v_exact_rate, 2),
          total_price_eur = round(
            v_exact_rate * greatest(1, stay_to - stay_from),
            2
          )
      where hotel_id = p_hotel_id
        and res_id = p_res_id
        and coalesce(nightly_price_eur, 0) <= 0;
    end if;
    return;
  end if;

  select
    sum(case when coalesce(total_amount, 0) > 0 then total_amount else 0 end),
    sum(greatest(1, check_out_date - check_in_date))
  into v_group_total, v_group_expected
  from public.reservations
  where hotel_id = p_hotel_id
    and source = 'previo'
    and split_part(source_reservation_id, ':', 1) = p_res_id
    and source_reservation_id <> p_res_id
    and coalesce(status, 'confirmed') not in ('cancelled', 'no_show');

  if coalesce(v_group_total, 0) > 0 and v_group_expected = v_current_count then
    perform public.allocate_revenue_booking_total(p_hotel_id, p_res_id, v_group_total);
    return;
  end if;

  if v_room_count > 1 and v_period_count = 1 then
    select sum(room_total)
      into v_raw_group_total
    from (
      select room_key, max(coalesce(original_total_price, 0)) as room_total
      from public.revenue_booking_nights
      where hotel_id = p_hotel_id
        and res_id = p_res_id
        and coalesce(original_total_price, 0) > 0
      group by room_key
    ) q;

    if coalesce(v_raw_group_total, 0) > 0 then
      perform public.allocate_revenue_booking_total(p_hotel_id, p_res_id, v_raw_group_total);
    end if;
  end if;
end;
$$;

create or replace function public.revenue_booking_nights_after_insert_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  delete from public.revenue_booking_nights b
  using inserted_rows i
  where b.id = i.id
    and b.hotel_id <> 'slnt-group'
    and b.obk_id is not null
    and exists (
      select 1 from public.revenue_room_type_rates any_rate
      where any_rate.hotel_id = b.hotel_id
    )
    and not exists (
      select 1 from public.revenue_room_type_rates rr
      where rr.hotel_id = b.hotel_id and rr.obk_id = b.obk_id
    );

  for rec in
    select distinct i.hotel_id, i.res_id
    from inserted_rows i
    where i.hotel_id <> 'slnt-group'
  loop
    perform public.reconcile_revenue_booking_price(rec.hotel_id, rec.res_id);
  end loop;

  return null;
end;
$$;

drop trigger if exists tr_revenue_booking_nights_integrity on public.revenue_booking_nights;
create trigger tr_revenue_booking_nights_integrity
after insert on public.revenue_booking_nights
referencing new table as inserted_rows
for each statement execute function public.revenue_booking_nights_after_insert_integrity();

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
    )
  into v_sold, v_priced, v_revenue, v_new
  from public.revenue_booking_nights
  where hotel_id = new.hotel_id and stay_date = new.stay_date;

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

drop trigger if exists tr_revenue_snapshot_integrity on public.revenue_daily_snapshots;
create trigger tr_revenue_snapshot_integrity
before insert or update on public.revenue_daily_snapshots
for each row execute function public.revenue_snapshot_before_write_integrity();

delete from public.revenue_booking_nights b
where b.hotel_id <> 'slnt-group'
  and b.stay_date >= date_trunc('month', current_date)::date
  and b.obk_id is not null
  and exists (
    select 1 from public.revenue_room_type_rates any_rate
    where any_rate.hotel_id = b.hotel_id
  )
  and not exists (
    select 1 from public.revenue_room_type_rates rr
    where rr.hotel_id = b.hotel_id and rr.obk_id = b.obk_id
  );

do $$
declare
  rec record;
begin
  for rec in
    select distinct hotel_id, res_id
    from public.revenue_booking_nights
    where hotel_id <> 'slnt-group'
      and stay_date >= date_trunc('month', current_date)::date
      and coalesce(nightly_price_eur, 0) <= 0
  loop
    perform public.reconcile_revenue_booking_price(rec.hotel_id, rec.res_id);
  end loop;
end;
$$;
