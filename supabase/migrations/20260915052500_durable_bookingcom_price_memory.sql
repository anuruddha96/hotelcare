-- Make Booking.com price preservation durable across the revenue sync's
-- delete-and-reinsert cycle.
--
-- `revenue_booking_nights` is an authoritative mirror and is fully replaced for
-- the refreshed horizon. A trigger that only looks back into that mirror can
-- therefore lose its recovery source after the DELETE. Keep the last known
-- non-zero Booking.com total in a small, non-PII memory table keyed by the
-- stable reservation + room-type identity, then consult it before accepting a
-- later all-zero replacement row.

create table if not exists public.revenue_reservation_price_memory (
  hotel_id text not null,
  res_id text not null,
  obk_id text not null default '',
  source_name text,
  source_currency text,
  total_price_eur numeric,
  original_total_price numeric,
  last_obj_id text,
  last_stay_from date,
  last_stay_to date,
  last_captured_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (hotel_id, res_id, obk_id)
);

alter table public.revenue_reservation_price_memory enable row level security;

-- Seed the durable cache from every currently-known non-zero Booking.com
-- reservation. DISTINCT ON keeps the most recent snapshot per stable key.
insert into public.revenue_reservation_price_memory (
  hotel_id,
  res_id,
  obk_id,
  source_name,
  source_currency,
  total_price_eur,
  original_total_price,
  last_obj_id,
  last_stay_from,
  last_stay_to,
  last_captured_at,
  updated_at
)
select distinct on (b.hotel_id, b.res_id, coalesce(b.obk_id, ''))
  b.hotel_id,
  b.res_id,
  coalesce(b.obk_id, ''),
  b.source_name,
  b.source_currency,
  nullif(b.total_price_eur, 0),
  nullif(b.original_total_price, 0),
  b.obj_id,
  b.stay_from,
  b.stay_to,
  b.captured_at,
  now()
from public.revenue_booking_nights b
where b.source_name ilike '%Booking.com%'
  and b.res_id is not null
  and (
    coalesce(b.total_price_eur, 0) > 0
    or coalesce(b.original_total_price, 0) > 0
  )
order by
  b.hotel_id,
  b.res_id,
  coalesce(b.obk_id, ''),
  b.captured_at desc nulls last,
  b.stay_date desc
on conflict (hotel_id, res_id, obk_id) do update
set source_name = excluded.source_name,
    source_currency = coalesce(excluded.source_currency, revenue_reservation_price_memory.source_currency),
    total_price_eur = coalesce(excluded.total_price_eur, revenue_reservation_price_memory.total_price_eur),
    original_total_price = coalesce(excluded.original_total_price, revenue_reservation_price_memory.original_total_price),
    last_obj_id = excluded.last_obj_id,
    last_stay_from = excluded.last_stay_from,
    last_stay_to = excluded.last_stay_to,
    last_captured_at = excluded.last_captured_at,
    updated_at = now();

create or replace function public.preserve_known_bookingcom_price_on_zero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remembered_total_eur numeric;
  remembered_original_total numeric;
  remembered_currency text;
  stay_nights integer;
  candidate_count integer;
  incoming_is_zero boolean;
begin
  -- Leave every non-Booking.com flow untouched.
  if new.source_name is null
     or new.source_name not ilike '%Booking.com%'
     or new.res_id is null then
    return new;
  end if;

  incoming_is_zero :=
    coalesce(new.total_price_eur, 0) = 0
    and coalesce(new.nightly_price_eur, 0) = 0
    and coalesce(new.original_total_price, 0) = 0
    and coalesce(new.original_nightly_price, 0) = 0;

  if incoming_is_zero
     and new.stay_to is not null
     and new.stay_from is not null
     and new.stay_to > new.stay_from then

    -- Exact-row updates keep their already-known value.
    if tg_op = 'UPDATE'
       and coalesce(old.total_price_eur, 0) > 0
       and old.hotel_id = new.hotel_id
       and old.res_id = new.res_id
       and old.obk_id is not distinct from new.obk_id
       and (
         old.source_currency is null
         or new.source_currency is null
         or upper(old.source_currency) = upper(new.source_currency)
       ) then
      new.total_price_eur := old.total_price_eur;
      new.nightly_price_eur := old.nightly_price_eur;
      new.original_total_price := old.original_total_price;
      new.original_nightly_price := old.original_nightly_price;
    else
      -- Primary recovery path: durable memory survives the revenue mirror's
      -- full DELETE, unlike the original seven-day lookup.
      select m.total_price_eur, m.original_total_price, m.source_currency
        into remembered_total_eur, remembered_original_total, remembered_currency
      from public.revenue_reservation_price_memory m
      where m.hotel_id = new.hotel_id
        and m.res_id = new.res_id
        and m.obk_id = coalesce(new.obk_id, '')
        and (
          m.source_currency is null
          or new.source_currency is null
          or upper(m.source_currency) = upper(new.source_currency)
        )
        and (
          coalesce(m.total_price_eur, 0) > 0
          or coalesce(m.original_total_price, 0) > 0
        )
      limit 1;

      -- If Previo also changed the room type, recover only when this
      -- reservation has exactly ONE compatible remembered price. This keeps
      -- multi-room reservations safe from cross-room price copying.
      if coalesce(remembered_total_eur, 0) = 0
         and coalesce(remembered_original_total, 0) = 0 then
        select count(*)
          into candidate_count
        from public.revenue_reservation_price_memory m
        where m.hotel_id = new.hotel_id
          and m.res_id = new.res_id
          and (
            m.source_currency is null
            or new.source_currency is null
            or upper(m.source_currency) = upper(new.source_currency)
          )
          and (
            coalesce(m.total_price_eur, 0) > 0
            or coalesce(m.original_total_price, 0) > 0
          );

        if candidate_count = 1 then
          select m.total_price_eur, m.original_total_price, m.source_currency
            into remembered_total_eur, remembered_original_total, remembered_currency
          from public.revenue_reservation_price_memory m
          where m.hotel_id = new.hotel_id
            and m.res_id = new.res_id
            and (
              m.source_currency is null
              or new.source_currency is null
              or upper(m.source_currency) = upper(new.source_currency)
            )
            and (
              coalesce(m.total_price_eur, 0) > 0
              or coalesce(m.original_total_price, 0) > 0
            )
          limit 1;
        end if;
      end if;

      if coalesce(remembered_total_eur, 0) > 0
         or coalesce(remembered_original_total, 0) > 0 then
        stay_nights := greatest(1, new.stay_to - new.stay_from);

        if coalesce(remembered_total_eur, 0) > 0 then
          new.total_price_eur := remembered_total_eur;
          new.nightly_price_eur := round(remembered_total_eur / stay_nights, 2);
        end if;

        if coalesce(remembered_original_total, 0) > 0 then
          new.original_total_price := remembered_original_total;
          new.original_nightly_price := round(remembered_original_total / stay_nights, 2);
        end if;

        if new.source_currency is null and remembered_currency is not null then
          new.source_currency := remembered_currency;
        end if;
      end if;
    end if;
  end if;

  -- Every valid Booking.com price refreshes the durable memory. This runs
  -- before the mirror row is inserted, so the next sync may safely delete the
  -- mirror without deleting the recovery source.
  if coalesce(new.total_price_eur, 0) > 0
     or coalesce(new.original_total_price, 0) > 0 then
    insert into public.revenue_reservation_price_memory (
      hotel_id,
      res_id,
      obk_id,
      source_name,
      source_currency,
      total_price_eur,
      original_total_price,
      last_obj_id,
      last_stay_from,
      last_stay_to,
      last_captured_at,
      updated_at
    ) values (
      new.hotel_id,
      new.res_id,
      coalesce(new.obk_id, ''),
      new.source_name,
      new.source_currency,
      nullif(new.total_price_eur, 0),
      nullif(new.original_total_price, 0),
      new.obj_id,
      new.stay_from,
      new.stay_to,
      new.captured_at,
      now()
    )
    on conflict (hotel_id, res_id, obk_id) do update
    set source_name = excluded.source_name,
        source_currency = coalesce(excluded.source_currency, revenue_reservation_price_memory.source_currency),
        total_price_eur = coalesce(excluded.total_price_eur, revenue_reservation_price_memory.total_price_eur),
        original_total_price = coalesce(excluded.original_total_price, revenue_reservation_price_memory.original_total_price),
        last_obj_id = excluded.last_obj_id,
        last_stay_from = excluded.last_stay_from,
        last_stay_to = excluded.last_stay_to,
        last_captured_at = excluded.last_captured_at,
        updated_at = now();
  end if;

  return new;
end;
$$;

-- Recreate the trigger so this migration is self-contained even on a database
-- restored from a point before the first guard was introduced.
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