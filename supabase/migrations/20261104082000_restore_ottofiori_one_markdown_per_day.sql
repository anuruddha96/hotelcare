-- Restore the owner-approved Ottofiori guard: at most one markdown
-- for a stay date in each Europe/Budapest business day.
-- This data migration is deliberately scoped to one hotel and organization.

do $$
declare
  affected_rows integer;
begin
  update public.revenue_pickup_automation_rules
  set max_markdowns_per_day = 1,
      updated_at = now()
  where organization_slug = 'rdhotels'
    and hotel_id = 'ottofiori'
    and max_markdowns_per_day is distinct from 1;

  get diagnostics affected_rows = row_count;

  if affected_rows > 1 then
    raise exception 'Expected at most one Ottofiori revenue rule row, updated %', affected_rows;
  end if;
end
$$;
