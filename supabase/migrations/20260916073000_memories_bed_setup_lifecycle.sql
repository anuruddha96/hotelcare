-- Hotel Memories Budapest bed-setup lifecycle
--
-- Operational rule:
-- 1) A stayover/daily room keeps its existing HotelCare bed instruction for the
--    whole in-house stay. PMS notes / PMS-inferred bed setup must not overwrite it.
-- 2) The stayover decision is based on fresh PMS stay facts, not a potentially
--    stale/manual is_checkout_room flag.
-- 3) Once the guest is actually checked out, the active bed instruction resets
--    to the room's standard setup (no bed_configuration override).
-- 4) The previous guest's special bed setup is kept only as short context in the
--    room note, then removed automatically when the next occupied stay begins.

create or replace function public.hotelcare_protect_daily_room_manual_setup()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  is_daily_room boolean := false;
  is_memories boolean := false;
  is_checked_out boolean := false;
  pms_refresh boolean := false;
  pms_note text;
  old_inferred_bed text;
  previous_bed text;
  previous_note text;
  old_previous_note text;
begin
  is_memories := lower(btrim(coalesce(new.hotel, ''))) = 'hotel memories budapest';

  -- A guest who is still in-house is a daily/stayover room even if an old
  -- HotelCare/manual room-type override currently says checkout. This fixes the
  -- false-checkout edge case while still allowing tomorrow departures to remain
  -- daily rooms until the guest really checks out.
  is_daily_room :=
    coalesce(new.pms_metadata ->> 'occupiedToday', 'false') = 'true'
    and coalesce(new.pms_metadata ->> 'stayThroughToday', 'true') = 'true'
    and coalesce(new.pms_metadata ->> 'scheduledDepartureToday', 'false') <> 'true';

  -- Identify PMS-owned refreshes without blocking ordinary manager edits.
  pms_refresh := new.pms_metadata is distinct from old.pms_metadata
    and (
      new.pms_metadata -> 'pmsSyncDate' is distinct from old.pms_metadata -> 'pmsSyncDate'
      or new.pms_metadata -> 'occupiedToday' is distinct from old.pms_metadata -> 'occupiedToday'
      or new.pms_metadata -> 'noteInternal' is distinct from old.pms_metadata -> 'noteInternal'
      or new.pms_metadata -> 'inferredBedConfig' is distinct from old.pms_metadata -> 'inferredBedConfig'
      or new.pms_metadata -> 'currentNight' is distinct from old.pms_metadata -> 'currentNight'
      or new.pms_metadata -> 'totalNights' is distinct from old.pms_metadata -> 'totalNights'
      or new.pms_metadata -> 'reservationStatusId' is distinct from old.pms_metadata -> 'reservationStatusId'
      or new.pms_metadata -> 'scheduledDepartureToday' is distinct from old.pms_metadata -> 'scheduledDepartureToday'
      or new.pms_metadata -> 'scheduledDepartureTomorrow' is distinct from old.pms_metadata -> 'scheduledDepartureTomorrow'
      or new.pms_metadata -> 'stayThroughToday' is distinct from old.pms_metadata -> 'stayThroughToday'
    );

  if not pms_refresh then
    return new;
  end if;

  old_previous_note := nullif(btrim(coalesce(old.pms_metadata #>> '{previousGuestBedSetup,note}', '')), '');

  if is_daily_room then
    -- If a new occupied stay has started, the previous-guest context has served
    -- its purpose. Remove only the exact HotelCare-generated line; manager notes
    -- remain untouched.
    if is_memories
      and old_previous_note is not null
      and coalesce(old.pms_metadata ->> 'occupiedToday', 'false') <> 'true'
    then
      new.notes := nullif(
        btrim(
          regexp_replace(
            replace(coalesce(new.notes, ''), old_previous_note, ''),
            '\s*\n\s*',
            E'\n',
            'g'
          )
        ),
        ''
      );
      new.pms_metadata := coalesce(new.pms_metadata, '{}'::jsonb) - 'previousGuestBedSetup';
    end if;

    -- PMS housekeeping text must not become an active stayover instruction.
    pms_note := nullif(btrim(coalesce(new.pms_metadata ->> 'noteInternal', '')), '');
    if pms_note is not null and new.notes is distinct from old.notes then
      new.notes := nullif(
        btrim(
          regexp_replace(
            replace(coalesce(new.notes, ''), pms_note, ''),
            '\s+',
            ' ',
            'g'
          )
        ),
        ''
      );
    end if;

    old_inferred_bed := nullif(btrim(coalesce(old.pms_metadata #>> '{inferredBedConfig,value}', '')), '');

    -- An old PMS-inferred setup is not an active manager instruction. Otherwise
    -- keep the manager-selected/current bed setup exactly unchanged for the stay.
    if old_inferred_bed is not null and old.bed_configuration = old_inferred_bed then
      new.bed_configuration := null;
    else
      new.bed_configuration := old.bed_configuration;
    end if;

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
  end if;

  -- Memories: only reset after the PMS indicates a real departure/checkout.
  -- Previo status 9 is the observed checked-out status; the departure facts are
  -- retained as a defensive fallback for equivalent PMS payloads.
  is_checked_out := is_memories and (
    coalesce(new.pms_metadata ->> 'reservationStatusId', '') = '9'
    or (
      coalesce(new.pms_metadata ->> 'scheduledDepartureToday', 'false') = 'true'
      and coalesce(new.pms_metadata ->> 'occupiedToday', 'false') = 'false'
      and coalesce(new.pms_metadata ->> 'stayThroughToday', 'false') = 'false'
    )
  );

  if is_checked_out then
    -- Do not carry the departing guest's PMS housekeeping text forward as an
    -- instruction for the turnover / next guest.
    pms_note := nullif(btrim(coalesce(new.pms_metadata ->> 'noteInternal', '')), '');
    if pms_note is not null then
      new.notes := nullif(
        btrim(
          regexp_replace(
            replace(coalesce(new.notes, ''), pms_note, ''),
            '\s+',
            ' ',
            'g'
          )
        ),
        ''
      );
    end if;

    if old_previous_note is not null then
      new.notes := nullif(
        btrim(replace(coalesce(new.notes, ''), old_previous_note, '')),
        ''
      );
    end if;

    previous_bed := nullif(btrim(coalesce(old.bed_configuration, '')), '');

    -- Null means "use the room's normal/default setup". bed_configuration is an
    -- operational override, not a permanent physical-room configuration.
    new.bed_configuration := null;
    new.pms_metadata := coalesce(new.pms_metadata, '{}'::jsonb)
      - 'noteInternal'
      - 'inferredBedConfig'
      - 'previousGuestBedSetup';

    if previous_bed is not null then
      previous_note := format(
        'Previous guest bed setup: %s — reset to standard room setup.',
        previous_bed
      );

      new.notes := concat_ws(E'\n', nullif(btrim(coalesce(new.notes, '')), ''), previous_note);
      new.pms_metadata := jsonb_set(
        new.pms_metadata,
        '{previousGuestBedSetup}',
        jsonb_build_object(
          'value', previous_bed,
          'note', previous_note,
          'capturedAt', now()::text,
          'source', 'checkout_reset'
        ),
        true
      );
    end if;

    new.pms_metadata := jsonb_set(
      new.pms_metadata,
      '{bedSetupResetAtCheckoutAt}',
      to_jsonb(now()::text),
      true
    );
  end if;

  return new;
end;
$$;

-- Keep the same trigger name so the existing production lifecycle is upgraded
-- in place rather than introducing a competing trigger.
drop trigger if exists trg_hotelcare_protect_daily_room_manual_setup on public.rooms;

create trigger trg_hotelcare_protect_daily_room_manual_setup
before update of pms_metadata, notes, bed_configuration, is_checkout_room
on public.rooms
for each row
execute function public.hotelcare_protect_daily_room_manual_setup();

-- Correct stale Hotel Memories bed overrides that are already present today.
-- Only clear a currently non-occupied override when housekeeping history proves
-- that the same setup existed on a checkout day. This deliberately preserves
-- today's occupied daily rooms and their active manager-selected setup.
with stale as (
  select
    r.id,
    r.bed_configuration as previous_bed,
    format(
      'Previous guest bed setup: %s — reset to standard room setup.',
      r.bed_configuration
    ) as previous_note,
    nullif(btrim(coalesce(r.pms_metadata ->> 'noteInternal', '')), '') as pms_note
  from public.rooms r
  where r.hotel = 'Hotel Memories Budapest'
    and nullif(btrim(coalesce(r.bed_configuration, '')), '') is not null
    and coalesce(r.pms_metadata ->> 'occupiedToday', 'false') <> 'true'
    and exists (
      select 1
      from public.housekeeping_room_snapshots s
      where s.room_id = r.id
        and coalesce(s.is_checkout_room, false) = true
        and s.bed_configuration = r.bed_configuration
        and s.business_date <= (now() at time zone 'Europe/Budapest')::date
    )
)
update public.rooms r
set
  bed_configuration = null,
  notes = concat_ws(
    E'\n',
    nullif(
      btrim(
        case
          when s.pms_note is not null then replace(coalesce(r.notes, ''), s.pms_note, '')
          else coalesce(r.notes, '')
        end
      ),
      ''
    ),
    s.previous_note
  ),
  pms_metadata = jsonb_set(
    (
      coalesce(r.pms_metadata, '{}'::jsonb)
      - 'noteInternal'
      - 'inferredBedConfig'
      - 'previousGuestBedSetup'
    ),
    '{previousGuestBedSetup}',
    jsonb_build_object(
      'value', s.previous_bed,
      'note', s.previous_note,
      'capturedAt', now()::text,
      'source', 'stale_checkout_backfill'
    ),
    true
  ),
  updated_at = now()
from stale s
where r.id = s.id;
