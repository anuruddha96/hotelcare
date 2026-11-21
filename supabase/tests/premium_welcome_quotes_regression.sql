-- Execute after the famous-quotes seed and personalized claim migration.
do $$
declare v_total integer; v_jobs integer; v_source_ok integer; v_function text;
begin
  select count(*), count(*) filter(where author = 'Steve Jobs'),
         count(*) filter(where source_url ~ '^https://' and provenance = 'verified_external')
  into v_total, v_jobs, v_source_ok
  from public.welcome_quote_catalog
  where quote_key like 'hc-fame-20261121-%' and is_active;
  if v_total <> 30 or v_jobs <> 8 or v_source_ok <> 30 then
    raise exception 'Famous quote checks failed: % total, % Jobs, % sourced', v_total, v_jobs, v_source_ok;
  end if;
  select pg_get_functiondef('public.claim_welcome_quote(text[])'::regprocedure) into v_function;
  if position('anu_000' in v_function) = 0
    or position('q.author = ''Steve Jobs''' in v_function) = 0
    or position('welcome_quote_impressions' in v_function) = 0
    or position('pg_advisory_xact_lock' in v_function) = 0
    or position('p.id = v_user' in v_function) = 0 then
    raise exception 'Premium selection or one-time authorization guard is missing';
  end if;
  if has_table_privilege('authenticated', 'public.welcome_quote_impressions', 'SELECT')
     or has_table_privilege('authenticated', 'public.welcome_quote_impressions', 'INSERT') then
    raise exception 'Quote history is not private';
  end if;
end;
$$;
