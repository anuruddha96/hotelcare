-- Previo can rebuild the remaining portion of an in-house reservation as a
-- fresh zero-price segment. That segment is a continuation/modification, not a
-- new sale, so it must inherit the original reservation creation timestamp when
-- the end date is unchanged.

create or replace function public.normalize_previo_continuation_created_at(
  p_hotel_id text,
  p_res_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_positive_from date;
  v_positive_to date;
  v_zero_from date;
  v_zero_to date;
  v_original_created timestamptz;
begin
  if p_hotel_id is null or p_res_id is null or p_hotel_id = 'slnt-group' then
    return;
  end if;

  -- Restrict this rule to single/master Previo reservations. Multi-room group
  -- items can be genuinely added later and should keep their own pickup time.
  if not exists (
    select 1
    from public.reservations r
    where r.hotel_id = p_hotel_id
      and r.source = 'previo'
      and r.source_reservation_id = p_res_id
  ) then
    return;
  end if;

  select
    min(stay_from) filter (where coalesce(original_total_price, 0) > 0),
    max(stay_to) filter (where coalesce(original_total_price, 0) > 0),
    min(stay_from) filter (where coalesce(original_total_price, 0) <= 0),
    max(stay_to) filter (where coalesce(original_total_price, 0) <= 0),
    min(created_at_pms) filter (where coalesce(original_total_price, 0) > 0)
  into
    v_positive_from,
    v_positive_to,
    v_zero_from,
    v_zero_to,
    v_original_created
  from public.revenue_booking_nights
  where hotel_id = p_hotel_id and res_id = p_res_id;

  if v_original_created is null
     or v_positive_from is null
     or v_positive_to is null
     or v_zero_from is null
     or v_zero_to is null then
    return;
  end if;

  -- Same departure + later start means Previo split the already-existing stay
  -- into a remaining segment (room move / in-stay continuation). An extension
  -- has a later departure and intentionally does not match this rule.
  if v_zero_to = v_positive_to and v_zero_from > v_positive_from then
    update public.revenue_booking_nights
    set created_at_pms = v_original_created
    where hotel_id = p_hotel_id
      and res_id = p_res_id
      and coalesce(original_total_price, 0) <= 0
      and (created_at_pms is null or created_at_pms > v_original_created);
  end if;
end;
$$;

create or replace function public.revenue_booking_nights_after_insert_continuation_time()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  for rec in
    select distinct i.hotel_id, i.res_id
    from inserted_rows i
    where i.hotel_id <> 'slnt-group'
  loop
    perform public.normalize_previo_continuation_created_at(rec.hotel_id, rec.res_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists tr_revenue_booking_nights_normalize_continuations on public.revenue_booking_nights;
create trigger tr_revenue_booking_nights_normalize_continuations
after insert on public.revenue_booking_nights
referencing new table as inserted_rows
for each statement execute function public.revenue_booking_nights_after_insert_continuation_time();

-- Repair already-captured current/future continuations.
do $$
declare
  rec record;
begin
  for rec in
    select distinct hotel_id, res_id
    from public.revenue_booking_nights
    where hotel_id <> 'slnt-group'
      and stay_date >= date_trunc('month', current_date)::date
      and coalesce(original_total_price, 0) <= 0
  loop
    perform public.normalize_previo_continuation_created_at(rec.hotel_id, rec.res_id);
  end loop;
end;
$$;
