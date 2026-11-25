-- Gozsdu Court Budapest has a property-specific stay-over housekeeping cycle.
-- IMPORTANT: this trigger is deliberately exact-gated to Gozsdu only.
-- No other hotel or organization is affected.

create or replace function public.apply_gozsdu_housekeeping_cycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  current_night integer := 0;
  total_nights integer := 0;
  remaining_nights integer := 0;
  service_type text := 'none';
  metadata jsonb := coalesce(new.pms_metadata, '{}'::jsonb);
  scheduled_departure_today boolean := false;
begin
  if lower(trim(coalesce(new.hotel, ''))) not in ('gozsdu-court', 'gozsdu court budapest') then
    return new;
  end if;

  if coalesce(new.guest_nights_stayed, 0) > 0 then
    current_night := new.guest_nights_stayed;
  elsif coalesce(metadata ->> 'currentNight', '') ~ '^\d+$' then
    current_night := (metadata ->> 'currentNight')::integer;
  end if;

  if coalesce(metadata ->> 'totalNights', '') ~ '^\d+$' then
    total_nights := (metadata ->> 'totalNights')::integer;
  end if;

  scheduled_departure_today := lower(coalesce(metadata ->> 'scheduledDepartureToday', 'false')) in ('true', '1', 'yes');
  remaining_nights := greatest(total_nights - current_night, 0);

  if coalesce(new.is_checkout_room, false) or scheduled_departure_today then
    service_type := 'none';
  elsif current_night >= 2 and mod(current_night, 2) = 0 then
    if mod(current_night, 4) = 0 and remaining_nights > 1 then
      service_type := 'change_room';
    else
      service_type := 'towel_change';
    end if;
  end if;

  new.towel_change_required := service_type = 'towel_change';
  new.linen_change_required := service_type = 'change_room';

  new.pms_metadata := jsonb_set(
    metadata,
    '{gozsduHousekeeping}',
    jsonb_build_object(
      'policyVersion', 1,
      'serviceType', service_type,
      'serviceDue', service_type <> 'none',
      'currentNight', current_night,
      'totalNights', total_nights,
      'remainingNightsAfterToday', remaining_nights,
      'propertyGate', 'gozsdu-court'
    ),
    true
  );

  return new;
end;
$$;

comment on function public.apply_gozsdu_housekeeping_cycle() is
  'Applies the every-2nd-night Gozsdu Court Budapest housekeeping cycle only; every 4th night is Change Room unless checkout is next day.';

drop trigger if exists trg_apply_gozsdu_housekeeping_cycle on public.rooms;
create trigger trg_apply_gozsdu_housekeeping_cycle
before insert or update of hotel, guest_nights_stayed, is_checkout_room, pms_metadata
on public.rooms
for each row
execute function public.apply_gozsdu_housekeeping_cycle();

-- Recalculate only the existing Gozsdu room rows immediately on rollout so
-- today's T / Change Room flags are correct before the next PMS refresh.
-- Assigning pms_metadata to itself intentionally fires the exact-gated trigger.
update public.rooms
set pms_metadata = coalesce(pms_metadata, '{}'::jsonb)
where lower(trim(coalesce(hotel, ''))) in ('gozsdu-court', 'gozsdu court budapest');
