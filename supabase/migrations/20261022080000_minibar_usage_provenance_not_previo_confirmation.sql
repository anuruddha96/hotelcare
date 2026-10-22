-- Restore truthful minibar provenance while preserving outstanding physical refills.
-- A HotelCare housekeeping approval is not a verified Previo billing transaction.
create or replace function public.attach_pending_minibar_refill_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pending_date date;
  pending_items text;
  marker constant text := '[MINIBAR_REFILL_PENDING]';
  reminder text;
begin
  select max(coalesce(u.refill_blocked_at, u.usage_date)::date),
         string_agg(coalesce(i.name, 'Minibar item') || ' x' || u.quantity_used::text, ', ' order by i.name)
    into pending_date, pending_items
    from public.room_minibar_usage u
    left join public.minibar_items i on i.id = u.minibar_item_id
   where u.room_id = new.room_id
     and u.is_cleared = false
     and u.refill_status = 'blocked_guest_inside';

  if pending_date is not null and position(marker in coalesce(new.notes, '')) = 0 then
    reminder := marker
      || ' Minibar refill pending: ' || coalesce(pending_items, 'recorded items')
      || '. Room access blocked on ' || to_char(pending_date, 'YYYY-MM-DD')
      || ' (guest inside). Refill when access is possible. '
      || 'Usage was recorded in HotelCare; any Previo charge must be checked separately.';
    new.notes := concat_ws(E'\n', nullif(new.notes, ''), reminder);
  end if;

  return new;
end;
$$;

comment on column public.room_minibar_usage.previo_charge_confirmed_at is
  'Legacy manager self-attestation collected during housekeeping approvals. NOT a verified Previo API charge; never show as PMS billing confirmation.';

-- Repair historical assignment reminders without removing operator-written notes.
update public.room_assignments
   set notes = replace(
     notes,
     'The minibar charge was already confirmed in Previo — do not charge it again.',
     'Minibar usage was recorded in HotelCare; any Previo charge must be checked separately.'
   )
 where notes like '%The minibar charge was already confirmed in Previo%';