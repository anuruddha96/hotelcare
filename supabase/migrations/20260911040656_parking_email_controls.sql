-- Independent per-hotel communication settings and durable transactional outbox.
alter table public.parking_settings
  add column vendor_auto_email boolean not null default false,
  add column guest_email_enabled boolean not null default false,
  add column sender_email text not null default 'tickets@notify.hotelcare.app',
  add column reply_to text,
  add column brand_name text not null default '',
  add column parking_instructions text not null default '';

alter table public.parking_tickets add column guest_email text;

create table public.parking_email_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel_id text not null,
  ticket_id uuid not null references public.parking_tickets(id) on delete restrict,
  event_id uuid references public.parking_ticket_events(id) on delete restrict,
  audience text not null check (audience in ('vendor','guest')),
  recipient text not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued','processing','sent','failed','cancelled')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  provider_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(event_id, audience, recipient)
);
create index parking_email_jobs_ticket_idx on public.parking_email_jobs(ticket_id, created_at desc);
create index parking_email_jobs_due_idx on public.parking_email_jobs(next_attempt_at) where status in ('queued','processing');
create index parking_email_jobs_scope_idx on public.parking_email_jobs(organization_slug, hotel_id, created_at desc);
alter table public.parking_email_jobs enable row level security;
revoke all on public.parking_email_jobs from public, anon, authenticated;
grant select on public.parking_email_jobs to authenticated;
grant all on public.parking_email_jobs to service_role;
create policy parking_email_jobs_select on public.parking_email_jobs for select to authenticated
  using (public.parking_access_level(organization_slug,hotel_id) <> 'none');

create function public.parking_save_email_settings(
  _organization_slug text, _hotel_id text, _provider_name text,
  _notification_emails text[], _default_validity_days integer,
  _vendor_auto_email boolean, _guest_email_enabled boolean,
  _sender_email text, _reply_to text, _brand_name text, _parking_instructions text
) returns public.parking_settings language plpgsql security definer set search_path = public as $$
declare s public.parking_settings;
begin
  if auth.uid() is null or public.parking_access_level(_organization_slug,_hotel_id) <> 'manage' then
    raise exception 'Only hotel managers can configure parking' using errcode='42501';
  end if;
  if lower(btrim(coalesce(_sender_email,''))) !~ '^[a-z0-9._%+-]+@([a-z0-9-]+\.)*hotelcare\.app$' then
    raise exception 'Use a verified HotelCare sending domain';
  end if;
  if nullif(btrim(_reply_to),'') is not null and _reply_to !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Enter a valid reception reply-to email';
  end if;
  if char_length(coalesce(_brand_name,'')) > 100 or coalesce(_brand_name,'') ~ '[\r\n<>]'
     or char_length(coalesce(_parking_instructions,'')) > 2000 then
    raise exception 'Hotel name or parking instructions are invalid';
  end if;
  if coalesce(_vendor_auto_email,false) and coalesce(cardinality(_notification_emails),0) = 0 then
    raise exception 'Add a vendor email before enabling automatic notifications';
  end if;
  if coalesce(cardinality(_notification_emails),0) > 5 then raise exception 'Use at most five vendor recipients'; end if;
  s := public.parking_save_settings(_organization_slug,_hotel_id,_provider_name,_notification_emails,_default_validity_days);
  update public.parking_settings set
    vendor_auto_email=coalesce(_vendor_auto_email,false), guest_email_enabled=coalesce(_guest_email_enabled,false),
    sender_email=lower(btrim(_sender_email)), reply_to=nullif(btrim(_reply_to),''),
    brand_name=btrim(coalesce(_brand_name,'')), parking_instructions=btrim(coalesce(_parking_instructions,''))
  where id=s.id returning * into s;
  return s;
end $$;
revoke all on function public.parking_save_email_settings(text,text,text,text[],integer,boolean,boolean,text,text,text,text) from public,anon;
grant execute on function public.parking_save_email_settings(text,text,text,text[],integer,boolean,boolean,text,text,text,text) to authenticated,service_role;

-- Do not let explicit grants promote non-manager roles to stock management.
update public.parking_user_access set access_level='issue' where access_level='manage';
alter table public.parking_user_access add constraint parking_grants_issue_only check(access_level='issue');

alter function public.parking_set_user_access(text,text,uuid,text) rename to parking_set_user_access_internal;
revoke all on function public.parking_set_user_access_internal(text,text,uuid,text) from public,anon,authenticated;
create function public.parking_set_user_access(_organization_slug text,_hotel_id text,_user_id uuid,_access_level text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or public.parking_access_level(_organization_slug,_hotel_id) <> 'manage' then
    raise exception 'Only hotel managers can configure access' using errcode='42501';
  end if;
  if _access_level is null or _access_level not in ('none','issue') then
    raise exception 'Individual grants allow issue/search only; inventory management requires a manager role';
  end if;
  return public.parking_set_user_access_internal(_organization_slug,_hotel_id,_user_id,_access_level);
end $$;
revoke all on function public.parking_set_user_access(text,text,uuid,text) from public,anon;
grant execute on function public.parking_set_user_access(text,text,uuid,text) to authenticated,service_role;

-- Reception can issue/search; corrections remain a management action.
alter function public.parking_update_ticket(uuid,date,date,text,text,text,text) rename to parking_update_ticket_internal;
revoke all on function public.parking_update_ticket_internal(uuid,date,date,text,text,text,text) from public,anon,authenticated;
create function public.parking_update_ticket(_ticket_id uuid,_valid_from date,_valid_to date,
  _reservation_ref text default null,_guest_name text default null,_room_number text default null,_notes text default null)
returns public.parking_tickets language plpgsql security definer set search_path=public as $$
declare t public.parking_tickets;
begin
  select * into t from public.parking_tickets where id=_ticket_id;
  if auth.uid() is null or not found or public.parking_access_level(t.organization_slug,t.hotel_id) <> 'manage' then
    raise exception 'Only hotel managers can amend issued tickets' using errcode='42501';
  end if;
  return public.parking_update_ticket_internal(_ticket_id,_valid_from,_valid_to,_reservation_ref,_guest_name,_room_number,_notes);
end $$;
revoke all on function public.parking_update_ticket(uuid,date,date,text,text,text,text) from public,anon;
grant execute on function public.parking_update_ticket(uuid,date,date,text,text,text,text) to authenticated,service_role;

-- Build a minimal immutable snapshot: no room, reservation, internal note or guest name is shared with the vendor.
create function public.parking_enqueue_event_mail() returns trigger language plpgsql security definer set search_path=public as $$
declare s public.parking_settings; t public.parking_tickets; p jsonb; r text; hotel_name text;
begin
  if new.event_type not in ('issued','updated','voided') then return new; end if;
  select * into t from public.parking_tickets where id=new.ticket_id;
  select * into s from public.parking_settings where organization_slug=t.organization_slug and hotel_id=t.hotel_id;
  if not found then return new; end if;
  select h.hotel_name into hotel_name from public.hotel_configurations h where h.hotel_id=t.hotel_id limit 1;
  p := jsonb_build_object('event',new.event_type,'reference',t.reference,'valid_from',t.valid_from,'valid_to',t.valid_to,
    'hotel_name',coalesce(nullif(s.brand_name,''),hotel_name,t.hotel_id),'from_email',s.sender_email,
    'reply_to',s.reply_to,'provider_name',s.provider_name,'instructions',s.parking_instructions);
  if s.vendor_auto_email then
    foreach r in array s.notification_emails loop
      insert into public.parking_email_jobs(organization_slug,hotel_id,ticket_id,event_id,audience,recipient,payload)
      values(t.organization_slug,t.hotel_id,t.id,new.id,'vendor',r,p);
    end loop;
  end if;
  if s.guest_email_enabled and t.guest_email is not null then
    insert into public.parking_email_jobs(organization_slug,hotel_id,ticket_id,event_id,audience,recipient,payload)
    values(t.organization_slug,t.hotel_id,t.id,new.id,'guest',t.guest_email,p);
  end if;
  return new;
end $$;
revoke all on function public.parking_enqueue_event_mail() from public,anon,authenticated;
create trigger parking_enqueue_event_mail after insert on public.parking_ticket_events
  for each row execute function public.parking_enqueue_event_mail();

-- Store guest address before the atomic issue RPC writes the event/outbox.
create function public.parking_issue_ticket_with_email(
  _organization_slug text,_hotel_id text,_reference text,_valid_from date,_valid_to date,
  _reservation_ref text default null,_guest_name text default null,_room_number text default null,
  _notes text default null,_guest_email text default null
) returns public.parking_tickets language plpgsql security definer set search_path=public as $$
declare t public.parking_tickets; e text := nullif(lower(btrim(_guest_email)),'');
begin
  if auth.uid() is null or public.parking_access_level(_organization_slug,_hotel_id)='none' then
    raise exception 'You cannot issue tickets at this hotel' using errcode='42501';
  end if;
  if e is not null and (char_length(e)>254 or e !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$') then
    raise exception 'Enter a valid guest email';
  end if;
  if e is not null and not exists(select 1 from public.parking_settings where organization_slug=_organization_slug
    and hotel_id=_hotel_id and guest_email_enabled) then raise exception 'Guest email is not enabled for this hotel'; end if;
  select * into t from public.parking_tickets where organization_slug=_organization_slug and hotel_id=_hotel_id
    and reference_search=public.parking_normalize_reference(_reference) for update;
  if not found or t.status <> 'available' then raise exception 'Ticket is not available at this hotel'; end if;
  update public.parking_tickets set guest_email=e where id=t.id;
  return public.parking_issue_ticket(_organization_slug,_hotel_id,_reference,_valid_from,_valid_to,_reservation_ref,_guest_name,_room_number,_notes);
end $$;
revoke all on function public.parking_issue_ticket_with_email(text,text,text,date,date,text,text,text,text,text) from public,anon;
grant execute on function public.parking_issue_ticket_with_email(text,text,text,date,date,text,text,text,text,text) to authenticated,service_role;

-- Service-only leases prevent overlapping workers from submitting the same job.
create function public.parking_claim_email_jobs() returns setof public.parking_email_jobs
language plpgsql security definer set search_path=public as $$
begin
  update public.parking_email_jobs set status='failed', last_error='Delivery window expired; manager review required'
    where status in ('queued','processing') and (created_at < now()-interval '23 hours' or (attempts>=5 and next_attempt_at<=now()));
  return query with due as (
    select j.id from public.parking_email_jobs j
    where j.status in ('queued','processing') and j.next_attempt_at<=now()
      and j.attempts<5 and j.created_at>=now()-interval '23 hours'
    order by j.created_at for update skip locked limit 10
  ) update public.parking_email_jobs j set status='processing',attempts=attempts+1,
    next_attempt_at=now()+interval '5 minutes',lease_id=gen_random_uuid()
    from due where j.id=due.id returning j.*;
end $$;
revoke all on function public.parking_claim_email_jobs() from public,anon,authenticated;
grant execute on function public.parking_claim_email_jobs() to service_role;

-- Separate credential for this worker, generated and consumed server-side only.
do $$ begin
  if not exists(select 1 from vault.secrets where name='parking_email_worker_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'parking_email_worker_secret','Parking mail worker');
  end if;
end $$;
create function public.parking_email_worker_secret() returns text language sql security definer set search_path=public,vault as $$
  select decrypted_secret from vault.decrypted_secrets where name='parking_email_worker_secret' limit 1;
$$;
revoke all on function public.parking_email_worker_secret() from public,anon,authenticated;
grant execute on function public.parking_email_worker_secret() to service_role;
select cron.schedule('hotelcare-parking-email-worker','*/2 * * * *',$cron$
  select net.http_post(url:='https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/parking-email-worker',
    headers:=jsonb_build_object('Content-Type','application/json','x-worker-secret',public.parking_email_worker_secret()),body:='{}'::jsonb);
$cron$);
