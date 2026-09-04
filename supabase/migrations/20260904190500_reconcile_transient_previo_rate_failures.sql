-- Previo can occasionally return HTTP 500 / error 4000 after it has actually
-- applied an absolute rate update. When a later authoritative Previo read-back
-- proves that the requested price landed, clear the false failure instead of
-- leaving the automation run red forever.
create or replace function public.reconcile_transient_previo_rate_failure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_accepted integer;
  v_confirmed integer;
  v_failed integer;
  v_processed integer;
  v_automation_run uuid;
  v_total integer;
  v_dec_accepted integer;
  v_dec_confirmed integer;
  v_dec_failed integer;
begin
  if lower(coalesce(new.source, '')) <> 'previo' then
    return new;
  end if;

  for rec in
    update public.revenue_rate_push_items i
       set status = 'confirmed',
           actual_previo_price = new.price,
           confirmed_at = coalesce(new.captured_at, now()),
           error = null,
           updated_at = now()
     where i.hotel_id = new.hotel_id
       and i.stay_date = new.stay_date
       and split_part(coalesce(i.obk_id, ''), ':', array_length(string_to_array(coalesce(i.obk_id, ''), ':'), 1))
           = split_part(coalesce(new.obk_id, ''), ':', array_length(string_to_array(coalesce(new.obk_id, ''), ':'), 1))
       and i.occupancy = new.occupancy
       and i.status = 'failed'
       and i.created_at >= now() - interval '24 hours'
       and coalesce(new.captured_at, new.updated_at, now()) >= i.updated_at
       and abs(new.price::numeric - i.target_price::numeric)
           <= greatest(1::numeric, abs(i.target_price::numeric) * 0.005)
       and coalesce(i.error, '') ~* '(internal processing error|try again in a few minutes|[[:space:]]5[0-9][0-9]:)'
    returning i.run_id, i.draft_id, i.decision_id
  loop
    update public.revenue_rate_drafts d
       set status = case when d.status = 'failed' then 'pushed' else d.status end,
           confirmation_status = case when d.status = 'superseded' then d.confirmation_status else 'confirmed' end,
           actual_previo_price = new.price,
           confirmed_at = coalesce(new.captured_at, now()),
           last_checked_at = coalesce(new.captured_at, now()),
           push_error = case when d.status = 'superseded' then d.push_error else null end
     where d.id = rec.draft_id;

    select
      count(*) filter (where status in ('accepted','confirmed','different')),
      count(*) filter (where status = 'confirmed'),
      count(*) filter (where status in ('failed','different')),
      count(*) filter (where status in ('accepted','confirmed','different','failed'))
      into v_accepted, v_confirmed, v_failed, v_processed
      from public.revenue_rate_push_items
     where run_id = rec.run_id;

    select automation_run_id
      into v_automation_run
      from public.revenue_rate_push_runs
     where id = rec.run_id;

    update public.revenue_rate_push_runs
       set accepted_count = v_accepted,
           failed_count = v_failed,
           processed_count = v_processed,
           status = case
             when v_failed = 0 then 'completed'
             when v_accepted = 0 then 'failed'
             else 'partial'
           end,
           last_error = case when v_failed = 0 then null else last_error end,
           updated_at = now()
     where id = rec.run_id;

    if v_automation_run is not null then
      update public.revenue_automation_runs
         set cells_published = v_accepted,
             cells_verified = v_confirmed,
             cells_failed = v_failed
       where id = v_automation_run;

      update public.revenue_automation_notifications
         set pushed_count = v_accepted,
             failed_count = v_failed
       where automation_run_id = v_automation_run;
    end if;

    if rec.decision_id is not null then
      select
        count(*),
        count(*) filter (where status in ('accepted','confirmed')),
        count(*) filter (where status = 'confirmed'),
        count(*) filter (where status in ('failed','different'))
        into v_total, v_dec_accepted, v_dec_confirmed, v_dec_failed
        from public.revenue_rate_push_items
       where run_id = rec.run_id
         and decision_id = rec.decision_id;

      update public.revenue_date_decisions
         set status = case
           when v_dec_failed > 0 then case when v_dec_accepted > 0 then 'partial' else 'failed' end
           when v_dec_confirmed = v_total then 'confirmed'
           when v_dec_accepted = v_total then 'accepted'
           else 'queued'
         end
       where id = rec.decision_id;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_reconcile_transient_previo_rate_failure on public.revenue_room_type_rates;
create trigger trg_reconcile_transient_previo_rate_failure
after insert or update of price, captured_at, source
on public.revenue_room_type_rates
for each row
execute function public.reconcile_transient_previo_rate_failure();
