-- Hotel-scoped security and state integrity for reception/housekeeping guest-item
-- handovers. Legacy housekeeping_notes policies are intentionally left intact for
-- other note types; restrictive policies below apply only to guest_request rows.

create or replace function public.can_access_guest_request_room(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.rooms r
    join public.profiles p on p.id = auth.uid()
    where r.id = p_room_id
      and p.deleted_at is null
      and p.organization_slug = r.organization_slug
      and (
        public.is_super_admin(auth.uid())
        or p.role in (
          'admin'::public.user_role,
          'top_management'::public.user_role,
          'top_management_manager'::public.user_role
        )
        or (
          p.role in (
            'reception'::public.user_role,
            'front_office'::public.user_role,
            'reception_manager'::public.user_role,
            'manager'::public.user_role,
            'housekeeping'::public.user_role,
            'housekeeping_manager'::public.user_role,
            'supervisor'::public.user_role
          )
          and (
            p.assigned_hotel = r.hotel
            or p.hotel_id = r.hotel
            or exists (
              select 1
              from public.hotel_configurations hc
              where (hc.hotel_id = r.hotel or hc.hotel_name = r.hotel)
                and (
                  p.assigned_hotel = hc.hotel_id
                  or p.assigned_hotel = hc.hotel_name
                  or p.hotel_id = hc.hotel_id
                  or p.hotel_id = hc.hotel_name
                )
            )
          )
        )
      )
  );
$$;

revoke all on function public.can_access_guest_request_room(uuid) from public;
grant execute on function public.can_access_guest_request_room(uuid) to authenticated;

-- Add explicit permissive access for the cross-department handover roles.
create policy "Guest request staff can view hotel-scoped handovers"
on public.housekeeping_notes
for select to authenticated
using (
  note_type = 'guest_request'
  and public.can_access_guest_request_room(room_id)
);

create policy "Guest request staff can create hotel-scoped handovers"
on public.housekeeping_notes
for insert to authenticated
with check (
  note_type = 'guest_request'
  and created_by = auth.uid()
  and public.can_access_guest_request_room(room_id)
  and public.get_user_role(auth.uid()) in (
    'reception'::public.user_role,
    'front_office'::public.user_role,
    'reception_manager'::public.user_role,
    'manager'::public.user_role,
    'admin'::public.user_role,
    'top_management'::public.user_role,
    'top_management_manager'::public.user_role,
    'housekeeping'::public.user_role,
    'housekeeping_manager'::public.user_role,
    'supervisor'::public.user_role
  )
);

create policy "Guest request staff can advance hotel-scoped handovers"
on public.housekeeping_notes
for update to authenticated
using (
  note_type = 'guest_request'
  and public.can_access_guest_request_room(room_id)
  and public.get_user_role(auth.uid()) in (
    'reception'::public.user_role,
    'front_office'::public.user_role,
    'reception_manager'::public.user_role,
    'manager'::public.user_role,
    'admin'::public.user_role,
    'top_management'::public.user_role,
    'top_management_manager'::public.user_role,
    'housekeeping'::public.user_role,
    'housekeeping_manager'::public.user_role,
    'supervisor'::public.user_role
  )
)
with check (
  note_type = 'guest_request'
  and public.can_access_guest_request_room(room_id)
);

-- Restrictive policies are ANDed with all permissive policies. They prevent the
-- older broad housekeeping_notes policies from leaking guest-request rows across
-- hotels while preserving those legacy policies for every other note type.
create policy "Guest requests require hotel scope for reads"
as restrictive
on public.housekeeping_notes
for select to authenticated
using (
  note_type <> 'guest_request'
  or public.can_access_guest_request_room(room_id)
);

create policy "Guest requests require hotel scope for inserts"
as restrictive
on public.housekeeping_notes
for insert to authenticated
with check (
  note_type <> 'guest_request'
  or (
    created_by = auth.uid()
    and public.can_access_guest_request_room(room_id)
  )
);

create policy "Guest requests require hotel scope for updates"
as restrictive
on public.housekeeping_notes
for update to authenticated
using (
  note_type <> 'guest_request'
  or public.can_access_guest_request_room(room_id)
)
with check (
  note_type <> 'guest_request'
  or public.can_access_guest_request_room(room_id)
);

create policy "Guest request audit rows cannot be deleted"
as restrictive
on public.housekeeping_notes
for delete to authenticated
using (note_type <> 'guest_request');

create or replace function public.validate_guest_request_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_new jsonb;
  v_old jsonb;
  v_role public.user_role;
  v_status text;
  v_old_status text;
  v_requires_return boolean;
  v_quantity integer;
  v_events jsonb;
  v_old_events jsonb;
  v_event_count integer;
  v_old_event_count integer;
  v_i integer;
  v_last_event jsonb;
  v_claim_role text := current_setting('request.jwt.claim.role', true);
begin
  if coalesce(new.note_type, old.note_type) <> 'guest_request' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.room_id is distinct from old.room_id
       or new.assignment_id is distinct from old.assignment_id
       or new.note_type is distinct from old.note_type
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.organization_slug is distinct from old.organization_slug then
      raise exception 'Guest request identity and audit fields are immutable';
    end if;
  end if;

  select * into v_room from public.rooms where id = new.room_id;
  if not found then
    raise exception 'Guest request room not found';
  end if;

  if auth.uid() is not null and v_claim_role <> 'service_role' then
    if not public.can_access_guest_request_room(new.room_id) then
      raise exception 'Guest request room access denied';
    end if;
    v_role := public.get_user_role(auth.uid());
  end if;

  new.organization_slug := v_room.organization_slug;

  if tg_op = 'INSERT' then
    if auth.uid() is not null and v_claim_role <> 'service_role' then
      new.created_by := auth.uid();
    end if;
    if new.assignment_id is not null and not exists (
      select 1
      from public.room_assignments ra
      where ra.id = new.assignment_id
        and ra.room_id = new.room_id
        and ra.organization_slug = v_room.organization_slug
    ) then
      raise exception 'Guest request assignment does not belong to the room';
    end if;
  end if;

  if octet_length(new.content) > 8192 then
    raise exception 'Guest request payload is too large';
  end if;

  begin
    v_new := new.content::jsonb;
  exception when others then
    raise exception 'Guest request content must be valid JSON';
  end;
  if jsonb_typeof(v_new) <> 'object' then
    raise exception 'Guest request payload must be a JSON object';
  end if;

  if coalesce((v_new ->> 'version')::integer, 0) <> 1 then
    raise exception 'Unsupported guest request payload version';
  end if;

  if coalesce(v_new ->> 'requestType', '') not in (
    'extra_towels','extra_pillow','blanket','baby_cot','iron','amenities','other'
  ) then
    raise exception 'Invalid guest request item type';
  end if;

  if coalesce(v_new ->> 'workDate', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Guest request work date is invalid';
  end if;

  if length(coalesce(v_new ->> 'label', '')) < 1
     or length(v_new ->> 'label') > 100 then
    raise exception 'Guest request label is invalid';
  end if;
  if length(coalesce(v_new ->> 'detail', '')) > 1000 then
    raise exception 'Guest request detail is too long';
  end if;

  begin
    v_quantity := (v_new ->> 'quantity')::integer;
  exception when others then
    raise exception 'Guest request quantity is invalid';
  end;
  if v_quantity < 1 or v_quantity > 20 then
    raise exception 'Guest request quantity must be between 1 and 20';
  end if;

  v_status := coalesce(v_new ->> 'status', '');
  if v_status not in ('requested','delivered','returned','resolved') then
    raise exception 'Invalid guest request status';
  end if;
  v_requires_return := coalesce((v_new ->> 'requiresReturn')::boolean, false);
  v_events := v_new -> 'events';
  if jsonb_typeof(v_events) <> 'array' then
    raise exception 'Guest request events must be an array';
  end if;
  v_event_count := jsonb_array_length(v_events);
  if v_event_count < 1 or v_event_count > 30 then
    raise exception 'Guest request event history is invalid';
  end if;
  v_last_event := v_events -> (v_event_count - 1);
  if coalesce(v_last_event ->> 'status', '') <> v_status then
    raise exception 'Guest request status must match the latest event';
  end if;
  if auth.uid() is not null and v_claim_role <> 'service_role'
     and coalesce(v_last_event ->> 'actorId', '') <> auth.uid()::text then
    raise exception 'Latest guest request event must identify the authenticated user';
  end if;
  if coalesce(v_last_event ->> 'at', '') = '' then
    raise exception 'Guest request event timestamp is required';
  end if;

  if tg_op = 'INSERT' then
    if v_event_count > 2 then
      raise exception 'New guest requests cannot contain arbitrary history';
    end if;

    if v_status = 'delivered' and auth.uid() is not null and v_claim_role <> 'service_role'
       and v_role not in (
         'reception'::public.user_role,
         'front_office'::public.user_role,
         'reception_manager'::public.user_role,
         'manager'::public.user_role,
         'admin'::public.user_role,
         'top_management'::public.user_role,
         'top_management_manager'::public.user_role,
         'housekeeping_manager'::public.user_role,
         'supervisor'::public.user_role
       ) then
      raise exception 'Only eligible reception/management users can record an immediate guest handover';
    end if;

    if v_status not in ('requested','delivered','resolved') then
      raise exception 'Invalid initial guest request status';
    end if;
    if v_status = 'resolved' and v_requires_return then
      raise exception 'Returnable guest items cannot be resolved at handover';
    end if;
  else
    begin
      v_old := old.content::jsonb;
    exception when others then
      raise exception 'Existing guest request payload is invalid';
    end;
    v_old_status := coalesce(v_old ->> 'status', '');
    v_old_events := v_old -> 'events';
    v_old_event_count := jsonb_array_length(v_old_events);

    -- Item identity is immutable after creation. An update may only append one
    -- event and advance the workflow state.
    if v_new ->> 'version' is distinct from v_old ->> 'version'
       or v_new ->> 'workDate' is distinct from v_old ->> 'workDate'
       or v_new ->> 'requestType' is distinct from v_old ->> 'requestType'
       or v_new ->> 'label' is distinct from v_old ->> 'label'
       or v_new ->> 'quantity' is distinct from v_old ->> 'quantity'
       or v_new ->> 'requiresReturn' is distinct from v_old ->> 'requiresReturn'
       or coalesce(v_new ->> 'detail','') is distinct from coalesce(v_old ->> 'detail','') then
      raise exception 'Guest request item details are immutable after creation';
    end if;

    if v_event_count <> v_old_event_count + 1 then
      raise exception 'Guest request updates must append exactly one event';
    end if;
    if v_old_event_count > 0 then
      for v_i in 0..v_old_event_count - 1 loop
        if v_events -> v_i is distinct from v_old_events -> v_i then
          raise exception 'Guest request history is append-only';
        end if;
      end loop;
    end if;

    if not (
      (v_old_status = 'requested' and v_status = 'delivered')
      or (v_old_status = 'delivered' and v_requires_return and v_status = 'returned')
      or (v_old_status = 'delivered' and not v_requires_return and v_status = 'resolved')
    ) then
      raise exception 'Invalid guest request transition: % -> %', v_old_status, v_status;
    end if;
  end if;

  if v_status in ('returned','resolved') then
    new.is_resolved := true;
    if auth.uid() is not null and v_claim_role <> 'service_role' then
      new.resolved_by := auth.uid();
      new.resolved_at := now();
    elsif new.resolved_at is null then
      new.resolved_at := now();
    end if;
  else
    new.is_resolved := false;
    new.resolved_by := null;
    new.resolved_at := null;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_guest_request_note() from public;

drop trigger if exists validate_guest_request_note_trigger on public.housekeeping_notes;
create trigger validate_guest_request_note_trigger
before insert or update on public.housekeeping_notes
for each row execute function public.validate_guest_request_note();

create index if not exists housekeeping_notes_guest_request_room_open_idx
  on public.housekeeping_notes (room_id, created_at desc)
  where note_type = 'guest_request' and is_resolved = false;