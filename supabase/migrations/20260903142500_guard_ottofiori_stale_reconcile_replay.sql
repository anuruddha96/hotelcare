-- Hotel Ottofiori revenue safety: a reconciliation retry must never resurrect
-- an old price after a newer manual/automation decision has already replaced it.
--
-- Incident: an Aug-19 automatic target for Sep-18/Sep-19 was re-delivered on
-- Sep-02 even though newer confirmed markdowns existed. The reconciliation
-- worker only needs to retry the newest, recent commercial intent; anything
-- older is stale and Previo's current price should remain authoritative.

create or replace function public.guard_ottofiori_stale_reconcile_draft()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_source text;
  v_latest_target numeric;
  v_latest_created_at timestamptz;
  v_latest_source text;
begin
  -- Keep the production blast radius deliberately limited to Ottofiori while
  -- this property's pricing strategy is being stabilised.
  if new.hotel_id <> 'ottofiori' or new.push_run_id is null then
    return new;
  end if;

  select r.source
    into v_run_source
  from public.revenue_rate_push_runs r
  where r.id = new.push_run_id;

  if coalesce(v_run_source, '') <> 'reconcile' then
    return new;
  end if;

  -- Look at the newest prior commercial intent for this exact price cell.
  -- A reconciliation row is allowed only when that newest intent:
  --   1) is at most two hours old,
  --   2) came from a real manual/automation run (not another reconcile), and
  --   3) asks for exactly the same target.
  -- This also means a manual cut made after the original request always wins.
  select d.new_price, d.created_at, r.source
    into v_latest_target, v_latest_created_at, v_latest_source
  from public.revenue_rate_drafts d
  left join public.revenue_rate_push_runs r on r.id = d.push_run_id
  where d.hotel_id = new.hotel_id
    and d.stay_date = new.stay_date
    and coalesce(d.obk_id, '') = coalesce(new.obk_id, '')
    and d.room_type_name = new.room_type_name
    and d.occupancy = new.occupancy
    and d.created_at <= coalesce(new.created_at, now())
  order by d.created_at desc
  limit 1;

  if v_latest_created_at is null
     or v_latest_created_at < now() - interval '2 hours'
     or coalesce(v_latest_source, '') = 'reconcile'
     or v_latest_target is null
     or abs(v_latest_target - new.new_price) > 0.01 then
    -- Do not throw: keep the queue healthy, but make the row invisible to the
    -- publisher, which only sends status='draft' rows for a queued run.
    new.status := 'superseded';
    new.confirmation_status := 'superseded';
    new.superseded_at := now();
    new.reconcile_state := 'stale_reconcile_blocked';
    new.reconcile_next_at := null;
    new.push_error := 'Stale reconcile blocked: only the newest recent manual/automation target may be retried.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_ottofiori_stale_reconcile_draft
  on public.revenue_rate_drafts;

create trigger trg_guard_ottofiori_stale_reconcile_draft
before insert on public.revenue_rate_drafts
for each row
execute function public.guard_ottofiori_stale_reconcile_draft();
