alter table public.lost_and_found
  add column if not exists hotel text;

-- Backfill room-linked records from the authoritative room.
update public.lost_and_found laf
set
  hotel = r.hotel,
  organization_slug = coalesce(nullif(r.organization_slug, ''), laf.organization_slug)
from public.rooms r
where laf.room_id = r.id
  and (
    laf.hotel is distinct from r.hotel
    or (
      nullif(r.organization_slug, '') is not null
      and laf.organization_slug is distinct from r.organization_slug
    )
  );

-- Older manager-created records were saved without room_id. Preserve them at
-- the manager's property instead of leaving them invisible to every other
-- manager at that hotel.
update public.lost_and_found laf
set
  hotel = p.assigned_hotel,
  organization_slug = coalesce(nullif(p.organization_slug, ''), laf.organization_slug)
from public.profiles p
where laf.room_id is null
  and laf.reported_by = p.id
  and p.assigned_hotel is not null
  and (
    laf.hotel is null
    or laf.hotel is distinct from p.assigned_hotel
    or (
      nullif(p.organization_slug, '') is not null
      and laf.organization_slug is distinct from p.organization_slug
    )
  );

create or replace function public.sync_lost_and_found_scope()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  scoped_hotel text;
  scoped_org text;
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

    if scoped_hotel is not null then
      new.hotel := scoped_hotel;
    end if;
    if nullif(scoped_org, '') is not null then
      new.organization_slug := scoped_org;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists sync_lost_and_found_scope on public.lost_and_found;

create trigger sync_lost_and_found_scope
before insert or update of room_id, reported_by
on public.lost_and_found
for each row
execute function public.sync_lost_and_found_scope();

create index if not exists idx_lost_and_found_scope_status_date
  on public.lost_and_found (organization_slug, hotel, status, found_date desc);
