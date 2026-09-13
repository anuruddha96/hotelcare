-- Keep manual Checkout <-> Daily moves stable even while today's PMS metadata
-- still carries the old departure signal, and dispatch reception coordination.

create or replace function public.enforce_manual_room_type_override()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta jsonb := coalesce(new.pms_metadata, '{}'::jsonb);
  v_stamp text;
  v_by text;
begin
  v_stamp := v_meta->>'manual_moved_at';
  v_by := coalesce(v_meta->>'manual_moved_by', auth.uid()::text);

  -- Only touch deliberate manager room-type moves. PMS refreshes do not stamp
  -- a new manual_moved_at and therefore remain untouched.
  if v_stamp is null
     or v_stamp is not distinct from (coalesce(old.pms_metadata, '{}'::jsonb)->>'manual_moved_at')
     or new.is_checkout_room is not distinct from old.is_checkout_room then
    return new;
  end if;

  if new.is_checkout_room = false
     and coalesce(v_meta->>'manual_checkout', 'false') = 'false' then
    v_meta := jsonb_set(v_meta, '{manual_daily}', 'true'::jsonb, true);
    v_meta := jsonb_set(v_meta, '{manual_checkout}', 'false'::jsonb, true);
    v_meta := jsonb_set(v_meta, '{manual_daily_at}', to_jsonb(v_stamp), true);
    if v_by is not null then
      v_meta := jsonb_set(v_meta, '{manual_daily_by}', to_jsonb(v_by), true);
    end if;

    -- A Checkout -> Daily manager move is treated as an operational extension
    -- override until reception confirms/updates the reservation in Previo.
    v_meta := jsonb_set(v_meta, '{scheduledDepartureToday}', 'false'::jsonb, true);
    v_meta := jsonb_set(v_meta, '{checkedOutToday}', 'false'::jsonb, true);
    v_meta := jsonb_set(v_meta, '{departureTime}', 'null'::jsonb, true);
  elsif new.is_checkout_room = true
        and coalesce(v_meta->>'manual_checkout', 'true') = 'true' then
    v_meta := jsonb_set(v_meta, '{manual_daily}', 'false'::jsonb, true);
    v_meta := jsonb_set(v_meta, '{manual_checkout}', 'true'::jsonb, true);
    v_meta := jsonb_set(v_meta, '{manual_checkout_at}', to_jsonb(v_stamp), true);
    if v_by is not null then
      v_meta := jsonb_set(v_meta, '{manual_checkout_by}', to_jsonb(v_by), true);
    end if;
  end if;

  new.pms_metadata := v_meta;
  return new;
end;
$$;

drop trigger if exists trg_enforce_manual_room_type_override on public.rooms;
create trigger trg_enforce_manual_room_type_override
before update of is_checkout_room, pms_metadata on public.rooms
for each row execute function public.enforce_manual_room_type_override();

create or replace function public.dispatch_manual_room_type_email()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_old_meta jsonb := coalesce(old.pms_metadata, '{}'::jsonb);
  v_new_meta jsonb := coalesce(new.pms_metadata, '{}'::jsonb);
  v_stamp text;
  v_hotel_id text;
  v_org text;
  v_actor uuid;
  v_actor_text text;
  v_actor_name text := 'HotelCare manager';
  v_secret text;
  v_request_id bigint;
  v_previous text;
  v_next text;
  v_date date;
  v_pms_departure boolean := false;
begin
  v_stamp := v_new_meta->>'manual_moved_at';
  if v_stamp is null
     or v_stamp is not distinct from (v_old_meta->>'manual_moved_at')
     or new.is_checkout_room is not distinct from old.is_checkout_room then
    return new;
  end if;

  -- Guard against unrelated writes that happen to carry old manual metadata.
  if new.is_checkout_room = true
     and coalesce(v_new_meta->>'manual_checkout','') <> 'true' then
    return new;
  end if;
  if new.is_checkout_room = false
     and coalesce(v_new_meta->>'manual_checkout','') <> 'false' then
    return new;
  end if;

  select hc.hotel_id into v_hotel_id
  from public.hotel_configurations hc
  where hc.hotel_name = new.hotel or hc.hotel_id = new.hotel
  order by (hc.hotel_name = new.hotel) desc
  limit 1;
  if v_hotel_id is null then return new; end if;

  select c.organization_slug into v_org
  from public.hotel_operational_contacts c
  where c.hotel_id = v_hotel_id
    and c.room_type_change_email_enabled = true
    and c.reception_email is not null
  limit 1;
  if v_org is null then return new; end if;

  v_actor := auth.uid();
  if v_actor is null then
    v_actor_text := v_new_meta->>'manual_moved_by';
    if v_actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_actor := v_actor_text::uuid;
    end if;
  end if;

  if v_actor is not null then
    select coalesce(nullif(p.nickname,''), nullif(p.full_name,''), 'HotelCare manager')
      into v_actor_name
    from public.profiles p
    where p.id = v_actor
    limit 1;
  else
    v_actor_name := coalesce(nullif(v_new_meta->>'manual_moved_by',''), 'HotelCare manager');
  end if;

  v_previous := case when old.is_checkout_room then 'checkout' else 'daily' end;
  v_next := case when new.is_checkout_room then 'checkout' else 'daily' end;
  v_date := (timezone('Europe/Budapest', now()))::date;
  v_pms_departure := coalesce(v_old_meta->>'scheduledDepartureToday','false') = 'true';

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'housekeeping_room_change_email_worker_secret'
  order by created_at desc
  limit 1;
  if v_secret is null then
    raise warning 'Housekeeping room change e-mail secret is missing';
    return new;
  end if;

  select net.http_post(
    url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/housekeeping-room-change-email',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-hotelcare-worker-secret',v_secret
    ),
    body := jsonb_build_object(
      'organizationSlug',v_org,
      'hotelId',v_hotel_id,
      'hotelName',coalesce(new.hotel, v_hotel_id),
      'roomId',new.id::text,
      'roomNumber',new.room_number,
      'businessDate',v_date::text,
      'previousType',v_previous,
      'newType',v_next,
      'changedByUserId',v_actor::text,
      'changedByName',v_actor_name,
      'note',new.notes,
      'pmsDepartureStillVisible',v_pms_departure
    ),
    timeout_milliseconds := 15000
  ) into v_request_id;

  return new;
exception when others then
  raise warning 'Could not dispatch room type reception email for room %: %', new.room_number, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_dispatch_manual_room_type_email on public.rooms;
create trigger trg_dispatch_manual_room_type_email
after update of is_checkout_room, pms_metadata on public.rooms
for each row execute function public.dispatch_manual_room_type_email();
