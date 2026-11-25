-- Surface due Room Notes Planner instructions through the existing operational
-- room-note channel without giving PMS ownership of the planner records.
--
-- The planner table remains the source of truth. A protected, derived shadow is
-- composed into rooms.notes for TODAY only so all existing housekeeping
-- surfaces (room-chip note icon, manager drilldowns and housekeeper cards) see
-- the instruction immediately. Any PMS/manager write to rooms.notes is passed
-- through this trigger, which removes the previous shadow and re-applies the
-- current planner value.

alter table public.rooms
  add column if not exists hotelcare_planned_note_shadow text;

create or replace function public.room_planned_note_text_for_date(
  target_room_id uuid,
  business_date date
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(
    string_agg(
      case
        when coalesce(n.instruction_type, 'general') = 'general' then btrim(n.content)
        else initcap(replace(n.instruction_type, '_', ' ')) || ': ' || btrim(n.content)
      end,
      '; ' order by n.created_at, n.id
    ),
    ''
  )
  from public.room_planned_notes n
  where n.room_id = target_room_id
    and n.status = 'active'
    and n.start_date <= business_date
    and n.end_date >= business_date
    and (
      n.selected_dates is null
      or cardinality(n.selected_dates) = 0
      or business_date = any(n.selected_dates)
    );
$$;

revoke all on function public.room_planned_note_text_for_date(uuid, date) from public;
grant execute on function public.room_planned_note_text_for_date(uuid, date) to authenticated;

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
  -- Strip only the exact shadow HotelCare previously generated. User/PMS text
  -- remains untouched even when the planner entry is edited or cancelled.
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

  -- If Previo/another PMS has structured sections, add a dedicated
  -- Housekeeping section so the existing privacy filter shows only the
  -- actionable instruction to cleaners. For ordinary manager free text, keep
  -- the planner line as simple readable text so that note is preserved too.
  if base_notes ~* '(Recepce|Reception|Kuchyn[ěe]|Kitchen|Syst[ée]m|Poznámka)\s*:'
     or base_notes ~* 'Housekeeping\s*:' then
    shadow := ' • Housekeeping: [HotelCare planned] ' || planned_text;
  elsif base_notes = '' then
    shadow := '[HotelCare planned] ' || planned_text;
  else
    shadow := E'\n[HotelCare planned] ' || planned_text;
  end if;

  new.notes := base_notes || shadow;
  new.hotelcare_planned_note_shadow := shadow;
  return new;
end;
$$;

-- Run late enough among BEFORE triggers that the final room note is what every
-- existing frontend surface reads, but before the row is persisted.
drop trigger if exists trg_apply_due_planned_note_to_room on public.rooms;
create trigger trg_apply_due_planned_note_to_room
before insert or update of notes on public.rooms
for each row execute function public.apply_due_planned_note_to_room();

create or replace function public.refresh_room_planned_note_shadow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room_id uuid;
begin
  target_room_id := case when tg_op = 'DELETE' then old.room_id else new.room_id end;

  -- A no-op note write intentionally fires the room trigger above. This makes
  -- same-day creates/edits/cancellations visible immediately without waiting
  -- for the next PMS refresh.
  update public.rooms
  set notes = notes
  where id = target_room_id;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_refresh_room_planned_note_shadow on public.room_planned_notes;
create trigger trg_refresh_room_planned_note_shadow
after insert or update or delete on public.room_planned_notes
for each row execute function public.refresh_room_planned_note_shadow();

-- Backfill rooms that already have an instruction due today (for example a
-- note created before this migration was installed).
update public.rooms r
set notes = r.notes
where public.room_planned_note_text_for_date(
  r.id,
  (now() at time zone 'Europe/Budapest')::date
) is not null;

comment on column public.rooms.hotelcare_planned_note_shadow is
  'Derived current-day Room Notes Planner text. Never authoritative; rebuilt from room_planned_notes and protected from PMS overwrites by trigger.';
