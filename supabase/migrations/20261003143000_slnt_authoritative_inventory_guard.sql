-- Reassert the authoritative SLNT workbook operating inventory.
-- Workbook: 60 active units across Previo hotel IDs 782407 + 783103.
-- Sobi is the single stale mapped PMS unit not present in the active workbook.
-- No RD Hotels rows are touched.

begin;

update public.rooms
set status='out_of_order',
    is_checkout_room=false,
    checkout_time=null,
    guest_count=0,
    guest_nights_stayed=0,
    pms_metadata=jsonb_set(
      jsonb_set(coalesce(pms_metadata,'{}'::jsonb),'{workbookActive}','false'::jsonb,true),
      '{excludedReason}',to_jsonb('not_in_active_slnt_workbook'::text),true
    ),
    updated_at=now()
where organization_slug='slnt'
  and hotel='slnt-group'
  and lower(trim(room_number))='sobi apartment budapest';

-- Defensive guard: stale workbook-excluded units must never be assigned as
-- checkout/daily work even if a PMS refresh or old assignment attempts it.
create or replace function public.guard_slnt_workbook_inactive_room()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.organization_slug='slnt'
     and new.hotel='slnt-group'
     and lower(trim(new.room_number))='sobi apartment budapest' then
    new.status := 'out_of_order';
    new.is_checkout_room := false;
    new.checkout_time := null;
    new.guest_count := 0;
    new.guest_nights_stayed := 0;
    new.pms_metadata := jsonb_set(
      jsonb_set(coalesce(new.pms_metadata,'{}'::jsonb),'{workbookActive}','false'::jsonb,true),
      '{excludedReason}',to_jsonb('not_in_active_slnt_workbook'::text),true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_slnt_workbook_inactive_room on public.rooms;
create trigger trg_guard_slnt_workbook_inactive_room
before insert or update on public.rooms
for each row execute function public.guard_slnt_workbook_inactive_room();

commit;
