-- First-class housekeeping outcome for completed room assignments.
--
-- `status = completed` means the housekeeper finished handling the assignment;
-- it does NOT always mean the room was cleaned. In particular, Hotel Memories
-- Budapest daily rooms can legitimately finish as No Service when the guest
-- declines / has not requested housekeeping. Keep that outcome separate so
-- supervisors and PMS integrations do not treat it as a cleaned room.

alter table public.room_assignments
  add column if not exists service_result text;

alter table public.room_assignments
  drop constraint if exists room_assignments_service_result_check;

alter table public.room_assignments
  add constraint room_assignments_service_result_check
  check (
    service_result is null
    or service_result in ('cleaned', 'guest_declined')
  );

comment on column public.room_assignments.service_result is
  'Housekeeping outcome for a completed cleaning assignment: cleaned or guest_declined. Null is used for non-cleaning/DND/legacy-incomplete outcomes.';

-- Preserve compatibility with older clients that wrote [NO_SERVICE] in notes.
update public.room_assignments
set service_result = 'guest_declined'
where service_result is null
  and status = 'completed'
  and coalesce(notes, '') like '%[NO_SERVICE]%';

-- Backfill ordinary historical cleaning completions when they contain a real
-- completion timestamp and are not DND/no-service outcomes. Rows force-closed
-- during reassignment generally have no completed_at and therefore stay null.
update public.room_assignments
set service_result = 'cleaned'
where service_result is null
  and status = 'completed'
  and completed_at is not null
  and assignment_type in ('daily_cleaning', 'checkout_cleaning', 'deep_cleaning')
  and coalesce(is_dnd, false) = false
  and coalesce(notes, '') not like '%[NO_SERVICE]%';

create or replace function public.normalize_room_assignment_service_result()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Reopening/recycling an assignment must clear the final service outcome.
  -- This also prevents a previous No Service result from leaking into a new
  -- attempt on the same assignment row.
  if new.status <> 'completed' then
    new.service_result := null;
    return new;
  end if;

  -- Legacy clients still write [NO_SERVICE]; promote that marker to the new
  -- first-class outcome automatically.
  if new.service_result is null
     and coalesce(new.notes, '') like '%[NO_SERVICE]%' then
    new.service_result := 'guest_declined';
    return new;
  end if;

  -- Only infer `cleaned` on a genuine transition into completed with a real
  -- completion timestamp. DND and maintenance outcomes are deliberately not
  -- classified as cleaned.
  if new.service_result is null
     and new.assignment_type in ('daily_cleaning', 'checkout_cleaning', 'deep_cleaning')
     and new.completed_at is not null
     and coalesce(new.is_dnd, false) = false
     and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    new.service_result := 'cleaned';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_room_assignment_service_result on public.room_assignments;
create trigger trg_normalize_room_assignment_service_result
before insert or update of status, completed_at, notes, is_dnd, service_result
on public.room_assignments
for each row
execute function public.normalize_room_assignment_service_result();
