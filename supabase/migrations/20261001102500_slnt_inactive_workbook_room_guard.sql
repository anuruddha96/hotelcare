-- Keep SLNT workbook-inactive rooms out of the operational housekeeping pool.
-- PMS refreshes may update room cleanliness, but an explicitly inactive workbook
-- unit must remain unavailable until a manager deliberately removes the marker.
-- Tenant-scoped: no RD Hotels or other organizations are affected.

begin;

create or replace function public.enforce_slnt_inactive_workbook_room()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_slug = 'slnt'
     and coalesce(new.pms_metadata->'slntOperational'->>'status', '') = 'inactive_workbook'
  then
    new.status := 'out_of_order';
    new.pms_metadata := coalesce(new.pms_metadata, '{}'::jsonb)
      || jsonb_build_object('manualHousekeepingHold', true);
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_slnt_inactive_workbook_room_trigger on public.rooms;
create trigger enforce_slnt_inactive_workbook_room_trigger
before insert or update on public.rooms
for each row
execute function public.enforce_slnt_inactive_workbook_room();

-- Repair the current visible status as part of the migration.
update public.rooms
set status = 'out_of_order',
    pms_metadata = coalesce(pms_metadata, '{}'::jsonb)
      || jsonb_build_object('manualHousekeepingHold', true),
    updated_at = now()
where organization_slug = 'slnt'
  and coalesce(pms_metadata->'slntOperational'->>'status', '') = 'inactive_workbook';

commit;
