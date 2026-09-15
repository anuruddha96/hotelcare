-- Defense in depth for PMS room assignment.
-- Even privileged/server-side code cannot attach a room from another property.

create or replace function public.pms_guard_reservation_room_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_room_type text;
begin
  if new.room_id is null then
    return new;
  end if;

  select rm.room_type
  into v_room_type
  from public.rooms rm
  where rm.id::text = new.room_id
    and (
      rm.hotel = new.hotel_id
      or exists (
        select 1
        from public.hotel_configurations hc
        where (hc.hotel_id = new.hotel_id or hc.hotel_name = new.hotel_id)
          and (rm.hotel = hc.hotel_id or rm.hotel = hc.hotel_name)
      )
    )
  limit 1;

  if not found then
    raise exception 'Room does not belong to this hotel';
  end if;

  new.room_type_id := v_room_type;
  return new;
end;
$$;

drop trigger if exists pms_reservation_rooms_scope_guard on public.pms_reservation_rooms;
create trigger pms_reservation_rooms_scope_guard
before insert or update of room_id, hotel_id
on public.pms_reservation_rooms
for each row
execute function public.pms_guard_reservation_room_scope();

comment on function public.pms_guard_reservation_room_scope() is
  'Prevents cross-property room assignment and keeps room_type_id aligned with the selected physical room.';
