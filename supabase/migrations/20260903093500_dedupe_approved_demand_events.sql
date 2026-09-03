create or replace function public.dedupe_approved_demand_event()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.approved is true and exists (
    select 1
      from public.demand_events e
     where e.id <> new.id
       and e.approved is true
       and e.hotel_id is not distinct from new.hotel_id
       and lower(trim(e.title)) = lower(trim(new.title))
       and e.event_date = new.event_date
       and coalesce(e.end_date, e.event_date) = coalesce(new.end_date, new.event_date)
  ) then
    -- Keep the discovery record for auditability, but do not allow the same
    -- event/date range to become a second pricing signal.
    new.approved := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dedupe_approved_demand_event on public.demand_events;

create trigger trg_dedupe_approved_demand_event
before insert or update of approved, title, event_date, end_date, hotel_id
on public.demand_events
for each row
execute function public.dedupe_approved_demand_event();
