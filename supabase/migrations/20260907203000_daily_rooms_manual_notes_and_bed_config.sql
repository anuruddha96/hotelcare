-- Daily/stayover rooms already have an in-house guest. PMS housekeeping notes
-- must not automatically become active HotelCare room notes or bed setup
-- instructions for these rooms. Managers remain responsible for daily-room
-- notes and bed configuration.

create or replace function public.hotelcare_protect_daily_room_manual_setup()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  is_daily_room boolean := false;
  pms_refresh boolean := false;
  pms_note text;
  old_inferred_bed text;
  new_inferred_bed text;
begin
  is_daily_room :=
    coalesce(new.pms_metadata ->> 'occupiedToday', 'false') = 'true'
    and coalesce(new.is_checkout_room, false) = false;

  -- Identify PMS-owned changes without blocking normal manager edits that may
  -- also touch pms_metadata for manual flags.
  pms_refresh := new.pms_metadata is distinct from old.pms_metadata
    and (
      new.pms_metadata -> 'occupiedToday' is distinct from old.pms_metadata -> 'occupiedToday'
      or new.pms_metadata -> 'noteInternal' is distinct from old.pms_metadata -> 'noteInternal'
      or new.pms_metadata -> 'inferredBedConfig' is distinct from old.pms_metadata -> 'inferredBedConfig'
      or new.pms_metadata -> 'currentNight' is distinct from old.pms_metadata -> 'currentNight'
      or new.pms_metadata -> 'totalNights' is distinct from old.pms_metadata -> 'totalNights'
      or new.pms_metadata -> 'reservationStatusId' is distinct from old.pms_metadata -> 'reservationStatusId'
      or new.pms_metadata -> 'scheduledDepartureToday' is distinct from old.pms_metadata -> 'scheduledDepartureToday'
      or new.pms_metadata -> 'scheduledDepartureTomorrow' is distinct from old.pms_metadata -> 'scheduledDepartureTomorrow'
      or new.pms_metadata -> 'stayThroughToday' is distinct from old.pms_metadata -> 'stayThroughToday'
    );

  if not (is_daily_room and pms_refresh) then
    return new;
  end if;

  -- Strip the exact PMS housekeeping note that the sync attempted to append to
  -- rooms.notes. Structured HotelCare flags and any pre-existing manager note
  -- remain untouched.
  pms_note := nullif(btrim(coalesce(new.pms_metadata ->> 'noteInternal', '')), '');
  if pms_note is not null and new.notes is distinct from old.notes then
    new.notes := nullif(
      btrim(
        regexp_replace(
          replace(coalesce(new.notes, ''), pms_note, ''),
          '\s+', ' ', 'g'
        )
      ),
      ''
    );
  end if;

  old_inferred_bed := nullif(btrim(coalesce(old.pms_metadata #>> '{inferredBedConfig,value}', '')), '');
  new_inferred_bed := nullif(btrim(coalesce(new.pms_metadata #>> '{inferredBedConfig,value}', '')), '');

  -- If the previous bed setup was also auto-inferred, clear that stale setup.
  -- Otherwise keep the manager-selected bed configuration exactly as it was.
  if old_inferred_bed is not null and old.bed_configuration = old_inferred_bed then
    new.bed_configuration := null;
  else
    new.bed_configuration := old.bed_configuration;
  end if;

  -- Daily rooms must not carry an active PMS housekeeping note or an inferred
  -- bed marker. The raw PMS snapshot still contains all occupancy/departure
  -- information used for housekeeping scheduling.
  new.pms_metadata := coalesce(new.pms_metadata, '{}'::jsonb)
    - 'noteInternal'
    - 'inferredBedConfig';
  new.pms_metadata := jsonb_set(
    new.pms_metadata,
    '{dailyRoomManualSetupProtectedAt}',
    to_jsonb(now()::text),
    true
  );

  return new;
end;
$$;

drop trigger if exists trg_hotelcare_protect_daily_room_manual_setup on public.rooms;

create trigger trg_hotelcare_protect_daily_room_manual_setup
before update of pms_metadata, notes, bed_configuration, is_checkout_room
on public.rooms
for each row
execute function public.hotelcare_protect_daily_room_manual_setup();

-- Clean up only data that can be identified as PMS-owned with confidence.
-- Manager-owned bed configurations are preserved when they differ from the
-- old inferred marker.
update public.rooms
set
  notes = case
    when nullif(btrim(coalesce(pms_metadata ->> 'noteInternal', '')), '') is not null
      then nullif(
        btrim(
          regexp_replace(
            replace(
              coalesce(notes, ''),
              pms_metadata ->> 'noteInternal',
              ''
            ),
            '\s+', ' ', 'g'
          )
        ),
        ''
      )
    else notes
  end,
  bed_configuration = case
    when nullif(btrim(coalesce(pms_metadata #>> '{inferredBedConfig,value}', '')), '') is not null
      and bed_configuration = pms_metadata #>> '{inferredBedConfig,value}'
      then null
    else bed_configuration
  end,
  pms_metadata = jsonb_set(
    coalesce(pms_metadata, '{}'::jsonb) - 'noteInternal' - 'inferredBedConfig',
    '{dailyRoomManualSetupProtectedAt}',
    to_jsonb(now()::text),
    true
  ),
  updated_at = now()
where coalesce(pms_metadata ->> 'occupiedToday', 'false') = 'true'
  and coalesce(is_checkout_room, false) = false
  and (
    pms_metadata ? 'noteInternal'
    or pms_metadata ? 'inferredBedConfig'
  );
