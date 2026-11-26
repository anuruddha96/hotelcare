-- Phase 2: private notification outbox and 60-second attendance correction.
-- No hotel enablement changes. Signals remain advisory, independent of delivery.
alter table public.housekeeping_breakfast_signals
  add column notification_cycle integer not null default 0;
-- Zero is valid only for a fully undone, closed signal; a later mark starts at one again.
alter table public.housekeeping_breakfast_signals drop constraint housekeeping_breakfast_signals_guests_seen_check;
alter table public.housekeeping_breakfast_signals add constraint housekeeping_breakfast_signals_guests_seen_check
  check (guests_seen > 0 or (guests_seen = 0 and closed_reason = 'undone' and closed_at is not null));
alter table public.housekeeping_automation_settings
  add column breakfast_push_enabled boolean not null default true;

create table public.housekeeping_breakfast_mark_receipts (
  attendance_id uuid primary key,
  organization_slug text not null,
  hotel_id text not null,
  actor_id uuid,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null,
  undone_at timestamptz
);
create table public.housekeeping_breakfast_push_outbox (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references public.housekeeping_breakfast_signals(id) on delete cascade,
  notification_cycle integer not null,
  organization_slug text not null,
  hotel_id text not null,
  user_id uuid not null,
  assignment_id uuid,
  room_number text not null,
  preferred_language text not null default 'en',
  kind text not null default 'arrival' check (kind in ('arrival','correction')),
  parent_id uuid references public.housekeeping_breakfast_push_outbox(id) on delete cascade,
  undone_attendance_id uuid,
  attendance_ids uuid[] not null default '{}',
  guests_seen integer,
  guests_expected integer,
  state text not null default 'pending' check (state in ('pending','sending','sent','suppressed','failed')),
  queued_at timestamptz not null default now(),
  claim_token uuid,
  claimed_at timestamptz,
  tag text,
  sent_at timestamptz,
  check ((kind = 'arrival' and parent_id is null and undone_attendance_id is null)
      or (kind = 'correction' and parent_id is not null and undone_attendance_id is not null and tag is not null))
);
create unique index breakfast_push_once_per_cycle_recipient on public.housekeeping_breakfast_push_outbox
  (signal_id,notification_cycle,user_id) where kind = 'arrival';
create unique index breakfast_push_once_per_correction on public.housekeeping_breakfast_push_outbox
  (parent_id,undone_attendance_id) where kind = 'correction';
create index breakfast_push_pending_idx on public.housekeeping_breakfast_push_outbox
  (state,queued_at,organization_slug,hotel_id,user_id);
create index breakfast_push_attendance_ids_idx on public.housekeeping_breakfast_push_outbox using gin(attendance_ids);
create index breakfast_mark_receipts_actor_idx on public.housekeeping_breakfast_mark_receipts
  (actor_id,hotel_id,created_at);

alter table public.housekeeping_breakfast_mark_receipts enable row level security;
alter table public.housekeeping_breakfast_push_outbox enable row level security;
revoke all on public.housekeeping_breakfast_mark_receipts, public.housekeeping_breakfast_push_outbox
  from public, anon, authenticated;
grant select,insert,update,delete on public.housekeeping_breakfast_mark_receipts, public.housekeeping_breakfast_push_outbox to service_role;

-- A new cycle is a new arrival after expiry or a door dismissal. Refreshes
-- within the same open window never reset delivery deduplication.
create function public.breakfast_notification_cycle_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.last_seen_at > old.last_seen_at and
     (old.window_ends_at <= new.last_seen_at or (old.closed_at is not null and new.closed_at is null)) then
    new.notification_cycle := old.notification_cycle + 1;
    new.notified_user_id := null;
    new.notified_at := null;
    if cardinality(old.attendance_ids)=0 then new.first_seen_at := new.last_seen_at; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.breakfast_notification_cycle_trigger() from public,anon,authenticated;
create trigger breakfast_notification_cycle before update of last_seen_at,closed_at
  on public.housekeeping_breakfast_signals for each row execute function public.breakfast_notification_cycle_trigger();

-- Re-evaluate the authoritative assignment and hotel settings at dispatch time.
-- Exactly one eligible assignee; ambiguous/missing identity is never guessed.
create function public.breakfast_push_candidates(_signal_id uuid default null)
returns table(signal_id uuid, notification_cycle integer, organization_slug text, hotel_id text,
  user_id uuid, assignment_id uuid, room_number text, preferred_language text,
  attendance_ids uuid[], guests_seen integer, guests_expected integer, window_ends_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id,s.notification_cycle,s.organization_slug,s.hotel_id,p.id,a.id,s.room_number,
    coalesce(p.preferred_language,'en'),s.attendance_ids,s.guests_seen,s.guests_expected,s.window_ends_at
  from public.housekeeping_breakfast_signals s
  join public.rooms r on r.id=s.room_id and r.organization_slug=s.organization_slug
  join public.hotel_configurations h on h.hotel_id=s.hotel_id
  join public.organizations o on o.id=h.organization_id and o.slug=s.organization_slug
  left join lateral (
    select cfg.breakfast_signal_enabled,cfg.breakfast_push_enabled
    from public.housekeeping_automation_settings cfg
    where cfg.organization_slug=s.organization_slug and cfg.hotel_id in (s.hotel_id,h.hotel_name)
    order by (cfg.hotel_id=s.hotel_id) desc limit 1
  ) settings on true
  join lateral (
    select a1.id,a1.assigned_to
    from public.room_assignments a1 join public.profiles p1 on p1.id=a1.assigned_to
    where a1.room_id=s.room_id and a1.organization_slug=s.organization_slug
      and a1.assignment_date=s.signal_date and a1.status='assigned' and a1.assignment_type='daily_cleaning'
      and p1.organization_slug=s.organization_slug and p1.deleted_at is null
      and not coalesce(a1.is_dnd,false) and not coalesce(a1.pms_hold,false)
      and coalesce(a1.service_result,'') not in ('guest_declined','cleaned')
      and coalesce(a1.notes,'') not like '%[NO_SERVICE]%'
      and coalesce(a1.notes,'') not like '%[NO_BOARD_NO_CLEANING]%'
    order by a1.id limit 2
  ) a on true
  join public.profiles p on p.id=a.assigned_to and p.organization_slug=s.organization_slug and p.deleted_at is null
  where (_signal_id is null or s.id=_signal_id)
    and s.signal_date=(now() at time zone 'Europe/Budapest')::date
    and s.closed_at is null and s.window_ends_at>now()
    and h.breakfast_enabled is true and h.is_active is distinct from false
    and coalesce(settings.breakfast_signal_enabled,true) and coalesce(settings.breakfast_push_enabled,true)
    and r.hotel in (s.hotel_id,h.hotel_name)
    and not coalesce(r.is_dnd,false) and not coalesce(r.is_checkout_room,false)
    and coalesce(r.pms_metadata->>'scheduledDepartureToday','false')<>'true'
    and coalesce(r.status,'') not in ('dnd','out_of_order','out_of_service','maintenance')
    and coalesce(r.notes,'') not like '%[NO_SERVICE]%'
    and coalesce(r.notes,'') not like '%[NO_BOARD_NO_CLEANING]%'
    and not exists (
      select 1 from public.room_assignments other
      where other.room_id=s.room_id and other.organization_slug=s.organization_slug
        and other.assignment_date=s.signal_date and other.status<>'cancelled'
        and (other.id<>a.id and (other.assignment_type='checkout_cleaning'
          or other.status in ('in_progress','dnd_pending_retry')
          or (other.assignment_type='daily_cleaning' and other.status='assigned')))
    );
$$;
revoke all on function public.breakfast_push_candidates(uuid) from public,anon,authenticated;
grant execute on function public.breakfast_push_candidates(uuid) to service_role;

create function public.enqueue_breakfast_pushes(_signal_id uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.housekeeping_breakfast_push_outbox as q
    (signal_id,notification_cycle,organization_slug,hotel_id,user_id,assignment_id,room_number,preferred_language)
  select c.signal_id,c.notification_cycle,c.organization_slug,c.hotel_id,c.user_id,c.assignment_id,c.room_number,c.preferred_language
  from public.breakfast_push_candidates(_signal_id) c
  where c.window_ends_at>now()+interval '10 minutes' or not exists (
    select 1 from public.housekeeping_breakfast_push_outbox prior
    where prior.signal_id=c.signal_id and prior.notification_cycle=c.notification_cycle
      and prior.kind='arrival' and prior.user_id<>c.user_id
  )
  on conflict (signal_id,notification_cycle,user_id) where kind='arrival' do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.enqueue_breakfast_pushes(uuid) from public,anon,authenticated;
grant execute on function public.enqueue_breakfast_pushes(uuid) to service_role;

-- Claim a whole two-minute cohort atomically. The first mark waits for the
-- cohort, so a burst is one push, not two early pushes plus a third summary.
-- Stale in-flight claims are not retried blindly (a network timeout may have
-- accepted a push). A future window can notify again.
create function public.claim_breakfast_pushes(_limit integer default 20)
returns setof public.housekeeping_breakfast_push_outbox
language plpgsql security definer set search_path = '' as $$
declare
  v_claim uuid := gen_random_uuid();
  v_group record;
  v_ids uuid[];
  v_tag text;
begin
  if not pg_try_advisory_xact_lock(hashtext('hotelcare-breakfast-push-claim')) then return; end if;
  update public.housekeeping_breakfast_push_outbox
    set state='failed' where state='sending' and claimed_at<now()-interval '5 minutes';
  perform public.enqueue_breakfast_pushes(null);
  update public.housekeeping_breakfast_push_outbox q set state='suppressed'
    where q.kind='arrival' and q.state='pending' and not exists (
      select 1 from public.breakfast_push_candidates(q.signal_id) c
      where c.user_id=q.user_id and c.notification_cycle=q.notification_cycle
    );

  -- Corrections are urgent and never wait for the next arrival cohort.
  update public.housekeeping_breakfast_push_outbox q
    set state='sending',claim_token=v_claim,claimed_at=now()
    where q.id in (
      select id from public.housekeeping_breakfast_push_outbox
      where state='pending' and kind='correction' order by queued_at,id limit 100
    );

  for v_group in
    select q.organization_slug,q.hotel_id,q.user_id,min(q.queued_at) as first_at
    from public.housekeeping_breakfast_push_outbox q
    where q.state='pending' and q.kind='arrival'
    group by q.organization_slug,q.hotel_id,q.user_id
    having min(q.queued_at)<=now()-interval '2 minutes'
    order by min(q.queued_at)
    limit greatest(1,least(coalesce(_limit,20),50))
  loop
    select array_agg(q.id order by q.queued_at,q.id) into v_ids
      from public.housekeeping_breakfast_push_outbox q
      where q.state='pending' and q.kind='arrival'
        and q.organization_slug=v_group.organization_slug and q.hotel_id=v_group.hotel_id and q.user_id=v_group.user_id
        and q.queued_at<=v_group.first_at+interval '2 minutes';
    if coalesce(cardinality(v_ids),0)=0 then continue; end if;
    v_tag := case when cardinality(v_ids)>=3 then 'housekeeping-breakfast-batch-'||v_ids[1]::text else null end;
    update public.housekeeping_breakfast_push_outbox q
      set state='sending',claim_token=v_claim,claimed_at=now(),
        tag=coalesce(v_tag,'housekeeping-breakfast-room-'||q.signal_id::text),
        assignment_id=c.assignment_id,preferred_language=c.preferred_language,
        attendance_ids=c.attendance_ids,guests_seen=c.guests_seen,guests_expected=c.guests_expected
      from public.breakfast_push_candidates(null) c
      where q.id=any(v_ids) and q.state='pending'
        and c.signal_id=q.signal_id and c.user_id=q.user_id and c.notification_cycle=q.notification_cycle;
  end loop;
  return query select * from public.housekeeping_breakfast_push_outbox
    where claim_token=v_claim and state='sending' order by kind desc,queued_at,id;
end;
$$;
revoke all on function public.claim_breakfast_pushes(integer) from public,anon,authenticated;
grant execute on function public.claim_breakfast_pushes(integer) to service_role;

-- Fresh eligibility immediately before the external call. Undo/reassignment
-- can race with delivery; completion below handles a correction if needed.
create function public.revalidate_breakfast_pushes(_claim_token uuid,_ids uuid[])
returns setof public.housekeeping_breakfast_push_outbox
language plpgsql security definer set search_path = '' as $$
begin
  update public.housekeeping_breakfast_push_outbox q
    set state='suppressed'
    where q.claim_token=_claim_token and q.id=any(_ids) and q.state='sending' and q.kind='arrival'
      and not exists(select 1 from public.breakfast_push_candidates(q.signal_id) c
        where c.notification_cycle=q.notification_cycle and c.user_id=q.user_id);
  update public.housekeeping_breakfast_push_outbox q
    set assignment_id=c.assignment_id,preferred_language=c.preferred_language,
      attendance_ids=c.attendance_ids,guests_seen=c.guests_seen,guests_expected=c.guests_expected
    from public.breakfast_push_candidates(null) c
    where q.claim_token=_claim_token and q.id=any(_ids) and q.state='sending' and q.kind='arrival'
      and q.signal_id=c.signal_id and q.notification_cycle=c.notification_cycle and q.user_id=c.user_id;
  return query select * from public.housekeeping_breakfast_push_outbox
    where claim_token=_claim_token and id=any(_ids) and state='sending' order by queued_at,id;
end;
$$;
revoke all on function public.revalidate_breakfast_pushes(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.revalidate_breakfast_pushes(uuid,uuid[]) to service_role;

create function public.queue_breakfast_push_correction(_notification_id uuid,_attendance_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.housekeeping_breakfast_push_outbox
    (signal_id,notification_cycle,organization_slug,hotel_id,user_id,assignment_id,room_number,
      preferred_language,kind,parent_id,undone_attendance_id,tag)
  select q.signal_id,q.notification_cycle,q.organization_slug,q.hotel_id,q.user_id,q.assignment_id,q.room_number,
    q.preferred_language,'correction',q.id,_attendance_id,q.tag
  from public.housekeeping_breakfast_push_outbox q
  where q.id=_notification_id and q.kind='arrival' and q.state='sent' and q.sent_at is not null
    and _attendance_id=any(q.attendance_ids)
  on conflict (parent_id,undone_attendance_id) where kind='correction' do nothing;
$$;
revoke all on function public.queue_breakfast_push_correction(uuid,uuid) from public,anon,authenticated;
grant execute on function public.queue_breakfast_push_correction(uuid,uuid) to service_role;

create function public.finish_breakfast_pushes(_claim_token uuid,_ids uuid[],_delivered boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare q record; v_attendance uuid; n integer := 0;
begin
  for q in update public.housekeeping_breakfast_push_outbox b
    set state=case when _delivered then 'sent' else 'failed' end,
      sent_at=case when _delivered then now() else null end
    where b.claim_token=_claim_token and b.id=any(_ids) and b.state='sending'
    returning b.*
  loop
    n:=n+1;
    if _delivered and q.kind='arrival' then
      update public.housekeeping_breakfast_signals s set notified_user_id=q.user_id,notified_at=q.sent_at
        where s.id=q.signal_id and s.notification_cycle=q.notification_cycle;
      for v_attendance in select r.attendance_id from public.housekeeping_breakfast_mark_receipts r
        where r.attendance_id=any(q.attendance_ids) and r.undone_at is not null
      loop
        perform public.queue_breakfast_push_correction(q.id,v_attendance);
      end loop;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.finish_breakfast_pushes(uuid,uuid[],boolean) from public,anon,authenticated;
grant execute on function public.finish_breakfast_pushes(uuid,uuid[],boolean) to service_role;

-- Receipt token is a one-mark, 60-second capability; signed-in marks also
-- require the same verified actor. No attendance identifiers or tokens are
-- readable from the public board beyond its own successful mark response.
create function public.undo_breakfast_mark(_attendance_id uuid,_token_hash text,_actor_id uuid,_hotel_id text,_org text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_receipt public.housekeeping_breakfast_mark_receipts%rowtype;
  v_signal public.housekeeping_breakfast_signals%rowtype;
  v_ids uuid[]; v_locations text[]; v_count integer; v_first timestamptz; v_last timestamptz; v_push uuid;
begin
  select * into v_receipt from public.housekeeping_breakfast_mark_receipts r
    where r.attendance_id=_attendance_id and r.hotel_id=_hotel_id and r.organization_slug=_org
      and r.token_hash=_token_hash and (r.actor_id is null or r.actor_id=_actor_id)
      and r.undone_at is null and r.created_at>=now()-interval '60 seconds'
    for update;
  if not found then return false; end if;
  -- Serialize against signal changes before deleting the mark.
  select * into v_signal from public.housekeeping_breakfast_signals s
    where s.hotel_id=_hotel_id and s.organization_slug=_org and _attendance_id=any(s.attendance_ids) for update;
  delete from public.breakfast_attendance a where a.id=_attendance_id and a.hotel_id=_hotel_id and a.organization_slug=_org;
  if not found then return false; end if;
  update public.housekeeping_breakfast_mark_receipts set undone_at=now() where attendance_id=_attendance_id;
  if v_signal.id is not null then
    select array_agg(a.id order by a.created_at,a.id),array_agg(distinct a.location),sum(a.served_count)::integer,
      min(a.created_at),max(a.created_at)
    into v_ids,v_locations,v_count,v_first,v_last
    from public.breakfast_attendance a where a.id=any(v_signal.attendance_ids) and a.hotel_id=_hotel_id and a.organization_slug=_org;
    if coalesce(cardinality(v_ids),0)=0 or coalesce(v_count,0)<=0 then
      update public.housekeeping_breakfast_signals s set closed_at=now(),closed_by=_actor_id,closed_reason='undone',
        attendance_ids='{}',locations='{}',guests_seen=0,updated_at=now() where s.id=v_signal.id;
    else
      update public.housekeeping_breakfast_signals s set attendance_ids=v_ids,locations=v_locations,
        guests_seen=v_count,first_seen_at=v_first,last_seen_at=v_last,
        window_ends_at=v_last+(v_signal.window_ends_at-v_signal.last_seen_at),updated_at=now()
        where s.id=v_signal.id;
    end if;
  end if;
  for v_push in select q.id from public.housekeeping_breakfast_push_outbox q
    where q.organization_slug=_org and q.hotel_id=_hotel_id and q.kind='arrival' and q.state='sent'
      and _attendance_id=any(q.attendance_ids)
  loop
    perform public.queue_breakfast_push_correction(v_push,_attendance_id);
  end loop;
  return true;
end;
$$;
revoke all on function public.undo_breakfast_mark(uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.undo_breakfast_mark(uuid,text,uuid,text,text) to service_role;

create function public.breakfast_mark_push_status(_actor_id uuid,_hotel_id text,_org text,_attendance_ids uuid[])
returns table(attendance_id uuid,housekeeping_informed boolean)
language sql stable security definer set search_path = '' as $$
  select r.attendance_id,exists(select 1 from public.housekeeping_breakfast_push_outbox q
    where q.organization_slug=_org and q.hotel_id=_hotel_id and q.kind='arrival' and q.state='sent'
      and q.sent_at is not null and q.attendance_ids @> array[r.attendance_id])
  from public.housekeeping_breakfast_mark_receipts r
  where r.actor_id=_actor_id and r.hotel_id=_hotel_id and r.organization_slug=_org
    and r.attendance_id=any(_attendance_ids) and r.undone_at is null;
$$;
revoke all on function public.breakfast_mark_push_status(uuid,text,text,uuid[]) from public,anon,authenticated;
grant execute on function public.breakfast_mark_push_status(uuid,text,text,uuid[]) to service_role;

-- Use the existing Vault-protected dispatch credential. The public Edge
-- Function checks it before any worker operation. Scratch PostgreSQL does not
-- install pg_cron/pg_net, so this block only registers in Supabase environments.
do $migration$
begin
  if to_regnamespace('cron') is not null and to_regnamespace('net') is not null then
    perform cron.schedule('housekeeping-breakfast-push-1min','* * * * *',
      $command$select net.http_post(
        url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/breakfast-mark-served',
        headers := jsonb_build_object('Content-Type','application/json','x-hotelcare-push-secret',
          public.get_hotelcare_push_secret('hotelcare_push_dispatch_key')),
        body := '{"action":"housekeeping_dispatch"}'::jsonb,
        timeout_milliseconds := 55000
      );$command$);
  end if;
end;
$migration$;

-- Owner-approved rollback before enablement (removes only Phase 2 state):
-- select cron.unschedule('housekeeping-breakfast-push-1min'); -- Supabase only
-- drop function public.breakfast_mark_push_status(uuid,text,text,uuid[]);
-- drop function public.undo_breakfast_mark(uuid,text,uuid,text,text);
-- drop function public.finish_breakfast_pushes(uuid,uuid[],boolean);
-- drop function public.queue_breakfast_push_correction(uuid,uuid);
-- drop function public.revalidate_breakfast_pushes(uuid,uuid[]);
-- drop function public.claim_breakfast_pushes(integer);
-- drop function public.enqueue_breakfast_pushes(uuid);
-- drop function public.breakfast_push_candidates(uuid);
-- drop trigger breakfast_notification_cycle on public.housekeeping_breakfast_signals;
-- drop function public.breakfast_notification_cycle_trigger();
-- drop table public.housekeeping_breakfast_push_outbox,public.housekeeping_breakfast_mark_receipts;
-- Before rollback, verify there are no zero-count undone signals; otherwise keep the
-- relaxed check or explicitly approve removal of those historical rows.
-- alter table public.housekeeping_breakfast_signals drop constraint housekeeping_breakfast_signals_guests_seen_check;
-- alter table public.housekeeping_breakfast_signals add constraint housekeeping_breakfast_signals_guests_seen_check check (guests_seen > 0);
-- alter table public.housekeeping_breakfast_signals drop column notification_cycle;
-- alter table public.housekeeping_automation_settings drop column breakfast_push_enabled;
