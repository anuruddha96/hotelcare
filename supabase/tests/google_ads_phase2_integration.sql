-- Tests use synthetic tenants and encrypted-token placeholders only.
do $$
declare t text; f regprocedure;
begin
 for t in select tablename from pg_tables where schemaname='public' and tablename like 'google_ads_%' loop
  if has_table_privilege('authenticated','public.'||t,'SELECT') or has_table_privilege('anon','public.'||t,'SELECT')
   or has_table_privilege('authenticated','public.'||t,'INSERT') then raise exception 'Browser grant on %',t; end if;
  if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'RLS missing on %',t;end if;
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'google_ads_%' loop
  if has_function_privilege('authenticated',f,'EXECUTE') or has_function_privilege('anon',f,'EXECUTE') then raise exception 'Browser RPC grant on %',f;end if;
 end loop;
end $$;
set role service_role;
do $$
declare
 org uuid:='11111111-1111-4111-8111-111111111111';
 other_org uuid:='22222222-2222-4222-8222-222222222222';
 actor uuid:='33333333-3333-4333-8333-333333333333';
 cid uuid; cid2 uuid; aid uuid; aid2 uuid; job public.google_ads_sync_jobs; report jsonb; today date:=current_date;
 rows jsonb; budgets jsonb; campaigns jsonb;
begin
 cid:=public.google_ads_attach(org,actor,'google-subject','fixture@example.test','encrypted-fixture');
 if public.google_ads_attach(org,actor,'google-subject','fixture@example.test',null)<>cid then raise exception 'Reconnect duplicated connection';end if;
 if not exists(select 1 from public.google_ads_credentials where connection_id=cid and refresh_ciphertext='encrypted-fixture') then raise exception 'Refresh token not preserved';end if;
 cid2:=public.google_ads_attach(other_org,actor,'google-subject','fixture@example.test','different-cipher');
 if cid=cid2 then raise exception 'Cross-tenant collision';end if;
 insert into public.google_ads_accounts(organization_id,connection_id,customer_id,name,currency,time_zone)
 values(org,cid,'1234567890','A','HUF','Europe/Budapest') returning id into aid;
 insert into public.google_ads_accounts(organization_id,connection_id,customer_id,name,currency,time_zone)
 values(other_org,cid2,'1234567890','B','EUR','Europe/Budapest') returning id into aid2;
 if public.google_ads_enable_account(other_org,aid,true) then raise exception 'Cross-tenant enable';end if;
 if not public.google_ads_enable_account(org,aid,true) then raise exception 'Enable failed';end if;
 if exists(select 1 from public.google_ads_claim_job(other_org,aid)) then raise exception 'Cross-tenant job claim';end if;
 select * into job from public.google_ads_claim_job(org,aid);
 if job.lease is null then raise exception 'Claim failed';end if;
 if exists(select 1 from public.google_ads_claim_job(org,aid)) then raise exception 'Duplicate lease';end if;
 rows:=jsonb_build_array(jsonb_build_object('date',today::text,'campaignId','1','costMicros',1230000));
 budgets:='[{"id":"11","campaignId":"1","amountMicros":10000000,"period":"DAILY"}]';
 campaigns:='[{"campaignId":"1","name":"Test","status":"ENABLED","channel":"SEARCH"}]';
 if public.google_ads_commit_report(aid,gen_random_uuid(),today-1,today,rows,budgets,campaigns,today,'month',null) then raise exception 'Stale lease accepted';end if;
 if not public.google_ads_commit_report(aid,job.lease,today-1,today,rows,budgets,campaigns,today,'month',null) then raise exception 'Report commit failed';end if;
 report:=public.google_ads_read_report(org,aid,today-1,today);
 if jsonb_array_length(report->'rows')<>1 or jsonb_array_length(report->'coverage')<>2 or jsonb_array_length(report->'budgets')<>1 then raise exception 'Report payload or coverage wrong: %',report;end if;
 if public.google_ads_read_report(other_org,aid,today-1,today) is not null then raise exception 'Cross-tenant cached report';end if;
 update public.google_ads_sync_jobs set due_at=now() where account_id=aid;
 select * into job from public.google_ads_claim_job(org,aid);
 if not public.google_ads_commit_report(aid,job.lease,today,today,'[]',budgets,campaigns,today,'hourly',null) then raise exception 'Restatement failed';end if;
 if exists(select 1 from public.google_ads_campaign_daily where account_id=aid) then raise exception 'Stale removed row retained';end if;
 if (select count(*) from public.google_ads_budget_history where account_id=aid)<>1 then raise exception 'Unchanged budget generated duplicate history';end if;
 update public.google_ads_sync_jobs set due_at=now() where account_id=aid;
 select * into job from public.google_ads_claim_job(org,aid);
 if not public.google_ads_fail_job(aid,job.lease,'LOCAL_QUOTA_LIMIT') then raise exception 'Failure recording failed';end if;
 if exists(select 1 from public.google_ads_claim_job(org,aid)) then raise exception 'Backoff ignored';end if;
 if public.google_ads_disconnect(other_org,cid) then raise exception 'Cross-tenant disconnect';end if;
 if not public.google_ads_disconnect(org,cid) then raise exception 'Disconnect failed';end if;
 if exists(select 1 from public.google_ads_credentials where connection_id=cid) or exists(select 1 from public.google_ads_sync_jobs where account_id=aid) then raise exception 'Disconnect did not clear credentials/jobs';end if;
 if public.google_ads_read_report(org,aid,today-1,today) is not null then raise exception 'Disabled report accessible';end if;
 if public.google_ads_enable_account(org,aid,true) then raise exception 'Disconnected account enabled';end if;
 if not public.google_ads_reserve_operation('interactive') then raise exception 'Quota initial reserve failed';end if;
 insert into public.google_ads_api_usage(category) select 'interactive' from generate_series(1,575);
 if public.google_ads_reserve_operation('interactive') then raise exception 'Interactive allocation exceeded';end if;
 insert into public.google_ads_api_usage(category) select 'sync' from generate_series(1,1728);
 if public.google_ads_reserve_operation('sync') then raise exception 'Sync allocation exceeded';end if;
 update public.google_ads_api_usage set at=now()-interval '25 hours';
 if not public.google_ads_reserve_operation('sync') then raise exception 'Rolling 24h quota did not replenish';end if;
end $$;
reset role;
