-- Unify HotelCare maintenance around public.tickets while keeping legacy
-- maintenance_issues compatible with older clients and historical records.

alter table public.tickets
  add column if not exists source text not null default 'manual',
  add column if not exists source_room_id uuid references public.rooms(id) on delete set null,
  add column if not exists source_assignment_id uuid references public.room_assignments(id) on delete set null,
  add column if not exists legacy_maintenance_issue_id uuid references public.maintenance_issues(id) on delete set null,
  add column if not exists forwarded_at timestamptz,
  add column if not exists assignment_method text;

create unique index if not exists tickets_legacy_maintenance_issue_uidx
  on public.tickets(legacy_maintenance_issue_id)
  where legacy_maintenance_issue_id is not null;

create index if not exists tickets_maintenance_queue_idx
  on public.tickets(organization_slug, hotel, status, assigned_to, created_at)
  where department = 'maintenance';

-- Resolve both hotel IDs and display names so profiles configured with either
-- representation still match the correct property.
create or replace function public.maintenance_hotel_matches(
  _profile_hotel text,
  _ticket_hotel text,
  _organization_slug text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when _profile_hotel is null or _ticket_hotel is null then false
    when _profile_hotel = _ticket_hotel then true
    else exists (
      select 1
      from public.hotel_configurations a
      join public.organizations o on o.id = a.organization_id
      where o.slug = _organization_slug
        and a.is_active = true
        and (_profile_hotel = a.hotel_id or _profile_hotel = a.hotel_name)
        and (_ticket_hotel = a.hotel_id or _ticket_hotel = a.hotel_name)
    )
  end;
$$;

-- Pick the maintenance employee who is actually checked in today at this
-- property. If more than one is on duty, balance by the smallest active queue,
-- then by earliest check-in.
create or replace function public.pick_active_maintenance_staff(
  _hotel text,
  _organization_slug text
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  selected_id uuid;
begin
  select p.id
  into selected_id
  from public.profiles p
  join public.staff_attendance a
    on a.user_id = p.id
   and a.work_date = (now() at time zone 'Europe/Budapest')::date
   and a.status = 'checked_in'
  where p.organization_slug = _organization_slug
    and p.role = 'maintenance'::public.user_role
    and p.deleted_at is null
    and public.maintenance_hotel_matches(p.assigned_hotel, _hotel, _organization_slug)
  order by (
    select count(*)
    from public.tickets t
    where t.assigned_to = p.id
      and t.department = 'maintenance'
      and t.status <> 'completed'::public.ticket_status
  ) asc,
  a.check_in_time asc nulls last,
  p.full_name asc
  limit 1;

  return selected_id;
end;
$$;

-- Secure staff selector used by the formal ticket form. It deliberately returns
-- all eligible maintenance staff for the caller's organization/property, plus
-- their live attendance state, so manual assignment remains possible even when
-- a person is not currently checked in.
create or replace function public.get_maintenance_staff_for_hotel(
  _hotel text,
  _signed_in_only boolean default false
)
returns table(
  id uuid,
  full_name text,
  role text,
  assigned_hotel text,
  is_signed_in boolean,
  checked_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller_org text;
begin
  select p.organization_slug into caller_org
  from public.profiles p
  where p.id = auth.uid()
    and p.deleted_at is null;

  if caller_org is null then
    return;
  end if;

  return query
  select
    p.id,
    p.full_name,
    p.role::text,
    p.assigned_hotel,
    (a.id is not null) as is_signed_in,
    a.check_in_time as checked_in_at
  from public.profiles p
  left join public.staff_attendance a
    on a.user_id = p.id
   and a.work_date = (now() at time zone 'Europe/Budapest')::date
   and a.status = 'checked_in'
  where p.organization_slug = caller_org
    and p.role in ('maintenance'::public.user_role, 'maintenance_manager'::public.user_role)
    and p.deleted_at is null
    and (_hotel is null or public.maintenance_hotel_matches(p.assigned_hotel, _hotel, caller_org))
    and (not _signed_in_only or a.id is not null)
  order by (a.id is not null) desc, p.full_name asc;
end;
$$;

grant execute on function public.get_maintenance_staff_for_hotel(text, boolean) to authenticated;

-- Every maintenance ticket gets an SLA and, when no assignee was explicitly
-- chosen, the on-duty maintenance employee for that hotel.
create or replace function public.auto_assign_maintenance_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  picked uuid;
begin
  if new.department = 'maintenance' then
    if new.sla_due_date is null then
      new.sla_due_date := now() + case new.priority
        when 'urgent'::public.ticket_priority then interval '4 hours'
        when 'high'::public.ticket_priority then interval '24 hours'
        when 'low'::public.ticket_priority then interval '168 hours'
        else interval '72 hours'
      end;
    end if;

    if new.assigned_to is null
       and coalesce(new.source, 'manual') <> 'housekeeping_legacy_backfill' then
      picked := public.pick_active_maintenance_staff(new.hotel, new.organization_slug);
      if picked is not null then
        new.assigned_to := picked;
        new.assignment_method := 'auto_attendance';
        new.forwarded_at := coalesce(new.forwarded_at, now());
      else
        new.assignment_method := coalesce(new.assignment_method, 'unassigned_no_staff_on_duty');
      end if;
    elsif new.assigned_to is not null then
      new.assignment_method := coalesce(new.assignment_method, 'manual');
      new.forwarded_at := coalesce(new.forwarded_at, now());
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_auto_assign_maintenance_ticket on public.tickets;
create trigger trg_auto_assign_maintenance_ticket
before insert or update of department, hotel, assigned_to, organization_slug, priority
on public.tickets
for each row
execute function public.auto_assign_maintenance_ticket();

-- When a maintenance employee signs in, pick up the unassigned open queue for
-- their own property. This handles tickets created before their shift started.
create or replace function public.assign_waiting_maintenance_on_checkin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  staff_profile public.profiles%rowtype;
begin
  if new.status <> 'checked_in'
     or new.work_date <> (now() at time zone 'Europe/Budapest')::date then
    return new;
  end if;

  select * into staff_profile
  from public.profiles p
  where p.id = new.user_id
    and p.role = 'maintenance'::public.user_role
    and p.deleted_at is null;

  if staff_profile.id is null then
    return new;
  end if;

  update public.tickets t
  set assigned_to = staff_profile.id,
      assignment_method = 'auto_on_checkin',
      forwarded_at = coalesce(t.forwarded_at, now()),
      updated_at = now()
  where t.department = 'maintenance'
    and t.organization_slug = staff_profile.organization_slug
    and t.status = 'open'::public.ticket_status
    and t.assigned_to is null
    and coalesce(t.pending_supervisor_approval, false) = false
    and coalesce(t.source, 'manual') <> 'housekeeping_legacy_backfill'
    and public.maintenance_hotel_matches(staff_profile.assigned_hotel, t.hotel, staff_profile.organization_slug);

  return new;
end;
$$;

drop trigger if exists trg_assign_waiting_maintenance_on_checkin on public.staff_attendance;
create trigger trg_assign_waiting_maintenance_on_checkin
after insert or update of status
on public.staff_attendance
for each row
execute function public.assign_waiting_maintenance_on_checkin();

-- Housekeeping/mobile entry point. This validates organization/property server
-- side and writes directly into the same tickets table used by the formal
-- Maintenance module and MaintenanceStaffView.
create or replace function public.create_housekeeping_maintenance_ticket(
  _room_id uuid,
  _assignment_id uuid,
  _description text,
  _priority text default 'medium',
  _photo_urls text[] default '{}'::text[]
)
returns table(
  id uuid,
  ticket_number text,
  assigned_to uuid,
  assignee_name text,
  hotel text,
  assignment_method text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller public.profiles%rowtype;
  target_room public.rooms%rowtype;
  inserted public.tickets%rowtype;
  normalized_priority public.ticket_priority;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into caller
  from public.profiles p
  where p.id = auth.uid()
    and p.deleted_at is null;

  if caller.id is null or caller.organization_slug is null then
    raise exception 'Profile or organization not available';
  end if;

  select * into target_room
  from public.rooms r
  where r.id = _room_id
    and r.organization_slug = caller.organization_slug;

  if target_room.id is null then
    raise exception 'Room is not available in your organization';
  end if;

  if caller.assigned_hotel is not null
     and not public.maintenance_hotel_matches(caller.assigned_hotel, target_room.hotel, caller.organization_slug)
     and caller.role not in (
       'admin'::public.user_role,
       'top_management'::public.user_role,
       'top_management_manager'::public.user_role
     ) then
    raise exception 'Room is outside your assigned hotel';
  end if;

  if nullif(btrim(_description), '') is null then
    raise exception 'Issue description is required';
  end if;

  normalized_priority := case lower(coalesce(_priority, 'medium'))
    when 'urgent' then 'urgent'::public.ticket_priority
    when 'high' then 'high'::public.ticket_priority
    when 'low' then 'low'::public.ticket_priority
    else 'medium'::public.ticket_priority
  end;

  insert into public.tickets (
    ticket_number,
    title,
    description,
    room_number,
    priority,
    status,
    created_by,
    assigned_to,
    hotel,
    attachment_urls,
    category,
    department,
    organization_slug,
    source,
    source_room_id,
    source_assignment_id
  ) values (
    'MNT-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
    'Room ' || target_room.room_number || ': ' || left(btrim(_description), 80),
    btrim(_description),
    target_room.room_number,
    normalized_priority,
    'open'::public.ticket_status,
    caller.id,
    null,
    target_room.hotel,
    coalesce(_photo_urls, '{}'::text[]),
    'housekeeping_escalation',
    'maintenance',
    caller.organization_slug,
    'housekeeping',
    target_room.id,
    _assignment_id
  )
  returning * into inserted;

  return query
  select inserted.id,
         inserted.ticket_number,
         inserted.assigned_to,
         p.full_name,
         inserted.hotel,
         inserted.assignment_method
  from (select 1) x
  left join public.profiles p on p.id = inserted.assigned_to;
end;
$$;

grant execute on function public.create_housekeeping_maintenance_ticket(uuid, uuid, text, text, text[]) to authenticated;

-- Older app builds still write maintenance_issues. Bridge those inserts into
-- tickets so mixed-version mobile clients stay synchronized during rollout.
create or replace function public.bridge_maintenance_issue_to_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.rooms%rowtype;
  normalized_priority public.ticket_priority;
begin
  if exists (
    select 1 from public.tickets t where t.legacy_maintenance_issue_id = new.id
  ) then
    return new;
  end if;

  select * into target_room from public.rooms where id = new.room_id;
  if target_room.id is null then
    return new;
  end if;

  normalized_priority := case lower(coalesce(new.priority, 'medium'))
    when 'urgent' then 'urgent'::public.ticket_priority
    when 'high' then 'high'::public.ticket_priority
    when 'low' then 'low'::public.ticket_priority
    else 'medium'::public.ticket_priority
  end;

  insert into public.tickets (
    ticket_number, title, description, room_number, priority, status,
    created_by, assigned_to, hotel, attachment_urls, category, department,
    organization_slug, source, source_room_id, source_assignment_id,
    legacy_maintenance_issue_id, created_at, updated_at
  ) values (
    'MNT-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
    'Room ' || target_room.room_number || ': ' || left(btrim(new.issue_description), 80),
    new.issue_description,
    target_room.room_number,
    normalized_priority,
    case when new.status in ('resolved', 'completed') then 'completed'::public.ticket_status else 'open'::public.ticket_status end,
    new.reported_by,
    null,
    target_room.hotel,
    coalesce(new.photo_urls, '{}'::text[]),
    'housekeeping_escalation',
    'maintenance',
    coalesce(new.organization_slug, target_room.organization_slug),
    'housekeeping_legacy_bridge',
    new.room_id,
    new.assignment_id,
    new.id,
    new.created_at,
    new.updated_at
  )
  on conflict (legacy_maintenance_issue_id) where legacy_maintenance_issue_id is not null do nothing;

  return new;
end;
$$;

drop trigger if exists trg_bridge_maintenance_issue_to_ticket on public.maintenance_issues;
create trigger trg_bridge_maintenance_issue_to_ticket
after insert on public.maintenance_issues
for each row
execute function public.bridge_maintenance_issue_to_ticket();

-- Keep legacy status/history in step when a linked ticket is progressed from the
-- unified UI. This preserves the old housekeeping maintenance history safely.
create or replace function public.sync_ticket_to_legacy_maintenance_issue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.legacy_maintenance_issue_id is null then
    return new;
  end if;

  update public.maintenance_issues mi
  set status = case
        when new.status = 'completed'::public.ticket_status then 'resolved'
        when new.status = 'in_progress'::public.ticket_status then 'in_progress'
        else 'pending'
      end,
      resolution_text = new.resolution_text,
      resolved_at = case when new.status = 'completed'::public.ticket_status then coalesce(new.closed_at, now()) else null end,
      resolved_by = case when new.status = 'completed'::public.ticket_status then coalesce(new.closed_by, new.assigned_to) else null end,
      updated_at = now()
  where mi.id = new.legacy_maintenance_issue_id
    and (
      mi.status is distinct from case
        when new.status = 'completed'::public.ticket_status then 'resolved'
        when new.status = 'in_progress'::public.ticket_status then 'in_progress'
        else 'pending'
      end
      or mi.resolution_text is distinct from new.resolution_text
      or (new.status = 'completed'::public.ticket_status and mi.resolved_at is null)
    );

  return new;
end;
$$;

drop trigger if exists trg_sync_ticket_to_legacy_maintenance_issue on public.tickets;
create trigger trg_sync_ticket_to_legacy_maintenance_issue
after update of status, resolution_text, closed_at, closed_by, assigned_to
on public.tickets
for each row
execute function public.sync_ticket_to_legacy_maintenance_issue();

-- Backfill the seven existing housekeeping maintenance reports into the unified
-- ticket history without auto-assigning old/stale records to today's worker.
insert into public.tickets (
  ticket_number, title, description, room_number, priority, status,
  created_by, assigned_to, hotel, attachment_urls, category, department,
  organization_slug, source, source_room_id, source_assignment_id,
  legacy_maintenance_issue_id, resolution_text, closed_at, closed_by,
  created_at, updated_at, assignment_method
)
select
  'LEG-MNT-' || upper(substr(replace(mi.id::text, '-', ''), 1, 12)),
  'Room ' || coalesce(r.room_number, 'N/A') || ': ' || left(btrim(mi.issue_description), 80),
  mi.issue_description,
  coalesce(r.room_number, 'N/A'),
  case lower(coalesce(mi.priority, 'medium'))
    when 'urgent' then 'urgent'::public.ticket_priority
    when 'high' then 'high'::public.ticket_priority
    when 'low' then 'low'::public.ticket_priority
    else 'medium'::public.ticket_priority
  end,
  case when mi.status in ('resolved', 'completed') then 'completed'::public.ticket_status else 'open'::public.ticket_status end,
  mi.reported_by,
  null,
  r.hotel,
  coalesce(mi.photo_urls, '{}'::text[]),
  'housekeeping_escalation',
  'maintenance',
  coalesce(mi.organization_slug, r.organization_slug),
  'housekeeping_legacy_backfill',
  mi.room_id,
  mi.assignment_id,
  mi.id,
  mi.resolution_text,
  mi.resolved_at,
  mi.resolved_by,
  mi.created_at,
  mi.updated_at,
  'legacy_backfill'
from public.maintenance_issues mi
left join public.rooms r on r.id = mi.room_id
where not exists (
  select 1 from public.tickets t where t.legacy_maintenance_issue_id = mi.id
);
