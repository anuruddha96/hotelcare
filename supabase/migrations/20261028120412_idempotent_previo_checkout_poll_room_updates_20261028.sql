-- Stop unchanged Previo checkout-poll diagnostics from rewriting every physical room.
-- Audit: 2026-10-28 query 8621519277284926877 (realtime.list_changes).
-- The original trigger stamped every room at every poll, creating unnecessary
-- WAL, Realtime events, updated_at churn and housekeeping-history triggers.
-- Preserve actual clean/dirty transitions and first daily verification.
-- The extra metadata date marks a verified Budapest business day; the original
-- human/housekeeping status and last_cleaned_at are otherwise unchanged.
CREATE OR REPLACE FUNCTION public.sync_previo_room_clean_status_from_poll()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           '{previoCleanVerifiedDate}',
           to_jsonb(v_budapest_date::text),
           true
         ),
           updated_at = now()
     where (r.hotel = new.hotel_id or (v_hotel_name is not null and r.hotel = v_hotel_name))
       and (
         (v_room_id is not null and r.pms_metadata->>'roomId' = v_room_id)
         or (v_room is not null and r.room_number = v_room)
       )
       -- pg_cron checkout polls can repeat several times in a minute.  Do
       -- not generate a physical room UPDATE, WAL entry, history trigger, or
       -- Realtime change when status and today's verification are unchanged.
       and (
         r.status is distinct from v_status
         or r.pms_metadata->>'previoRoomCleanStatusId' is distinct from v_clean::text
         or r.pms_metadata->>'previoCleanVerifiedDate' is distinct from v_budapest_date::text
         or (
           v_status = 'clean'
           and (
             r.last_cleaned_at is null
             or timezone('Europe/Budapest', r.last_cleaned_at)::date <> v_budapest_date
           )
         )
       );
  end loop;

  return new;
end;
$function$
;
