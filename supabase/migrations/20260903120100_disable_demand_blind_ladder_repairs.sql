-- Disable proactive demand-blind occupancy-ladder price increases.
--
-- The pricing engine decides movement from pickup, occupancy, pace, market and
-- events. A background ladder cleanup must never independently increase a sell
-- rate by tens of euros merely to make guest-count pillars look tidy. Pending
-- ladder repairs are therefore non-publishable and any reconcile retry is
-- retired. Intentional manager edits and date-level revenue decisions remain
-- unaffected.

create or replace function public.block_automatic_ladder_repair_drafts()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.intent_source = 'ladder_repair' then
    new.status := 'superseded';
    new.confirmation_status := 'superseded';
    new.superseded_at := coalesce(new.superseded_at, now());
    new.reconcile_state := null;
    new.reconcile_next_at := null;
    new.push_error := 'Automatic ladder repair blocked: occupancy-ladder cleanup must not create demand-blind price increases.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_block_automatic_ladder_repairs on public.revenue_rate_drafts;
create trigger trg_block_automatic_ladder_repairs
before insert or update of status, confirmation_status, reconcile_state, reconcile_next_at, intent_source
on public.revenue_rate_drafts
for each row
execute function public.block_automatic_ladder_repair_drafts();

update public.revenue_rate_drafts
set confirmation_status = 'superseded',
    superseded_at = coalesce(superseded_at, now()),
    reconcile_state = null,
    reconcile_next_at = null,
    push_error = 'Automatic ladder repair retired: no retries will be sent.'
where intent_source = 'ladder_repair'
  and confirmation_status in ('sending','sent','checking','pending','different');
