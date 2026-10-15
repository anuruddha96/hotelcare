-- Lost & Found reports created outside a guest room need a first-class
-- location. Room-linked reports continue to use room_id as the source of truth.
-- Nullable for existing records and current housekeeping room reports.
alter table public.lost_and_found
  add column if not exists found_location text;

comment on column public.lost_and_found.found_location is
  'Reception, Lobby, other hotel area, or user-entered location; null for room-linked reports.';

-- The original general-report trigger always overwrote hotel with the DB
-- profile's assigned_hotel. Top management can select a different hotel per
-- browser tab; preserve that explicitly selected property only when it belongs
-- to their own organization. Room-linked reports still inherit their room.
create or replace function public.sync_lost_and_found_scope()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  scoped_hotel text;
  scoped_org text;
  selected_hotel_is_allowed boolean := false;
begin
  if new.room_id is not null then
    select r.hotel, r.organization_slug
      into scoped_hotel, scoped_org
    from public.rooms r
    where r.id = new.room_id;

    if scoped_hotel is not null then
      new.hotel := scoped_hotel;
    end if;
    if nullif(scoped_org, '') is not null then
      new.organization_slug := scoped_org;
    end if;
  else
    select p.assigned_hotel, p.organization_slug
      into scoped_hotel, scoped_org
    from public.profiles p
    where p.id = new.reported_by;

    if nullif(scoped_org, '') is not null then
      new.organization_slug := scoped_org;
    end if;

    if new.hotel is not null
      and nullif(scoped_org, '') is not null
      and auth.uid() = new.reported_by
      and (
        public.is_top_management(auth.uid())
        or public.is_super_admin(auth.uid())
        or public.get_user_role(auth.uid())::text = 'admin'
      )
    then
      select exists (
        select 1
        from public.hotel_configurations hc
        join public.organizations o on o.id = hc.organization_id
        where o.slug = scoped_org
          and (hc.hotel_id = new.hotel or hc.hotel_name = new.hotel)
      ) into selected_hotel_is_allowed;
    end if;

    if not selected_hotel_is_allowed and scoped_hotel is not null then
      new.hotel := scoped_hotel;
    end if;
  end if;

  return new;
end;
$function$;
