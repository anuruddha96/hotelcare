-- Read-only guardrails for the original welcome layout's catalogue.
do $$
declare v_count integer;
begin
  if not exists (select 1 from public.welcome_quote_refill_state where id = true) then
    raise exception 'Welcome refill lease state is missing';
  end if;
  if not exists (select 1 from vault.secrets where name = 'welcome_quote_refill_worker_secret') then
    raise exception 'Scheduled refill secret is missing';
  end if;
  if has_function_privilege('anon', 'public.insert_welcome_original_thoughts(jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.insert_welcome_original_thoughts(jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.verify_welcome_quote_worker_secret(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.verify_welcome_quote_worker_secret(text)', 'EXECUTE') then
    raise exception 'Browser roles must not write thoughts or read worker secrets';
  end if;
  if not has_function_privilege('authenticated', 'public.welcome_quote_remaining()', 'EXECUTE') then
    raise exception 'Authenticated employees must be able to request their own stock count';
  end if;
  if exists (select 1 from public.welcome_quote_catalog
             where provenance = 'ai_original' and
                   (author <> 'HotelCare' or source_url <> 'https://hotelcare.app/')) then
    raise exception 'Original AI thoughts must not be attributed to real people';
  end if;
  if exists (select user_id, quote_key from public.welcome_quote_impressions
             group by user_id, quote_key having count(*) > 1) then
    raise exception 'A person received the same thought more than once';
  end if;
  select count(*) into v_count from public.welcome_quote_catalog where is_active;
  if v_count < 17 then raise exception 'Original sourced catalogue has been removed'; end if;
end $$;
