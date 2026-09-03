-- Production safety invariant for Hotel Ottofiori revenue automation.
-- A date-level HOLD must never create a commercial price movement, and child
-- cells may never move against the direction chosen by the date decision.
-- Also suppress a single-booking upward move while occupancy is still soft.

create or replace function public.enforce_ottofiori_push_direction_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_direction text;
  v_movement numeric;
  v_pickup24 integer;
  v_cancellations24 integer;
  v_occupancy numeric;
  v_rooms_remaining integer;
begin
  if new.hotel_id <> 'ottofiori' or new.decision_id is null then
    return new;
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

  -- One booking is evidence to hold, not to yield upward, while substantial
  -- inventory remains and occupancy is below the agreed scarcity threshold.
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
$$;

drop trigger if exists trg_enforce_ottofiori_push_direction_integrity
  on public.revenue_rate_push_items;

create trigger trg_enforce_ottofiori_push_direction_integrity
before insert or update of status, target_price, old_price, decision_id
on public.revenue_rate_push_items
for each row
execute function public.enforce_ottofiori_push_direction_integrity();
