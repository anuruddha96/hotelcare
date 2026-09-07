-- Canonicalize the old [ROOM_CLEANING] notes flag into the existing
-- linen_change_required field (the single Change Room source of truth), and
-- protect final-night stayovers from unnecessary full room/linen changes.
--
-- Operational rule:
--   * The PMS sync may schedule a periodic Change Room (linen change).
--   * If PMS says the guest checks out tomorrow, that Change Room is replaced
--     by a Towel Change. Checkout cleaning the following day performs the full
--     reset, so doing a full Change Room on the final night is unnecessary.
--
-- Manual manager overrides remain possible: the final-night conversion runs
-- only when PMS metadata is inserted/refreshed, not on an unrelated manual
-- service update.

create or replace function public.hotelcare_normalize_change_room()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  pms_refresh boolean := false;
begin
  -- ROOM_CLEANING was an older notes-based representation of the same service.
  -- Convert it into linen_change_required so the application has one canonical
  -- Change Room flag while remaining compatible with older clients.
  if coalesce(new.notes, '') like '%[ROOM_CLEANING]%' then
    new.linen_change_required := true;
    new.notes := nullif(
      btrim(
        regexp_replace(
          regexp_replace(new.notes, '\s*\[ROOM_CLEANING\]\s*', ' ', 'g'),
          '\s+', ' ', 'g'
        )
      ),
      ''
    );
  end if;

  pms_refresh := tg_op = 'INSERT'
    or new.pms_metadata is distinct from old.pms_metadata;

  -- A scheduled Change Room on the guest's final occupied night becomes a
  -- towel-only service. Do not interfere with a checkout that is happening
  -- today; checkout-cleaning rules remain authoritative for those rooms.
  if pms_refresh
     and coalesce(new.pms_metadata ->> 'scheduledDepartureTomorrow', 'false') = 'true'
     and coalesce(new.linen_change_required, false) = true
     and coalesce(new.is_checkout_room, false) = false then
    new.linen_change_required := false;
    new.towel_change_required := true;
    new.pms_metadata := jsonb_set(
      coalesce(new.pms_metadata, '{}'::jsonb),
      '{changeRoomAdjustedForDepartureTomorrow}',
      'true'::jsonb,
      true
    );
  elsif pms_refresh and new.pms_metadata is not null then
    -- Clear the explanatory marker when the condition no longer applies.
    new.pms_metadata := new.pms_metadata - 'changeRoomAdjustedForDepartureTomorrow';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_hotelcare_normalize_change_room on public.rooms;

create trigger trg_hotelcare_normalize_change_room
before insert or update of notes, pms_metadata, linen_change_required, towel_change_required, is_checkout_room
on public.rooms
for each row
execute function public.hotelcare_normalize_change_room();

-- One-time canonicalization for legacy ROOM_CLEANING flags already stored in
-- room notes. The trigger above performs the conversion during this update.
update public.rooms
set notes = notes
where coalesce(notes, '') like '%[ROOM_CLEANING]%';

-- Correct any currently synced final-night rooms immediately instead of waiting
-- for the next Previo refresh.
update public.rooms
set pms_metadata = jsonb_set(
      coalesce(pms_metadata, '{}'::jsonb),
      '{changeRoomRuleRecheckedAt}',
      to_jsonb(now()::text),
      true
    )
where coalesce(pms_metadata ->> 'scheduledDepartureTomorrow', 'false') = 'true'
  and coalesce(linen_change_required, false) = true
  and coalesce(is_checkout_room, false) = false;
