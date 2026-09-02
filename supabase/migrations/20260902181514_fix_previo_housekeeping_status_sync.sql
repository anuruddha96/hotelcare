-- Keep HotelCare housekeeping status aligned with the live Previo room-clean
-- status returned by previo-poll-checkouts. This closes a race where Fresh
-- Sync correctly wrote clean/dirty, then the reservation refresh (XML roster
-- path has no clean-status field) could overwrite the room back to dirty.

create or replace function public.sync_previo_room_clean_status_from_poll()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d jsonb;
  v_room text;
  v_room_id text;
  v_clean integer;
  v_status text;
  v_hotel_name text;
begin
  if new.sync_type <> 'checkouts_poll'
     or new.direction <> 'from_previo'
     or coalesce(new.sync_status, '') not in ('success', 'partial') then
    return new;
  end if;

  select hc.hotel_name
    into v_hotel_name
  from public.hotel_configurations hc
  where hc.hotel_id = new.hotel_id
  limit 1;

  for d in
    select value
    from jsonb_array_elements(coalesce(new.data->'diagnostics', '[]'::jsonb))
  loop
    if d->>'source' is distinct from 'rest-room' then
      continue;
    end if;

    v_room := nullif(d->>'localRoom', '');
    v_room_id := nullif(d->>'roomId', '');

    begin
      v_clean := nullif(d->>'roomCleanStatus', '')::integer;
    exception when others then
      continue;
    end;

    v_status := case
      when v_clean in (2, 3) then 'clean'
      when v_clean in (1, 4, 5) then 'dirty'
      else null
    end;

    if v_status is null then
      continue;
    end if;

    update public.rooms r
       set status = v_status,
           pms_metadata = jsonb_set(
             coalesce(r.pms_metadata, '{}'::jsonb),
             '{previoRoomCleanStatusId}',
             to_jsonb(v_clean),
             true
           ),
           updated_at = now()
     where (r.hotel = new.hotel_id or (v_hotel_name is not null and r.hotel = v_hotel_name))
       and (
         (v_room_id is not null and r.pms_metadata->>'roomId' = v_room_id)
         or (v_room is not null and r.room_number = v_room)
       );
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_sync_previo_room_clean_status_from_poll on public.pms_sync_history;
create trigger trg_sync_previo_room_clean_status_from_poll
after insert on public.pms_sync_history
for each row
execute function public.sync_previo_room_clean_status_from_poll();

-- previo-sync-rooms historically labels automatically verified mappings as
-- 'auto', while the database constraint accepts 'active'. Normalize the write
-- before constraints run so Fresh Sync does not emit a mapping error per room.
create or replace function public.normalize_pms_room_mapping_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.mapping_status = 'auto' then
    new.mapping_status := 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_pms_room_mapping_status on public.pms_room_mappings;
create trigger trg_normalize_pms_room_mapping_status
before insert or update on public.pms_room_mappings
for each row
execute function public.normalize_pms_room_mapping_status();

-- The reservation/bucket refresh for XML-configured Previo hotels carries no
-- housekeeping field. Preserve a known live Previo clean state while that
-- refresh updates room metadata; explicit/manual status-only updates remain
-- allowed, and a real Previo dirty change is applied by Fresh Sync/poll.
create or replace function public.protect_previo_clean_status_from_metadata_refresh()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'clean'
     and new.status = 'dirty'
     and coalesce(old.pms_metadata->>'previoRoomCleanStatusId', '') in ('2', '3')
     and new.pms_metadata is distinct from old.pms_metadata
     and (new.pms_metadata ? 'pmsSyncDate' or new.pms_metadata ? 'lastPmsRefreshDate') then
    new.status := old.status;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_previo_clean_status_from_metadata_refresh on public.rooms;
create trigger trg_protect_previo_clean_status_from_metadata_refresh
before update of status, pms_metadata on public.rooms
for each row
execute function public.protect_previo_clean_status_from_metadata_refresh();
