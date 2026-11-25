-- Prevent a modified Booking.com reservation from losing a previously-known
-- non-zero price when Previo sends a replacement booking object with <price>0</price>.
--
-- The guard is intentionally narrow:
--   * Booking.com source only
--   * same hotel + res_id + obk_id + currency
--   * current incoming monetary fields are all zero/null
--   * a newly-created replacement object may only inherit from a non-zero
--     snapshot captured within the previous 7 days
--   * once a row has a preserved non-zero value, a later zero-only upsert keeps it

create or replace function public.preserve_known_bookingcom_price_on_zero()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  prior_total_eur numeric;
  prior_original_total numeric;
  stay_nights integer;
begin
  if coalesce(new.total_price_eur, 0) = 0
     and coalesce(new.nightly_price_eur, 0) = 0
     and coalesce(new.original_total_price, 0) = 0
     and coalesce(new.original_nightly_price, 0) = 0
     and new.source_name ilike '%Booking.com%'
     and new.res_id is not null
     and new.stay_to is not null
     and new.stay_from is not null
     and new.stay_to > new.stay_from then

    -- For an existing row, keep the last valid value on that exact row.
    if tg_op = 'UPDATE'
       and coalesce(old.total_price_eur, 0) > 0
       and old.hotel_id = new.hotel_id
       and old.res_id = new.res_id
       and old.obk_id is not distinct from new.obk_id
       and old.source_currency is not distinct from new.source_currency then
      new.total_price_eur := old.total_price_eur;
      new.nightly_price_eur := old.nightly_price_eur;
      new.original_total_price := old.original_total_price;
      new.original_nightly_price := old.original_nightly_price;
      return new;
    end if;

    -- For a replacement object, recover only from a recent non-zero snapshot of
    -- the same Booking.com reservation/booking key. The obj_id difference is an
    -- important safety check: this is a modification carry-forward, not a rule
    -- that converts genuinely free bookings into paid bookings.
    select p.total_price_eur, p.original_total_price
      into prior_total_eur, prior_original_total
    from public.revenue_booking_nights p
    where p.hotel_id = new.hotel_id
      and p.res_id = new.res_id
      and p.obk_id is not distinct from new.obk_id
      and p.id is distinct from new.id
      and p.obj_id is distinct from new.obj_id
      and p.source_name ilike '%Booking.com%'
      and p.source_currency is not distinct from new.source_currency
      and coalesce(p.total_price_eur, 0) > 0
      and p.captured_at >= now() - interval '7 days'
    order by p.captured_at desc nulls last, p.stay_date desc
    limit 1;

    if coalesce(prior_total_eur, 0) > 0 then
      stay_nights := greatest(1, new.stay_to - new.stay_from);
      new.total_price_eur := prior_total_eur;
      new.nightly_price_eur := round(prior_total_eur / stay_nights, 2);

      if coalesce(prior_original_total, 0) > 0 then
        new.original_total_price := prior_original_total;
        new.original_nightly_price := round(prior_original_total / stay_nights, 2);
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_preserve_known_bookingcom_price_on_zero
  on public.revenue_booking_nights;

create trigger trg_preserve_known_bookingcom_price_on_zero
before insert or update of total_price_eur,
                           nightly_price_eur,
                           original_total_price,
                           original_nightly_price
on public.revenue_booking_nights
for each row
execute function public.preserve_known_bookingcom_price_on_zero();

-- Repair any currently affected rows using the same narrow recovery rule.
with repair_targets as (
  select z.id,
         p.total_price_eur as prior_total_eur,
         p.original_total_price as prior_original_total,
         greatest(1, z.stay_to - z.stay_from) as stay_nights
  from public.revenue_booking_nights z
  join lateral (
    select p.total_price_eur, p.original_total_price
    from public.revenue_booking_nights p
    where p.hotel_id = z.hotel_id
      and p.res_id = z.res_id
      and p.obk_id is not distinct from z.obk_id
      and p.id <> z.id
      and p.obj_id is distinct from z.obj_id
      and p.source_name ilike '%Booking.com%'
      and p.source_currency is not distinct from z.source_currency
      and coalesce(p.total_price_eur, 0) > 0
      and p.captured_at >= now() - interval '7 days'
    order by p.captured_at desc nulls last, p.stay_date desc
    limit 1
  ) p on true
  where coalesce(z.total_price_eur, 0) = 0
    and coalesce(z.nightly_price_eur, 0) = 0
    and coalesce(z.original_total_price, 0) = 0
    and coalesce(z.original_nightly_price, 0) = 0
    and z.source_name ilike '%Booking.com%'
    and z.captured_at >= now() - interval '7 days'
    and z.stay_to > z.stay_from
)
update public.revenue_booking_nights b
set total_price_eur = r.prior_total_eur,
    nightly_price_eur = round(r.prior_total_eur / r.stay_nights, 2),
    original_total_price = case
      when coalesce(r.prior_original_total, 0) > 0 then r.prior_original_total
      else b.original_total_price
    end,
    original_nightly_price = case
      when coalesce(r.prior_original_total, 0) > 0 then round(r.prior_original_total / r.stay_nights, 2)
      else b.original_nightly_price
    end
from repair_targets r
where b.id = r.id;
