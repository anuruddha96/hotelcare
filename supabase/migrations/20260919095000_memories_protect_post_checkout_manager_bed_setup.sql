-- Hotel Memories Budapest only: the checkout lifecycle resets the *previous*
-- guest's bed setup. If a manager explicitly selects a new setup AFTER Previo
-- has already confirmed checkout, a repeat status=9 PMS refresh must not erase
-- that new turnover / next-arrival instruction. The first checkout still resets
-- previous-guest instructions. On the next occupied stay the marker is retired,
-- so that stay's eventual checkout follows the existing lifecycle normally.
-- The trigger name sorts AFTER trg_hotelcare_protect_daily_room_manual_setup.

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

  -- The RoomCommunicationPanel sends a bed-only UPDATE. Recognize a real
  -- authenticated, post-checkout selection, not a PMS metadata refresh. Also
  -- allow intentional deselection without restoring the just-cleared value.
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
        ),
        true
      );
    end if;
    return new;
  end if;

  if old_marker is null then
    return new;
  end if;

  if coalesce(new.pms_metadata ->> 'reservationStatusId', '') = '9'
    and coalesce(new.pms_metadata ->> 'occupiedToday', 'false') <> 'true'
  then
    -- The existing lifecycle may have just reset the value in an earlier
    -- BEFORE trigger. Restore only the *post-checkout* manager choice.
    new.pms_metadata := jsonb_set(
      coalesce(new.pms_metadata, '{}'::jsonb),
      '{managerBedSetupAfterCheckout}',
      old_marker,
      true
    );
    if old_bed is not null then
      new.bed_configuration := old.bed_configuration;
    end if;

    -- A repeated checkout refresh can regenerate its previous-guest note.
    -- Do not let that synthetic text replace a newer manager note.
    previous_guest_note := nullif(
      btrim(coalesce(new.pms_metadata #>> '{previousGuestBedSetup,note}', '')),
      ''
    );
    if previous_guest_note is not null
      and new.notes = previous_guest_note
      and old.notes is distinct from new.notes
      and nullif(btrim(coalesce(old.notes, '')), '') is not null
    then
      new.notes := old.notes;
    end if;
  else
    -- The next stay is in-house (or the prior checkout is no longer valid).
    -- Retire the marker, preserving the newly selected setup for that stay;
    -- the next real checkout uses the original reset lifecycle as before.
    new.pms_metadata := coalesce(new.pms_metadata, '{}'::jsonb)
      - 'managerBedSetupAfterCheckout';
    if coalesce(new.pms_metadata ->> 'occupiedToday', 'false') = 'true'
      and old_bed is not null
      and new.bed_configuration is null
    then
      new.bed_configuration := old.bed_configuration;
    end if;
  end if;

  return new;
end;
$$;

-- Idempotent migration; no unrelated hotels or prior guest data are modified.
drop trigger if exists zz_hotelcare_post_checkout_manager_bed_setup on public.rooms;
create trigger zz_hotelcare_post_checkout_manager_bed_setup
before update of bed_configuration, pms_metadata, notes
on public.rooms
for each row
execute function public.hotelcare_preserve_post_checkout_manager_bed_setup();
