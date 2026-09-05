-- Track minibar refill outcomes separately from billing confirmation.
-- A stayover room can be approved even when the guest blocks physical access,
-- while keeping the refill visible until a manager can enter the room later.

alter table public.room_minibar_usage
  add column if not exists refill_status text,
  add column if not exists refill_blocked_reason text,
  add column if not exists refill_blocked_at timestamptz,
  add column if not exists refill_blocked_by uuid,
  add column if not exists refill_resolved_at timestamptz,
  add column if not exists refill_resolved_by uuid,
  add column if not exists previo_charge_confirmed_at timestamptz,
  add column if not exists previo_charge_confirmed_by uuid;

comment on column public.room_minibar_usage.refill_status is
  'Physical refill workflow status. Supported values: refilled, blocked_guest_inside.';
comment on column public.room_minibar_usage.previo_charge_confirmed_at is
  'When a supervisor confirmed that this minibar usage was manually charged in Previo.';

create index if not exists room_minibar_usage_pending_refill_idx
  on public.room_minibar_usage (room_id, refill_blocked_at)
  where is_cleared = false and refill_status = 'blocked_guest_inside';

-- Carry an unresolved refill forward onto the next room assignment. This makes
-- the reminder visible on the normal housekeeping/manager workflow instead of
-- relying on somebody remembering yesterday's approval popup.
create or replace function public.attach_pending_minibar_refill_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pending_date date;
  marker constant text := '[MINIBAR_REFILL_PENDING]';
  reminder text;
begin
  select max((coalesce(refill_blocked_at, usage_date))::date)
    into pending_date
  from public.room_minibar_usage
  where room_id = new.room_id
    and is_cleared = false
    and refill_status = 'blocked_guest_inside';

  if pending_date is not null and position(marker in coalesce(new.notes, '')) = 0 then
    reminder := marker
      || ' Minibar was not refilled on ' || to_char(pending_date, 'YYYY-MM-DD')
      || ' because the guest was inside / room access was blocked. Refill when access is possible. '
      || 'The minibar charge was already confirmed in Previo — do not charge it again.';
    new.notes := concat_ws(E'\n', nullif(new.notes, ''), reminder);
  end if;

  return new;
end;
$$;

drop trigger if exists room_assignments_pending_minibar_refill_note on public.room_assignments;
create trigger room_assignments_pending_minibar_refill_note
before insert on public.room_assignments
for each row
execute function public.attach_pending_minibar_refill_note();

-- Once the minibar is physically refilled (or a checkout sweep resolves the
-- outstanding row), remove the generated reminder from any still-active room
-- assignment so the team is not sent back unnecessarily.
create or replace function public.clear_pending_minibar_refill_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.refill_status = 'blocked_guest_inside'
     and (new.is_cleared = true or new.refill_status is distinct from 'blocked_guest_inside')
     and not exists (
       select 1
       from public.room_minibar_usage other_usage
       where other_usage.room_id = new.room_id
         and other_usage.id <> new.id
         and other_usage.is_cleared = false
         and other_usage.refill_status = 'blocked_guest_inside'
     ) then
    update public.room_assignments
       set notes = nullif(
         btrim(
           regexp_replace(
             coalesce(notes, ''),
             E'(^|\\n)\\[MINIBAR_REFILL_PENDING\\][^\\n]*',
             '',
             'g'
           )
         ),
         ''
       )
     where room_id = new.room_id
       and status in ('assigned', 'in_progress', 'dnd_pending_retry')
       and notes like '%[MINIBAR_REFILL_PENDING]%';
  end if;

  return new;
end;
$$;

drop trigger if exists room_minibar_usage_clear_refill_note on public.room_minibar_usage;
create trigger room_minibar_usage_clear_refill_note
after update of is_cleared, refill_status on public.room_minibar_usage
for each row
execute function public.clear_pending_minibar_refill_note();
