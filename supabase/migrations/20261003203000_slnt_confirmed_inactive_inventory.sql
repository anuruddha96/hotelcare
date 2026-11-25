-- User-confirmed SLNT inactive inventory. Preserve PMS mappings for audit/identity,
-- but remove these units from operational housekeeping and guard against PMS reactivation.
begin;

create or replace function public.is_slnt_confirmed_inactive_room(p_room_number text)
returns boolean
language sql
immutable
as $$
  select
    lower(trim(coalesce(p_room_number,''))) in ('sobi apartment budapest','downtown terrace passion','wr pension','technikai')
    or lower(trim(coalesce(p_room_number,''))) like 'wr pension %'
    or lower(trim(coalesce(p_room_number,''))) like 'technikai %';
$$;

update public.rooms
set status='out_of_order',
    is_checkout_room=false,
    checkout_time=null,
    guest_count=0,
    guest_nights_stayed=0,
    pms_metadata=jsonb_set(
      jsonb_set(
        jsonb_set(coalesce(pms_metadata,'{}'::jsonb),'{workbookActive}','false'::jsonb,true),
        '{excludedFromHousekeeping}','true'::jsonb,true
      ),
      '{excludedReason}',to_jsonb('confirmed_inactive_slnt_inventory'::text),true
    ),
    updated_at=now()
where organization_slug='slnt'
  and hotel='slnt-group'
  and public.is_slnt_confirmed_inactive_room(room_number);

create or replace function public.guard_slnt_workbook_inactive_room()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.organization_slug='slnt'
     and new.hotel='slnt-group'
     and public.is_slnt_confirmed_inactive_room(new.room_number) then
    new.status := 'out_of_order';
    new.is_checkout_room := false;
    new.checkout_time := null;
    new.guest_count := 0;
    new.guest_nights_stayed := 0;
    new.pms_metadata := jsonb_set(
      jsonb_set(
        jsonb_set(coalesce(new.pms_metadata,'{}'::jsonb),'{workbookActive}','false'::jsonb,true),
        '{excludedFromHousekeeping}','true'::jsonb,true
      ),
      '{excludedReason}',to_jsonb('confirmed_inactive_slnt_inventory'::text),true
    );
  end if;
  return new;
end;
$$;

commit;
