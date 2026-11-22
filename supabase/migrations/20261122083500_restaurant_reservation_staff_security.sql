-- Restaurant staff actions must be attributable to a verified signed-in user.
-- Apply BEFORE deploying the secured /bb reservation Edge Functions.
alter table public.restaurant_reservations
  add column if not exists status_marked_user_id uuid;

create table if not exists public.restaurant_reservation_staff_events (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.restaurant_reservations(id) on delete cascade,
  hotel_id text not null,
  actor_user_id uuid,
  actor_name text,
  action text not null check (action in ('status_changed', 'first_seen')),
  previous_status text,
  new_status text,
  created_at timestamptz not null default now()
);

create index if not exists restaurant_staff_events_reservation_created_idx
  on public.restaurant_reservation_staff_events (reservation_id, created_at desc);
create index if not exists restaurant_staff_events_hotel_created_idx
  on public.restaurant_reservation_staff_events (hotel_id, created_at desc);

alter table public.restaurant_reservation_staff_events enable row level security;
-- No anon/authenticated policies: Edge Functions record these events through
-- their verified service-role client, and never expose this table to guests.
revoke all on public.restaurant_reservation_staff_events from public, anon, authenticated;
grant select, insert on public.restaurant_reservation_staff_events to service_role;

create or replace function public.audit_restaurant_reservation_staff_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.restaurant_reservation_staff_events
      (reservation_id, hotel_id, actor_user_id, actor_name,
       action, previous_status, new_status)
    values (
      new.id, new.hotel_id::text,
      -- Upstream webhook updates do not create a new staff mark timestamp.
      case when new.status_marked_at is distinct from old.status_marked_at
        then new.status_marked_user_id else null end,
      case when new.status_marked_at is distinct from old.status_marked_at
        then new.status_marked_by else null end,
      'status_changed', old.status, new.status
    );
  end if;

  if old.first_seen_at is null and new.first_seen_at is not null then
    insert into public.restaurant_reservation_staff_events
      (reservation_id, hotel_id, actor_user_id, actor_name, action,
       previous_status, new_status)
    values (new.id, new.hotel_id::text, new.first_seen_by, null,
            'first_seen', old.status, new.status);
  end if;
  return new;
end;
$$;

revoke all on function public.audit_restaurant_reservation_staff_changes() from public, anon, authenticated;

drop trigger if exists trg_audit_restaurant_reservation_staff_changes on public.restaurant_reservations;
create trigger trg_audit_restaurant_reservation_staff_changes
  after update of status, first_seen_at on public.restaurant_reservations
  for each row
  execute function public.audit_restaurant_reservation_staff_changes();

comment on table public.restaurant_reservation_staff_events
  is 'Append-only record of verified restaurant staff status changes and first-seen events. Access only through server-authorized tools.';
