-- Per-property future room instructions. PMS sync never owns this table.
create table if not exists public.room_planned_notes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  organization_slug text,
  hotel text not null,
  start_date date not null,
  end_date date not null,
  selected_dates date[],
  instruction_type text not null default 'general',
  content text not null check (length(btrim(content)) > 0),
  status text not null default 'active' check (status in ('active','cancelled','completed')),
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_planned_notes_dates check (end_date >= start_date)
);

create index if not exists room_planned_notes_room_dates_idx
  on public.room_planned_notes(room_id, start_date, end_date) where status = 'active';
create index if not exists room_planned_notes_hotel_dates_idx
  on public.room_planned_notes(hotel, start_date, end_date) where status = 'active';

create table if not exists public.room_planned_note_history (
  id uuid primary key default gen_random_uuid(),
  planned_note_id uuid not null references public.room_planned_notes(id) on delete cascade,
  action text not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  snapshot jsonb not null
);

alter table public.room_planned_notes enable row level security;
alter table public.room_planned_note_history enable row level security;

-- Reuse room visibility as the source of truth for property isolation. The
-- subquery is subject to rooms RLS, so a user cannot cross property/tenant
-- boundaries merely by guessing a room UUID.
create policy "planned notes visible with room"
on public.room_planned_notes for select to authenticated
using (exists (select 1 from public.rooms r where r.id = room_planned_notes.room_id));

create policy "eligible staff create planned notes"
on public.room_planned_notes for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (select 1 from public.rooms r where r.id = room_planned_notes.room_id)
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role,'')) in ('admin','top_management','top_management_manager','manager','housekeeping_manager','supervisor','reception','front_office','reception_manager')
  )
);

create policy "eligible staff update planned notes"
on public.room_planned_notes for update to authenticated
using (
  exists (select 1 from public.rooms r where r.id = room_planned_notes.room_id)
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role,'')) in ('admin','top_management','top_management_manager','manager','housekeeping_manager','supervisor','reception','front_office','reception_manager')
  )
)
with check (
  exists (select 1 from public.rooms r where r.id = room_planned_notes.room_id)
);

create policy "planned note history visible with note"
on public.room_planned_note_history for select to authenticated
using (
  exists (
    select 1 from public.room_planned_notes n
    where n.id = room_planned_note_history.planned_note_id
  )
);

create or replace function public.prepare_room_planned_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r public.rooms%rowtype;
begin
  select * into r from public.rooms where id = new.room_id;
  if r.id is null then raise exception 'Room not found'; end if;
  new.hotel := r.hotel;
  -- Prefer a tenant marker on the physical room. Profile fallback is read via
  -- JSON so this migration remains compatible with deployments where profiles
  -- does not expose organization_slug as a typed column.
  new.organization_slug := coalesce(
    to_jsonb(r)->>'organization_slug',
    (select to_jsonb(p)->>'organization_slug' from public.profiles p where p.id = auth.uid())
  );
  new.updated_by := auth.uid();
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  return new;
end $$;

-- A planned instruction belongs to one physical room for its entire life.
-- This prevents an update from being used to move data across properties.
create or replace function public.guard_room_planned_note_room()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.room_id is distinct from old.room_id then
    raise exception 'Planned room instructions cannot be moved between rooms';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_room_planned_note_room on public.room_planned_notes;
create trigger trg_guard_room_planned_note_room
before update on public.room_planned_notes
for each row execute function public.guard_room_planned_note_room();

drop trigger if exists trg_prepare_room_planned_note on public.room_planned_notes;
create trigger trg_prepare_room_planned_note
before insert or update on public.room_planned_notes
for each row execute function public.prepare_room_planned_note();

create or replace function public.audit_room_planned_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.room_planned_note_history(planned_note_id, action, changed_by, snapshot)
  values (
    new.id,
    case when tg_op='INSERT' then 'created' else 'updated' end,
    auth.uid(),
    to_jsonb(new)
  );
  return new;
end $$;

drop trigger if exists trg_audit_room_planned_note on public.room_planned_notes;
create trigger trg_audit_room_planned_note
after insert or update on public.room_planned_notes
for each row execute function public.audit_room_planned_note();

grant select, insert, update on public.room_planned_notes to authenticated;
grant select on public.room_planned_note_history to authenticated;
