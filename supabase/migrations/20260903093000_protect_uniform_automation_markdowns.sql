create or replace function public.protect_uniform_automation_markdown()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_movement numeric;
  v_direction text;
  v_expected numeric;
begin
  -- The revenue engine decides one whole-euro movement for an entire stay date.
  -- A later occupancy-ladder repair must never turn an automation markdown back
  -- into a hold or increase. For automation markdown drafts, the decision row is
  -- authoritative: every child cell must preserve the exact date movement.
  if new.intent_source = 'automation_markdown'
     and new.decision_id is not null
     and new.old_price is not null then
    select d.movement, d.direction
      into v_movement, v_direction
      from public.revenue_date_decisions d
     where d.id = new.decision_id;

    if v_direction = 'decrease'
       and v_movement is not null
       and v_movement < 0 then
      v_expected := round(new.old_price + v_movement);

      -- Only apply a genuine markdown. This also prevents a malformed decision
      -- from accidentally raising the rate.
      if v_expected < new.old_price then
        new.new_price := v_expected;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_uniform_automation_markdown on public.revenue_rate_drafts;

create trigger trg_protect_uniform_automation_markdown
before insert or update of new_price, old_price, decision_id, intent_source
on public.revenue_rate_drafts
for each row
execute function public.protect_uniform_automation_markdown();
