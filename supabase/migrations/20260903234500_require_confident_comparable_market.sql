-- Hotel Ottofiori: only reconciled comparable products with sufficient final
-- confidence may enter the commercial market median. Raw observations remain
-- available for audit and rescanning.

create or replace function public.enforce_ottofiori_comparable_market_confidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.hotel_id = 'ottofiori'
     and coalesce(new.source, '') like 'reconciled_comparable%'
     and coalesce(new.confidence, 0) < 0.50 then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_ottofiori_comparable_market_confidence
  on public.competitor_rates;

create trigger trg_enforce_ottofiori_comparable_market_confidence
before insert or update of rate, confidence, source, captured_at
on public.competitor_rates
for each row
execute function public.enforce_ottofiori_comparable_market_confidence();

-- Remove existing low-confidence comparable rows, then rebuild the live
-- 90-day comparable layer through the same reconciler. The trigger prevents
-- low-confidence candidates from re-entering.
delete from public.competitor_rates
where hotel_id = 'ottofiori'
  and organization_slug = 'rdhotels'
  and coalesce(source, '') like 'reconciled_comparable%'
  and coalesce(confidence, 0) < 0.50;

do $$
declare
  r record;
begin
  for r in
    select id
    from public.competitor_properties
    where hotel_id = 'ottofiori'
      and organization_slug = 'rdhotels'
      and active is true
  loop
    perform public.reconcile_competitor_rates(r.id, current_date, current_date + 90, 30);
  end loop;
end;
$$;

comment on function public.enforce_ottofiori_comparable_market_confidence() is
  'Rejects low-confidence reconciled comparable rates from Ottofiori market pricing while preserving raw observations for audit.';