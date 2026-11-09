-- Durable room/date/occupancy protections for human-approved HotelCare rates.
-- Migration is intentionally staged on a PR, not executed against production.
-- Strictly human-authored (not AI-authored) confirmed rates are locked until the
-- next confirmed human edit of the same cell. PMS / external manual edits are
-- not automatically classified as HotelCare staff-authored overrides.

create table if not exists public.revenue_manual_rate_overrides (
  hotel_id text not null,
  stay_date date not null,
  obk_id text not null,
  occupancy integer not null check (occupancy between 1 and 30),
  price numeric not null check (price > 0),
  authored_at timestamptz not null,
  confirmed_at timestamptz not null default now(),
  created_by uuid null,
  primary key (hotel_id, stay_date, obk_id, occupancy)
);

create index if not exists idx_manual_rate_overrides_hotel_window
  on public.revenue_manual_rate_overrides (hotel_id, stay_date);

alter table public.revenue_manual_rate_overrides enable row level security;
revoke all on public.revenue_manual_rate_overrides from public, anon, authenticated;
-- Service-role access remains available for authenticated edge workers.

-- Preserve the most recent human intent per cell. Do not mistake the Ottofiori
-- AI supervisor's internally labeled 'manual' decisions for a human action.
insert into public.revenue_manual_rate_overrides
  (hotel_id, stay_date, obk_id, occupancy, price, authored_at, confirmed_at, created_by)
select distinct on (d.hotel_id, d.stay_date, d.obk_id, d.occupancy)
  d.hotel_id, d.stay_date, d.obk_id, d.occupancy,
  coalesce(d.actual_previo_price, d.new_price), d.created_at,
  coalesce(d.confirmed_at, d.updated_at, now()), d.created_by
from public.revenue_rate_drafts d
join public.revenue_rate_push_runs r on r.id = d.push_run_id
where d.stay_date >= (now() at time zone 'Europe/Budapest')::date
  and d.obk_id is not null
  and d.status = 'pushed'
  and d.confirmation_status = 'confirmed'
  and d.intent_source in ('manual', 'manual_bulk', 'manual_pickup_board', 'manual_ladder_completion')
  and r.source in ('manual', 'bulk', 'pickup-board')
  and coalesce(d.decision_reason, '') !~ '^ai_'
order by d.hotel_id, d.stay_date, d.obk_id, d.occupancy, d.created_at desc
on conflict (hotel_id, stay_date, obk_id, occupancy) do update set
  price = excluded.price,
  authored_at = excluded.authored_at,
  confirmed_at = excluded.confirmed_at,
  created_by = excluded.created_by
where excluded.authored_at >= public.revenue_manual_rate_overrides.authored_at;

create or replace function public.record_confirmed_staff_rate_override()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_source text;
begin
  if new.status <> 'pushed'
     or new.confirmation_status <> 'confirmed'
     or new.obk_id is null
     or new.intent_source not in ('manual', 'manual_bulk', 'manual_pickup_board', 'manual_ladder_completion')
     or coalesce(new.decision_reason, '') ~ '^ai_' then
    return new;
  end if;

  select r.source into v_source
    from public.revenue_rate_push_runs r where r.id = new.push_run_id;
  if coalesce(v_source, '') not in ('manual', 'bulk', 'pickup-board') then
    return new;
  end if;

  insert into public.revenue_manual_rate_overrides
    (hotel_id, stay_date, obk_id, occupancy, price, authored_at, confirmed_at, created_by)
  values
    (new.hotel_id, new.stay_date, new.obk_id, new.occupancy,
     coalesce(new.actual_previo_price, new.new_price), new.created_at,
     coalesce(new.confirmed_at, now()), new.created_by)
  on conflict (hotel_id, stay_date, obk_id, occupancy) do update
    set price = excluded.price,
        authored_at = excluded.authored_at,
        confirmed_at = excluded.confirmed_at,
        created_by = excluded.created_by
    where excluded.authored_at >= public.revenue_manual_rate_overrides.authored_at;

  return new;
end;
$fn$;

drop trigger if exists trg_record_confirmed_staff_rate_override on public.revenue_rate_drafts;
create trigger trg_record_confirmed_staff_rate_override
after insert or update of status, confirmation_status, actual_previo_price
on public.revenue_rate_drafts
for each row
execute function public.record_confirmed_staff_rate_override();

-- Enqueue-time stop for any automatic rate write aimed at a confirmed manager
-- cell. Recovery of the exact same price is permitted. Manager edits are
-- permitted; once confirmed they replace the older protected value.
create or replace function public.prevent_automated_staff_rate_overwrite()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_manager_price numeric;
begin
  if new.obk_id is null
     or new.stay_date < (now() at time zone 'Europe/Budapest')::date
     or new.intent_source in ('manual', 'manual_bulk', 'manual_pickup_board', 'manual_ladder_completion')
        and coalesce(new.decision_reason, '') !~ '^ai_' then
    return new;
  end if;

  select price into v_manager_price
    from public.revenue_manual_rate_overrides
   where hotel_id = new.hotel_id
     and stay_date = new.stay_date
     and obk_id = new.obk_id
     and occupancy = new.occupancy;

  if v_manager_price is null or abs(v_manager_price - new.new_price) < 0.01 then
    return new;
  end if;

  new.status := 'superseded';
  new.confirmation_status := 'superseded';
  new.superseded_at := now();
  new.reconcile_state := 'manual_price_protected';
  new.reconcile_next_at := null;
  new.push_error := 'Permanent manager rate protection: automatic overwrite blocked.';
  return new;
end;
$fn$;

drop trigger if exists trg_prevent_automated_staff_rate_overwrite on public.revenue_rate_drafts;
create trigger trg_prevent_automated_staff_rate_overwrite
before insert or update of new_price, intent_source
on public.revenue_rate_drafts
for each row
execute function public.prevent_automated_staff_rate_overwrite();

revoke all on function public.record_confirmed_staff_rate_override() from public, anon, authenticated;
revoke all on function public.prevent_automated_staff_rate_overwrite() from public, anon, authenticated;
