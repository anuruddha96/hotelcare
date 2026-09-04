create or replace function public.enforce_ottofiori_push_direction_integrity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_direction text;
  v_movement numeric;
  v_pickup24 integer;
  v_cancellations24 integer;
  v_occupancy numeric;
  v_rooms_remaining integer;
  v_draft_old numeric;
  v_draft_target numeric;
begin
  if new.hotel_id <> 'ottofiori' or new.decision_id is null then
    return new;
  end if;

  -- The durable draft is the authoritative cell intent. The enqueue safety
  -- layer may normalize an in-memory payload before the draft insert, while
  -- database guards subsequently restore the exact whole-date movement on the
  -- draft. Push-item metadata must therefore be copied back from the final
  -- stored draft instead of retaining a stale pre-trigger target.
  if new.draft_id is not null then
    select d.old_price, d.new_price
      into v_draft_old, v_draft_target
      from public.revenue_rate_drafts d
     where d.id = new.draft_id;

    if found then
      if v_draft_old is not null then
        new.old_price := v_draft_old;
      end if;
      if v_draft_target is not null then
        new.target_price := v_draft_target;
      end if;
    end if;
  end if;

  select d.direction,
         d.movement,
         d.pickup_24h,
         d.cancellations_24h,
         d.occupancy_pct,
         d.rooms_remaining
    into v_direction,
         v_movement,
         v_pickup24,
         v_cancellations24,
         v_occupancy,
         v_rooms_remaining
    from public.revenue_date_decisions d
   where d.id = new.decision_id;

  if not found then
    return new;
  end if;

  if v_direction = 'hold' or coalesce(v_movement, 0) = 0 then
    new.status := 'failed';
    new.error := 'Safety blocked: a HOLD date decision cannot publish a price movement.';
    new.claimed_at := null;
    return new;
  end if;

  if new.old_price is not null then
    if v_direction = 'increase' and new.target_price <= new.old_price then
      new.status := 'failed';
      new.error := 'Safety blocked: an INCREASE date decision produced a non-increasing child cell.';
      new.claimed_at := null;
      return new;
    end if;

    if v_direction = 'decrease' and new.target_price >= new.old_price then
      new.status := 'failed';
      new.error := 'Safety blocked: a DECREASE date decision produced a non-decreasing child cell.';
      new.claimed_at := null;
      return new;
    end if;
  end if;

  if v_direction = 'increase'
     and greatest(0, coalesce(v_pickup24, 0) - coalesce(v_cancellations24, 0)) = 1
     and coalesce(v_occupancy, 0) < 85
     and coalesce(v_rooms_remaining, 99) > 2 then
    new.status := 'failed';
    new.error := 'Safety blocked: one net booking with soft occupancy is not enough to increase price.';
    new.claimed_at := null;
    return new;
  end if;

  return new;
end;
$function$;

drop index if exists public.revenue_rate_drafts_one_active_cell_idx;
create unique index revenue_rate_drafts_one_active_cell_idx
  on public.revenue_rate_drafts (hotel_id, stay_date, room_type_name, occupancy)
  where status = 'draft';
