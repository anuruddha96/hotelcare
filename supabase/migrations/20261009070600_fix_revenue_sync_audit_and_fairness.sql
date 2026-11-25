-- Repair failing optional rate-audit enrichment and revenue-sync queue starvation.
-- Missing draft matches must not raise "record d is not assigned yet".
-- Failed PMS pulls remain stale, but do not monopolize every scheduler slot.
-- Replaces two existing functions without changing any automation enable flags.

CREATE OR REPLACE FUNCTION public.enrich_rate_change_audit_ai_metadata()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_found_draft_id uuid;
  v_found_decision_reason text;
  v_found_reason_detail text;
  v_draft_id text;
  v_push_run_id text;
  v_room_type_name text;
  v_occupancy integer;
begin
  new.payload := coalesce(new.payload, '{}'::jsonb);

  -- Normalize explicit AI labels written by older ChatGPT/HotelCare runs.
  if lower(coalesce(new.payload->>'actor_name', '')) in ('ai', 'hotelcare ai') then
    new.payload := new.payload || jsonb_build_object('actor_name', 'HotelCare AI');
  end if;

  -- Nothing else to do when a complete human/system attribution already exists.
  if coalesce(new.payload->>'actor_name', '') <> ''
     and coalesce(new.payload->>'reason_detail', '') <> '' then
    return new;
  end if;

  v_draft_id := new.payload->>'draft_id';
  v_push_run_id := new.payload->>'push_run_id';
  v_room_type_name := new.payload->>'room_type_name';
  begin
    v_occupancy := nullif(new.payload->>'occupancy', '')::integer;
  exception when others then
    v_occupancy := null;
  end;

  -- Push audit rows carry draft_id. Previo confirmation rows carry push_run_id
  -- plus the room/occupancy identity. Resolve either back to the originating
  -- revenue_rate_draft so the actor and RM rationale survive confirmation.
  if v_draft_id is not null and v_draft_id ~* '^[0-9a-f-]{36}$' then
    select r.id, r.decision_reason, r.reason_detail
      into v_found_draft_id, v_found_decision_reason, v_found_reason_detail
      from public.revenue_rate_drafts r
     where r.id = v_draft_id::uuid
     limit 1;
  elsif v_push_run_id is not null and v_push_run_id ~* '^[0-9a-f-]{36}$' then
    select r.id, r.decision_reason, r.reason_detail
      into v_found_draft_id, v_found_decision_reason, v_found_reason_detail
      from public.revenue_rate_drafts r
     where r.hotel_id = new.hotel_id
       and r.stay_date = new.stay_date
       and r.push_run_id = v_push_run_id::uuid
       and (v_room_type_name is null or r.room_type_name = v_room_type_name)
       and (v_occupancy is null or r.occupancy = v_occupancy)
       and (new.new_rate_eur is null or r.new_price = new.new_rate_eur)
     order by r.created_at desc
     limit 1;
  end if;

  if v_found_draft_id is not null and lower(coalesce(v_found_decision_reason, '')) like 'ai\_%' escape '\' then
    new.payload := new.payload || jsonb_strip_nulls(jsonb_build_object(
      'actor_name', 'HotelCare AI',
      'decision_reason', v_found_decision_reason,
      'reason_detail', v_found_reason_detail,
      'originating_draft_id', v_found_draft_id::text
    ));
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_next_revenue_sync(_fresh_for interval DEFAULT '00:30:00'::interval, _lease_for interval DEFAULT '00:10:00'::interval)
 RETURNS TABLE(out_hotel_id text, out_organization_slug text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hotel text;
  v_org text;
BEGIN
  -- Seed state rows for every active Previo-connected property.
  INSERT INTO public.revenue_sync_state AS s (hotel_id, organization_slug)
  SELECT hc.hotel_id, o.slug
  FROM public.hotel_configurations hc
  JOIN public.organizations o ON o.id = hc.organization_id
  WHERE COALESCE(hc.is_active, true)
    AND public.hotel_has_active_previo(hc.hotel_id)
  ON CONFLICT (hotel_id) DO NOTHING;

  -- Global single-flight: if any property is being refreshed, wait.
  PERFORM 1 FROM public.revenue_sync_state st
   WHERE st.lease_expires_at IS NOT NULL AND st.lease_expires_at > now()
   LIMIT 1;
  IF FOUND THEN
    RETURN;
  END IF;

  SELECT s2.hotel_id, s2.organization_slug
    INTO v_hotel, v_org
  FROM public.revenue_sync_state s2
  WHERE public.hotel_has_active_previo(s2.hotel_id)
    AND (s2.last_success_at IS NULL OR s2.last_success_at < now() - _fresh_for)
  ORDER BY COALESCE(s2.lease_started_at, s2.updated_at, s2.last_success_at) ASC NULLS FIRST,
           s2.last_success_at ASC NULLS FIRST,
           s2.hotel_id ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_hotel IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.revenue_sync_state s3
     SET lease_started_at = now(),
         lease_expires_at = now() + _lease_for,
         lease_owner = NULL,
         last_error = NULL,
         updated_at = now()
   WHERE s3.hotel_id = v_hotel;

  RETURN QUERY SELECT v_hotel, v_org;
END;
$function$;
