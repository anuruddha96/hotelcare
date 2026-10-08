-- Compact history keeps exactly one latest business-day observation and no PII.

select set_config('test.allowed_hotel', 'hotel-a', false);

insert into public.revenue_daily_snapshots (
  hotel_id, organization_slug, stay_date, captured_date,
  rooms_sold, rooms_available, occupancy_pct, revenue_eur, adr_eur,
  new_bookings, captured_at
) values
  ('hotel-a','org-a','2027-01-10','2026-10-08',2,10,20,200,100,2,'2026-10-08 08:00:00+00'),
  ('hotel-a','org-a','2027-01-10','2026-10-08',4,10,40,520,130,2,'2026-10-08 18:00:00+00'),
  ('hotel-a','org-a','2027-01-10','2026-10-09',5,10,50,700,140,1,'2026-10-09 18:00:00+00'),
  ('hotel-b','org-b','2027-01-10','2026-10-08',1,5,20,80,80,1,'2026-10-08 18:00:00+00');

-- An older intraday observation arriving late must not replace the latest daily state.
insert into public.revenue_daily_snapshots (
  hotel_id, organization_slug, stay_date, captured_date,
  rooms_sold, rooms_available, occupancy_pct, revenue_eur, adr_eur,
  new_bookings, captured_at
) values
  ('hotel-a','org-a','2027-01-10','2026-10-08',3,10,30,330,110,1,'2026-10-08 12:00:00+00');

do $$
declare
  v_count integer;
  v_rooms integer;
  v_revenue numeric;
  v_revpar numeric;
  v_lead integer;
begin
  select count(*) into v_count
  from public.revenue_historical_daily
  where hotel_id = 'hotel-a' and stay_date = '2027-01-10';

  if v_count <> 2 then
    raise exception 'expected 2 compact daily rows for hotel-a, got %', v_count;
  end if;

  select rooms_sold, revenue_eur, revpar_eur, lead_days
    into v_rooms, v_revenue, v_revpar, v_lead
  from public.revenue_historical_daily
  where hotel_id = 'hotel-a'
    and stay_date = '2027-01-10'
    and observed_date = '2026-10-08';

  if v_rooms <> 4 or v_revenue <> 520.00 or v_revpar <> 52.00 then
    raise exception 'latest intraday state was not preserved: rooms %, revenue %, revpar %',
      v_rooms, v_revenue, v_revpar;
  end if;

  if v_lead <> ('2027-01-10'::date - '2026-10-08'::date) then
    raise exception 'lead_days mismatch: %', v_lead;
  end if;
end
$$;

-- The analytics table must remain deliberately free of common PII fields.
do $$
declare
  v_pii_columns integer;
begin
  select count(*) into v_pii_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'revenue_historical_daily'
    and (
      column_name ilike '%guest%'
      or column_name ilike '%name%'
      or column_name ilike '%email%'
      or column_name ilike '%phone%'
      or column_name ilike '%address%'
      or column_name ilike '%note%'
      or column_name ilike '%request%'
      or column_name ilike '%document%'
      or column_name ilike '%passport%'
    );

  if v_pii_columns <> 0 then
    raise exception 'PII-like columns detected in compact historical table';
  end if;
end
$$;

-- Tenant/property RLS: authenticated user for hotel-a must not see hotel-b.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select set_config('test.allowed_hotel', 'hotel-a', false);

do $$
declare
  v_visible integer;
begin
  select count(*) into v_visible from public.revenue_historical_daily;
  if v_visible <> 2 then
    raise exception 'RLS expected 2 visible hotel-a rows, got %', v_visible;
  end if;
end
$$;

reset role;

-- Internal trigger function must not be exposed as an RPC to client roles.
do $$
begin
  if has_function_privilege('anon', 'public.upsert_revenue_historical_daily_from_snapshot()', 'EXECUTE') then
    raise exception 'anon must not execute the historical trigger function';
  end if;
  if has_function_privilege('authenticated', 'public.upsert_revenue_historical_daily_from_snapshot()', 'EXECUTE') then
    raise exception 'authenticated must not execute the historical trigger function';
  end if;
  if has_function_privilege('service_role', 'public.upsert_revenue_historical_daily_from_snapshot()', 'EXECUTE') then
    raise exception 'service_role must not execute the internal trigger function directly';
  end if;
end
$$;
