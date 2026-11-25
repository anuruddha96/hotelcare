-- Keep Room Notes Planner instructions visible in existing operational surfaces
-- without exposing the internal "[HotelCare planned]" implementation label to
-- managers or housekeepers.
--
-- `hotelcare_planned_note_shadow` remains the exact derived shadow used to
-- protect planner instructions from PMS overwrites; only the user-facing text
-- composed into rooms.notes changes.

create or replace function public.apply_due_planned_note_to_room()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  business_date date := (now() at time zone 'Europe/Budapest')::date;
  base_notes text := coalesce(new.notes, '');
  planned_text text;
  shadow text;
begin
  if tg_op = 'UPDATE'
     and old.hotelcare_planned_note_shadow is not null
     and old.hotelcare_planned_note_shadow <> '' then
    base_notes := replace(base_notes, old.hotelcare_planned_note_shadow, '');
  end if;

  base_notes := btrim(base_notes);
  planned_text := public.room_planned_note_text_for_date(new.id, business_date);

  if planned_text is null then
    new.notes := nullif(base_notes, '');
    new.hotelcare_planned_note_shadow := null;
    return new;
  end if;

  if base_notes ~* '(Recepce|Reception|Kuchyn[ěe]|Kitchen|Syst[ée]m|Poznámka)\s*:'
     or base_notes ~* 'Housekeeping\s*:' then
    shadow := ' • Housekeeping: ' || planned_text;
  elsif base_notes = '' then
    shadow := planned_text;
  else
    shadow := E'\n' || planned_text;
  end if;

  new.notes := base_notes || shadow;
  new.hotelcare_planned_note_shadow := shadow;
  return new;
end;
$$;

-- Rewrite every currently active derived shadow immediately. The trigger above
-- strips the previous exact shadow and re-composes the clean user-facing one.
update public.rooms
set notes = notes
where hotelcare_planned_note_shadow is not null
  and hotelcare_planned_note_shadow <> '';
