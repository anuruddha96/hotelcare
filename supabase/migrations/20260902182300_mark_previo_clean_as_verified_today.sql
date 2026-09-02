-- Treat a live Previo housekeeping Clean state as a same-day clean verification
-- for Team View. Previo supplies the current room-clean status but not a
-- HotelCare last_cleaned_at timestamp; without this verification stamp the UI
-- intentionally renders a clean room as stale/dirty.

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
  v_budapest_date date := timezone('Europe/Budapest', now())::date;
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
           -- Team View intentionally treats a clean status as stale unless it
           -- has been verified on the selected day. A live Previo clean state
           -- is that verification, even though Previo does not send an exact
           -- HotelCare cleaning-completion timestamp. Stamp once per Budapest
           -- day, preserving a real same-day cleaning timestamp when present.
           last_cleaned_at = case
             when v_status = 'clean'
               and (
                 r.last_cleaned_at is null
                 or timezone('Europe/Budapest', r.last_cleaned_at)::date <> v_budapest_date
               )
             then now()
             else r.last_cleaned_at
           end,
           pms_metadata = jsonb_set(
             jsonb_set(
               coalesce(r.pms_metadata, '{}'::jsonb),
               '{previoRoomCleanStatusId}',
               to_jsonb(v_clean),
               true
             ),
             '{previoCleanVerifiedAt}',
             to_jsonb(now()::text),
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

-- Repair the current Mika board immediately from the already-reconciled live
-- Previo status. Only today's fresh PMS rooms that Previo currently says are
-- clean are stamped; dirty rooms and historical clean timestamps are untouched.
update public.rooms r
set last_cleaned_at = now(),
    pms_metadata = jsonb_set(
      coalesce(r.pms_metadata, '{}'::jsonb),
      '{previoCleanVerifiedAt}',
      to_jsonb(now()::text),
      true
    ),
    updated_at = now()
where r.hotel in ('mika-downtown', 'Hotel Mika Downtown')
  and r.status = 'clean'
  and coalesce(r.pms_metadata->>'previoRoomCleanStatusId', '') in ('2', '3')
  and r.pms_metadata->>'pmsSyncDate' = to_char(timezone('Europe/Budapest', now()), 'YYYY-MM-DD')
  and (
    r.last_cleaned_at is null
    or timezone('Europe/Budapest', r.last_cleaned_at)::date <> timezone('Europe/Budapest', now())::date
  );
