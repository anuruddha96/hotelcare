-- Final polish for the Hotel Memories bed-setup lifecycle: generated previous-
-- guest context must remain one clean line across repeated PMS checkout refreshes.

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

  is_daily_room :=
    coalesce(new.pms_metadata ->> 'occupiedToday', 'false') = 'true'
    and coalesce(new.pms_metadata ->> 'stayThroughToday', 'true') = 'true'
    and coalesce(new.pms_metadata ->> 'scheduledDepartureToday', 'false') <> 'true';

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

  old_previous_note := nullif(btrim(coalesce(old.pms_metadata #>> '{previousGuestBedSetup,note}', ''), E' \n\r\t'), '');

  if is_daily_room then
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
          ),
          E' \n\r\t'
        ),
        ''
      );
      new.pms_metadata := coalesce(new.pms_metadata, '{}'::jsonb) - 'previousGuestBedSetup';
    end if;

    pms_note := nullif(btrim(coalesce(new.pms_metadata ->> 'noteInternal', ''), E' \n\r\t'), '');
    if pms_note is not null and new.notes is distinct from old.notes then
      new.notes := nullif(
        btrim(
          regexp_replace(
            replace(coalesce(new.notes, ''), pms_note, ''),
            '\s+',
            ' ',
            'g'
          ),
          E' \n\r\t'
        ),
        ''
      );
    end if;

    old_inferred_bed := nullif(btrim(coalesce(old.pms_metadata #>> '{inferredBedConfig,value}', ''), E' \n\r\t'), '');

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

  is_checked_out := is_memories and (
    coalesce(new.pms_metadata ->> 'reservationStatusId', '') = '9'
    or (
      coalesce(new.pms_metadata ->> 'scheduledDepartureToday', 'false') = 'true'
      and coalesce(new.pms_metadata ->> 'occupiedToday', 'false') = 'false'
      and coalesce(new.pms_metadata ->> 'stayThroughToday', 'false') = 'false'
    )
  );

  if is_checked_out then
    pms_note := nullif(btrim(coalesce(new.pms_metadata ->> 'noteInternal', ''), E' \n\r\t'), '');
    if pms_note is not null then
      new.notes := nullif(
        btrim(
          regexp_replace(
            replace(coalesce(new.notes, ''), pms_note, ''),
            '\s+',
            ' ',
            'g'
          ),
          E' \n\r\t'
        ),
        ''
      );
    end if;

    if old_previous_note is not null then
      new.notes := nullif(
        btrim(replace(coalesce(new.notes, ''), old_previous_note, ''), E' \n\r\t'),
        ''
      );
    end if;

    previous_bed := coalesce(
      nullif(btrim(coalesce(old.bed_configuration, ''), E' \n\r\t'), ''),
      nullif(btrim(coalesce(old.pms_metadata #>> '{previousGuestBedSetup,value}', ''), E' \n\r\t'), '')
    );

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

      new.notes := nullif(
        btrim(replace(coalesce(new.notes, ''), previous_note, ''), E' \n\r\t'),
        ''
      );
      new.notes := concat_ws(E'\n', new.notes, previous_note);
      new.pms_metadata := jsonb_set(
        new.pms_metadata,
        '{previousGuestBedSetup}',
        jsonb_build_object(
          'value', previous_bed,
          'note', previous_note,
          'capturedAt', coalesce(
            nullif(old.pms_metadata #>> '{previousGuestBedSetup,capturedAt}', ''),
            now()::text
          ),
          'source', coalesce(
            nullif(old.pms_metadata #>> '{previousGuestBedSetup,source}', ''),
            'checkout_reset'
          )
        ),
        true
      );
    end if;

    new.pms_metadata := jsonb_set(
      new.pms_metadata,
      '{bedSetupResetAtCheckoutAt}',
      to_jsonb(coalesce(
        nullif(old.pms_metadata ->> 'bedSetupResetAtCheckoutAt', ''),
        now()::text
      )),
      true
    );
  end if;

  return new;
end;
$$;

update public.rooms r
set
  notes = concat_ws(
    E'\n',
    nullif(
      btrim(
        replace(
          coalesce(r.notes, ''),
          nullif(r.pms_metadata #>> '{previousGuestBedSetup,note}', ''),
          ''
        ),
        E' \n\r\t'
      ),
      ''
    ),
    nullif(r.pms_metadata #>> '{previousGuestBedSetup,note}', '')
  ),
  updated_at = now()
where r.hotel = 'Hotel Memories Budapest'
  and nullif(r.pms_metadata #>> '{previousGuestBedSetup,note}', '') is not null;
