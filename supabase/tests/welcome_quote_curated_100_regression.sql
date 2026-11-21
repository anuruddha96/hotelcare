-- Run after the curated welcome-quote seed migration.
-- No quote impression rows or profile roles are changed by this test.
do $$
declare
  v_total integer;
  v_original integer;
  v_famous integer;
  v_audience text;
  v_available integer;
begin
  select count(*),
         count(*) filter (where author = 'HotelCare' and provenance = 'ai_original'),
         count(*) filter (where author <> 'HotelCare' and provenance = 'verified_external')
    into v_total, v_original, v_famous
  from public.welcome_quote_catalog
  where quote_key like 'hc-curated-20261121-%' and is_active;

  if v_total <> 100 or v_original <> 92 or v_famous <> 8 then
    raise exception 'Curated 100 quote counts differ (total %, original %, famous %)',
      v_total, v_original, v_famous;
  end if;

  if exists (
    select 1 from public.welcome_quote_catalog
    where quote_key like 'hc-curated-20261121-%'
      and (length(quote_text) > 100
        or length(quote_text) < 12
        or source_url !~ '^https://'
        or quality_rank < 4
        or cardinality(audiences) = 0)
  ) then
    raise exception 'Invalid short-quote quality, source, or audience';
  end if;

  if exists (
    select 1 from public.welcome_quote_catalog
    where quote_key like 'hc-curated-20261121-%'
      and ((author = 'HotelCare' and source_url <> 'https://hotelcare.app/')
        or (author <> 'HotelCare' and source_url = 'https://hotelcare.app/'))
  ) then
    raise exception 'The original vs. attributed source label is incorrect';
  end if;

  -- Every role receives shared hospitality thoughts plus specific choices.
  foreach v_audience in array array[
    'housekeeping','housekeeping_leadership','reception','reception_leadership',
    'maintenance','maintenance_leadership','breakfast','marketing',
    'marketing_leadership','finance','finance_leadership','hr',
    'hotel_management','executive','admin','supervisor'
  ] loop
    select count(*) into v_available
    from public.welcome_quote_catalog q
    where q.quote_key like 'hc-curated-20261121-%'
      and (v_audience = any(q.audiences) or 'hospitality' = any(q.audiences));
    if v_available < 25 then
      raise exception 'Too few new quotes for role %: %', v_audience, v_available;
    end if;
  end loop;

  -- Lifetime one-time delivery still depends on unique (user_id, quote_key).
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.welcome_quote_impressions'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) ilike '%user_id, quote_key%'
  ) then
    raise exception 'One-time quote history constraint is missing';
  end if;
end;
$$;
