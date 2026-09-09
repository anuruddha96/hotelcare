-- Tighten initial guest-request audit history. This complements the main guest
-- request validator and specifically prevents fabricated pre-populated histories.

create or replace function public.validate_guest_request_initial_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_events jsonb;
  v_count integer;
  v_status text;
  v_claim_role text := current_setting('request.jwt.claim.role', true);
  v_role public.user_role;
  v_event jsonb;
  v_i integer;
begin
  if tg_op <> 'INSERT' or new.note_type <> 'guest_request' then
    return new;
  end if;

  begin
    v_payload := new.content::jsonb;
  exception when others then
    raise exception 'Guest request content must be valid JSON';
  end;

  v_status := coalesce(v_payload ->> 'status', '');
  v_events := v_payload -> 'events';
  if jsonb_typeof(v_events) <> 'array' then
    raise exception 'Guest request events must be an array';
  end if;
  v_count := jsonb_array_length(v_events);

  if v_status = 'requested' then
    if v_count <> 1 or coalesce(v_events -> 0 ->> 'status', '') <> 'requested' then
      raise exception 'A new requested item must contain exactly one requested event';
    end if;
  elsif v_status = 'delivered' then
    if v_count <> 1 or coalesce(v_events -> 0 ->> 'status', '') <> 'delivered' then
      raise exception 'A delivered handover must contain exactly one delivered event';
    end if;
  elsif v_status = 'resolved' then
    if v_count <> 2
       or coalesce(v_events -> 0 ->> 'status', '') <> 'delivered'
       or coalesce(v_events -> 1 ->> 'status', '') <> 'resolved'
       or coalesce((v_payload ->> 'requiresReturn')::boolean, false) then
      raise exception 'A resolved handover must be a non-returnable delivered then resolved item';
    end if;
  else
    raise exception 'Invalid initial guest request status';
  end if;

  if auth.uid() is not null and v_claim_role <> 'service_role' then
    v_role := public.get_user_role(auth.uid());
    if v_status in ('delivered','resolved') and v_role not in (
      'reception'::public.user_role,
      'front_office'::public.user_role,
      'reception_manager'::public.user_role,
      'manager'::public.user_role,
      'admin'::public.user_role,
      'top_management'::public.user_role,
      'top_management_manager'::public.user_role,
      'housekeeping_manager'::public.user_role,
      'supervisor'::public.user_role
    ) then
      raise exception 'Only eligible reception/management users can record an immediate guest handover';
    end if;

    for v_i in 0..v_count - 1 loop
      v_event := v_events -> v_i;
      if coalesce(v_event ->> 'actorId', '') <> auth.uid()::text then
        raise exception 'Initial guest request events must identify the authenticated user';
      end if;
      if coalesce(v_event ->> 'at', '') = '' then
        raise exception 'Guest request event timestamp is required';
      end if;
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_guest_request_initial_events() from public;

drop trigger if exists aa_validate_guest_request_initial_events_trigger on public.housekeeping_notes;
create trigger aa_validate_guest_request_initial_events_trigger
before insert on public.housekeeping_notes
for each row execute function public.validate_guest_request_initial_events();