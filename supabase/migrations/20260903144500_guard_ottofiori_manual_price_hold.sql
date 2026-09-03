-- Hotel Ottofiori revenue safety: a manager's manual rate correction must stay
-- authoritative for the configured protection window.
--
-- The revenue engine already records manual price pushes. This database guard
-- makes the same rule durable at the publisher boundary, so an automation,
-- event, pickup, ladder repair or stale reconciliation cannot overwrite a date
-- the manager just corrected while we stabilise Ottofiori's pricing.

create or replace function public.guard_ottofiori_manual_price_hold()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_source text;
  v_manual_at timestamptz;
  v_manual_cell_target numeric;
begin
  if new.hotel_id <> 'ottofiori' or new.push_run_id is null then
    return new;
  end if;

  select r.source
    into v_run_source
  from public.revenue_rate_push_runs r
  where r.id = new.push_run_id;

  -- The manager's own push is always allowed through.
  if coalesce(v_run_source, '') = 'manual' then
    return new;
  end if;

  -- A manual push protects the whole stay date for 24 hours. This mirrors the
  -- date-level manual hold in Engine V2 and prevents sibling occupancy cells
  -- from being raised around the manager's correction.
  select max(d.created_at)
    into v_manual_at
  from public.revenue_rate_drafts d
  join public.revenue_rate_push_runs r on r.id = d.push_run_id
  where d.hotel_id = new.hotel_id
    and d.stay_date = new.stay_date
    and r.source = 'manual'
    and d.created_at >= now() - interval '24 hours'
    and d.status not in ('failed', 'superseded');

  if v_manual_at is null then
    return new;
  end if;

  -- A reconcile is allowed only when it is retrying the exact most-recent
  -- manager target for this same price cell. That preserves recovery from a
  -- transient Previo failure without resurrecting any older automatic target.
  if coalesce(v_run_source, '') = 'reconcile' then
    select d.new_price
      into v_manual_cell_target
    from public.revenue_rate_drafts d
    join public.revenue_rate_push_runs r on r.id = d.push_run_id
    where d.hotel_id = new.hotel_id
      and d.stay_date = new.stay_date
      and coalesce(d.obk_id, '') = coalesce(new.obk_id, '')
      and d.room_type_name = new.room_type_name
      and d.occupancy = new.occupancy
      and r.source = 'manual'
      and d.created_at >= now() - interval '24 hours'
      and d.status not in ('failed', 'superseded')
    order by d.created_at desc
    limit 1;

    if v_manual_cell_target is not null
       and abs(v_manual_cell_target - new.new_price) <= 0.01 then
      return new;
    end if;
  end if;

  -- Do not throw or poison the publisher queue. Superseding at INSERT keeps an
  -- audit trail while making the row ineligible for the publisher, which only
  -- sends active draft rows.
  new.status := 'superseded';
  new.confirmation_status := 'superseded';
  new.superseded_at := now();
  new.reconcile_state := 'manual_hold_blocked';
  new.reconcile_next_at := null;
  new.push_error := 'Manager price protected for 24h: automatic/reconcile overwrite blocked.';

  return new;
end;
$$;

drop trigger if exists trg_guard_ottofiori_manual_price_hold
  on public.revenue_rate_drafts;

create trigger trg_guard_ottofiori_manual_price_hold
before insert on public.revenue_rate_drafts
for each row
execute function public.guard_ottofiori_manual_price_hold();
