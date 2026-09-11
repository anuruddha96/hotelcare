-- Parking Operations V2: reservation lookup, duplicate protection, unreported queue and email retry controls.

-- Keep the original issue transaction as an internal core, then place duplicate
-- protection in front of it. This preserves the existing event/audit/outbox flow.
alter function public.parking_issue_ticket(text,text,text,date,date,text,text,text,text)
  rename to parking_issue_ticket_core;
revoke all on function public.parking_issue_ticket_core(text,text,text,date,date,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.parking_issue_ticket_core(text,text,text,date,date,text,text,text,text)
  to service_role;

create or replace function public.parking_find_duplicate_ticket(
  _organization_slug text,
  _hotel_id text,
  _valid_from date,
  _valid_to date,
  _reservation_ref text default null,
  _guest_name text default null,
  _room_number text default null
) returns setof public.parking_tickets
language plpgsql stable security definer set search_path=public as $$
declare
  v_reservation text := nullif(btrim(_reservation_ref),'');
  v_guest text := nullif(btrim(_guest_name),'');
  v_room text := nullif(btrim(_room_number),'');
begin
  if auth.uid() is null or public.parking_access_level(_organization_slug,_hotel_id)='none' then
    raise exception 'You cannot access parking tickets at this hotel' using errcode='42501';
  end if;
  if _valid_from is null or _valid_to is null or _valid_to < _valid_from then
    return;
  end if;
  if v_reservation is null and (v_guest is null or v_room is null) then
    return;
  end if;

  return query
  select t.*
  from public.parking_tickets t
  where t.organization_slug=_organization_slug
    and t.hotel_id=_hotel_id
    and t.status='issued'
    and t.valid_from <= _valid_to
    and t.valid_to >= _valid_from
    and (
      (v_reservation is not null and t.reservation_search=public.parking_normalize_reference(v_reservation))
      or (
        v_reservation is null
        and v_guest is not null and v_room is not null
        and lower(btrim(coalesce(t.guest_name,'')))=lower(v_guest)
        and lower(btrim(coalesce(t.room_number,'')))=lower(v_room)
      )
    )
  order by t.updated_at desc
  limit 1;
end $$;
revoke all on function public.parking_find_duplicate_ticket(text,text,date,date,text,text,text) from public,anon;
grant execute on function public.parking_find_duplicate_ticket(text,text,date,date,text,text,text) to authenticated,service_role;

create function public.parking_issue_ticket(
  _organization_slug text,
  _hotel_id text,
  _reference text,
  _valid_from date,
  _valid_to date,
  _reservation_ref text default null,
  _guest_name text default null,
  _room_number text default null,
  _notes text default null
) returns public.parking_tickets
language plpgsql security definer set search_path=public as $$
declare
  v_duplicate public.parking_tickets%rowtype;
begin
  select * into v_duplicate
  from public.parking_find_duplicate_ticket(
    _organization_slug,_hotel_id,_valid_from,_valid_to,_reservation_ref,_guest_name,_room_number
  );
  if found then
    raise exception 'This guest/reservation already has overlapping parking ticket %. Review the existing ticket before issuing another one.', v_duplicate.reference;
  end if;

  return public.parking_issue_ticket_core(
    _organization_slug,_hotel_id,_reference,_valid_from,_valid_to,
    _reservation_ref,_guest_name,_room_number,_notes
  );
end $$;
revoke all on function public.parking_issue_ticket(text,text,text,date,date,text,text,text,text) from public,anon;
grant execute on function public.parking_issue_ticket(text,text,text,date,date,text,text,text,text) to authenticated,service_role;

-- Managers can deliberately issue a second overlapping ticket when a guest has
-- multiple vehicles. Ordinary reception users cannot bypass duplicate protection.
create or replace function public.parking_issue_ticket_with_email_override(
  _organization_slug text,
  _hotel_id text,
  _reference text,
  _valid_from date,
  _valid_to date,
  _reservation_ref text default null,
  _guest_name text default null,
  _room_number text default null,
  _notes text default null,
  _guest_email text default null,
  _allow_duplicate boolean default false
) returns public.parking_tickets
language plpgsql security definer set search_path=public as $$
declare
  t public.parking_tickets;
  e text := nullif(lower(btrim(_guest_email)),'');
begin
  if not coalesce(_allow_duplicate,false) then
    return public.parking_issue_ticket_with_email(
      _organization_slug,_hotel_id,_reference,_valid_from,_valid_to,
      _reservation_ref,_guest_name,_room_number,_notes,_guest_email
    );
  end if;

  if auth.uid() is null or public.parking_access_level(_organization_slug,_hotel_id) <> 'manage' then
    raise exception 'Only a hotel manager can approve an additional overlapping parking ticket' using errcode='42501';
  end if;
  if e is not null and (char_length(e)>254 or e !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$') then
    raise exception 'Enter a valid guest email';
  end if;
  if e is not null and not exists(
    select 1 from public.parking_settings
    where organization_slug=_organization_slug and hotel_id=_hotel_id and guest_email_enabled
  ) then
    raise exception 'Guest email is not enabled for this hotel';
  end if;

  select * into t
  from public.parking_tickets
  where organization_slug=_organization_slug and hotel_id=_hotel_id
    and reference_search=public.parking_normalize_reference(_reference)
  for update;
  if not found or t.status <> 'available' then
    raise exception 'Ticket is not available at this hotel';
  end if;

  update public.parking_tickets set guest_email=e where id=t.id;
  return public.parking_issue_ticket_core(
    _organization_slug,_hotel_id,_reference,_valid_from,_valid_to,
    _reservation_ref,_guest_name,_room_number,_notes
  );
end $$;
revoke all on function public.parking_issue_ticket_with_email_override(text,text,text,date,date,text,text,text,text,text,boolean) from public,anon;
grant execute on function public.parking_issue_ticket_with_email_override(text,text,text,date,date,text,text,text,text,text,boolean) to authenticated,service_role;

-- Scoped reservation lookup for reception. Only the minimum fields required to
-- issue a parking ticket are returned; no identity-document or payment data.
create or replace function public.parking_search_reservations(
  _organization_slug text,
  _hotel_id text,
  _query text,
  _limit integer default 12
) returns table(
  reservation_id uuid,
  reservation_number text,
  guest_name text,
  guest_email text,
  room_number text,
  check_in_date date,
  check_out_date date,
  reservation_status text,
  source text
)
language plpgsql stable security definer set search_path=public as $$
declare
  q text := lower(btrim(coalesce(_query,'')));
  qn text := public.parking_normalize_reference(_query);
begin
  if auth.uid() is null or public.parking_access_level(_organization_slug,_hotel_id)='none' then
    raise exception 'You cannot search reservations at this hotel' using errcode='42501';
  end if;
  if char_length(q) < 2 then
    return;
  end if;

  return query
  select
    r.id,
    r.reservation_number,
    coalesce(
      nullif(btrim(r.pms_guest_name),''),
      nullif(btrim(concat_ws(' ',g.first_name,g.last_name)),'')
    ) as guest_name,
    nullif(lower(btrim(g.email)),'') as guest_email,
    coalesce(room_direct.room_number, room_assignment.room_number) as room_number,
    r.check_in_date,
    r.check_out_date,
    r.status::text,
    r.source
  from public.reservations r
  left join public.guests g
    on g.id=r.guest_id
   and g.organization_slug=r.organization_slug
   and g.hotel_id=r.hotel_id
  left join public.rooms room_direct on room_direct.id=r.room_id
  left join lateral (
    select rm.room_number
    from public.reservation_room_assignments a
    join public.rooms rm on rm.id=a.room_id
    where a.reservation_id=r.id
    order by a.check_out_date desc nulls last, a.created_at desc
    limit 1
  ) room_assignment on true
  where r.organization_slug=_organization_slug
    and r.hotel_id=_hotel_id
    and (
      public.parking_normalize_reference(r.reservation_number) like '%'||qn||'%'
      or public.parking_normalize_reference(r.source_reservation_id) like '%'||qn||'%'
      or lower(coalesce(r.pms_guest_name,'')) like '%'||q||'%'
      or lower(btrim(concat_ws(' ',g.first_name,g.last_name))) like '%'||q||'%'
      or lower(coalesce(g.email,'')) like '%'||q||'%'
      or lower(coalesce(room_direct.room_number,room_assignment.room_number,'')) like '%'||q||'%'
    )
  order by
    case
      when r.check_in_date <= (now() at time zone 'Europe/Budapest')::date
       and r.check_out_date >= (now() at time zone 'Europe/Budapest')::date then 0
      when r.check_in_date > (now() at time zone 'Europe/Budapest')::date then 1
      else 2
    end,
    r.check_in_date desc nulls last,
    r.updated_at desc
  limit least(greatest(coalesce(_limit,12),1),25);
end $$;
revoke all on function public.parking_search_reservations(text,text,text,integer) from public,anon;
grant execute on function public.parking_search_reservations(text,text,text,integer) to authenticated,service_role;

-- Extend history search with a first-class manager work queue for expired
-- issued tickets that still need to be reported to the parking operator.
create or replace function public.parking_search_tickets(
  _organization_slug text,
  _hotel_id text,
  _query text default '',
  _status text default 'all',
  _limit integer default 100
) returns setof public.parking_tickets
language sql stable set search_path=public as $$
  select t.*
  from public.parking_tickets t
  where t.organization_slug = _organization_slug
    and t.hotel_id = _hotel_id
    and public.parking_access_level(t.organization_slug, t.hotel_id) <> 'none'
    and (
      public.parking_normalize_reference(_query) = ''
      or t.reference_search like '%' || public.parking_normalize_reference(_query) || '%'
      or t.reservation_search like '%' || public.parking_normalize_reference(_query) || '%'
      or lower(coalesce(t.guest_name, '')) like '%' || lower(btrim(_query)) || '%'
      or lower(coalesce(t.room_number, '')) like '%' || lower(btrim(_query)) || '%'
    )
    and case _status
      when 'available' then t.status = 'available'
      when 'issued' then t.status = 'issued' and t.valid_to >= (now() at time zone 'Europe/Budapest')::date
      when 'expired' then t.status = 'issued' and t.valid_to < (now() at time zone 'Europe/Budapest')::date
      when 'unreported' then t.status = 'issued'
        and t.valid_to < (now() at time zone 'Europe/Budapest')::date
        and t.cancellation_reported_at is null
      when 'void' then t.status = 'void'
      else true
    end
  order by
    case
      when t.reference_search = public.parking_normalize_reference(_query) then 0
      when t.reservation_search = public.parking_normalize_reference(_query) then 1
      else 2
    end,
    t.updated_at desc
  limit least(greatest(coalesce(_limit, 100), 1), 250)
$$;

-- Manual retry creates a fresh outbox attempt rather than mutating the original
-- failed/cancelled delivery record, preserving an accurate audit trail.
create or replace function public.parking_retry_email_job(_job_id uuid)
returns public.parking_email_jobs
language plpgsql security definer set search_path=public as $$
declare
  old_job public.parking_email_jobs%rowtype;
  new_job public.parking_email_jobs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  select * into old_job from public.parking_email_jobs where id=_job_id;
  if not found then raise exception 'Parking email delivery not found'; end if;
  if public.parking_access_level(old_job.organization_slug,old_job.hotel_id) <> 'manage' then
    raise exception 'Only hotel managers can retry parking emails' using errcode='42501';
  end if;
  if old_job.status not in ('failed','cancelled') then
    raise exception 'Only failed or cancelled deliveries can be retried';
  end if;
  if exists(
    select 1 from public.parking_email_jobs j
    where j.ticket_id=old_job.ticket_id and j.audience=old_job.audience
      and j.recipient=old_job.recipient and j.status in ('queued','processing')
  ) then
    raise exception 'A delivery retry is already queued';
  end if;

  insert into public.parking_email_jobs(
    organization_slug,hotel_id,ticket_id,event_id,audience,recipient,payload,
    status,attempts,next_attempt_at
  ) values (
    old_job.organization_slug,old_job.hotel_id,old_job.ticket_id,null,
    old_job.audience,old_job.recipient,old_job.payload,'queued',0,now()
  ) returning * into new_job;
  return new_job;
end $$;
revoke all on function public.parking_retry_email_job(uuid) from public,anon;
grant execute on function public.parking_retry_email_job(uuid) to authenticated,service_role;
