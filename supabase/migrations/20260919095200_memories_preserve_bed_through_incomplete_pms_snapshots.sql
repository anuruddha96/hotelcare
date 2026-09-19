-- Follow-up to the post-checkout manager override safeguard: the live PMS
-- occasionally emits a partial room metadata snapshot lacking reservation
-- status. An absent status is NOT proof a new guest arrived. Retire a manual
-- next-arrival choice only on affirmative new occupancy, not missing fields.
create or replace function public.hotelcare_preserve_post_checkout_manager_bed_setup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_marker jsonb;
  old_bed text;
  previous_guest_note text;
begin
  if lower(btrim(coalesce(new.hotel, ''))) <> 'hotel memories budapest' then
    return new;
  end if;

  old_marker := coalesce(old.pms_metadata, '{}'::jsonb) -> 'managerBedSetupAfterCheckout';
  old_bed := nullif(btrim(coalesce(old.bed_configuration, '')), '');

  if auth.uid() is not null
    and new.bed_configuration is distinct from old.bed_configuration
    and (coalesce(new.pms_metadata, '{}'::jsonb) - 'inferredBedConfig')
      is not distinct from (coalesce(old.pms_metadata, '{}'::jsonb) - 'inferredBedConfig')
    and coalesce(old.pms_metadata ->> 'reservationStatusId', '') = '9'
    and coalesce(old.pms_metadata ->> 'checkedOutToday', 'false') = 'true'
  then
    if nullif(btrim(coalesce(new.bed_configuration, '')), '') is null then
      new.pms_metadata := coalesce(new.pms_metadata, '{}'::jsonb) - 'managerBedSetupAfterCheckout';
    else
      new.pms_metadata := jsonb_set(
        coalesce(new.pms_metadata, '{}'::jsonb),
        '{managerBedSetupAfterCheckout}',
        jsonb_build_object(
          'value', new.bed_configuration,
          'setAt', now()::text,
          'setBy', auth.uid()::text,
          'scope', 'after_confirmed_checkout'
        ), true
      );
    end if;
    return new;
  end if;

  if old_marker is null then
    return new;
  end if;

  if coalesce(new.pms_metadata ->> 'occupiedToday', 'false') = 'true' then
    -- Confirmed incoming stay: carry the manager's desired bed setup into
    -- that stay but retire the marker, so its NEXT checkout clears normally.
    new.pms_metadata := coalesce(new.pms_metadata, '{}'::jsonb) - 'managerBedSetupAfterCheckout';
    if old_bed is not null and new.bed_configuration is null then
      new.bed_configuration := old.bed_configuration;
    end if;
  else
    -- Repeated checkout OR incomplete PMS snapshot: neither may discard a
    -- manager choice for room preparation after the previous guest left.
    new.pms_metadata := jsonb_set(
      coalesce(new.pms_metadata, '{}'::jsonb),
      '{managerBedSetupAfterCheckout}', old_marker, true
    );
    if old_bed is not null then
      new.bed_configuration := old.bed_configuration;
    end if;
    previous_guest_note := nullif(btrim(coalesce(new.pms_metadata #>> '{previousGuestBedSetup,note}', '')), '');
    if previous_guest_note is not null
      and new.notes = previous_guest_note
      and old.notes is distinct from new.notes
      and nullif(btrim(coalesce(old.notes, '')), '') is not null
    then
      new.notes := old.notes;
    end if;
  end if;

  return new;
end;
$$;
