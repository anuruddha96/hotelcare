-- Issue #287: supervisor review for same-stay extensions. No cleaning or
-- completion fields are modified here. Policies are deliberately empty until
-- a manager configures the actual rules for each property.
CREATE TABLE public.housekeeping_stay_service_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text NOT NULL,
  service_code text NOT NULL CHECK (service_code IN ('towel_change', 'linen_change', 'full_clean')),
  display_label text NOT NULL CHECK (length(btrim(display_label)) > 0),
  first_due_after_nights integer NOT NULL CHECK (first_due_after_nights > 0),
  repeat_every_nights integer CHECK (repeat_every_nights > 0),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_slug, hotel_id, service_code),
  FOREIGN KEY (organization_slug) REFERENCES public.organizations(slug),
  CHECK (length(btrim(hotel_id)) > 0)
);

CREATE TABLE public.housekeeping_stay_extension_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL REFERENCES public.organizations(slug),
  hotel_id text NOT NULL,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  arrival_date date NOT NULL,
  original_checkout_date date NOT NULL,
  previous_checkout_date date NOT NULL,
  revised_checkout_date date NOT NULL,
  business_date date NOT NULL,
  nights_completed integer NOT NULL CHECK (nights_completed >= 0),
  planned_nights integer NOT NULL CHECK (planned_nights >= 1),
  -- A room-night continuity match is NOT proof of guest identity. Managers
  -- must confirm a suspected extension before automatic service assignment.
  identity_status text NOT NULL DEFAULT 'needs_verification'
    CHECK (identity_status IN ('needs_verification', 'verified')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'acknowledged', 'resolved')),
  services_due jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_services jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_configured boolean NOT NULL DEFAULT false,
  extension_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users(id),
  resolution_note text,
  UNIQUE (organization_slug, hotel_id, room_id, arrival_date),
  CHECK (original_checkout_date > arrival_date AND revised_checkout_date > previous_checkout_date)
);
CREATE INDEX housekeeping_stay_extension_reviews_queue_idx
  ON public.housekeeping_stay_extension_reviews (organization_slug, hotel_id, status, updated_at DESC);

ALTER TABLE public.housekeeping_stay_service_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.housekeeping_stay_extension_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Property managers read stay service policies"
  ON public.housekeeping_stay_service_policies FOR SELECT TO authenticated
  USING (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id));
CREATE POLICY "Property managers configure stay service policies"
  ON public.housekeeping_stay_service_policies FOR ALL TO authenticated
  USING (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id))
  WITH CHECK (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id));
CREATE POLICY "Property managers view extension reviews"
  ON public.housekeeping_stay_extension_reviews FOR SELECT TO authenticated
  USING (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id));
-- No direct client writes to the review queue: the detection trigger inserts,
-- and a narrowly scoped RPC is the sole path for acknowledgements.
REVOKE INSERT, UPDATE, DELETE ON public.housekeeping_stay_extension_reviews FROM anon, authenticated;
GRANT SELECT ON public.housekeeping_stay_extension_reviews TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.housekeeping_stay_service_policies TO authenticated;

CREATE OR REPLACE FUNCTION public.hc_record_stay_extension_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  old_meta jsonb := coalesce(OLD.pms_metadata, '{}'::jsonb);
  new_meta jsonb := coalesce(NEW.pms_metadata, '{}'::jsonb);
  old_total integer;
  new_total integer;
  old_night integer;
  new_night integer;
  old_work_day date;
  new_work_day date;
  old_arrival date;
  new_arrival date;
  old_departure date;
  new_departure date;
  completed_nights integer;
  canonical_hotel text;
  local_zone text := 'Europe/Budapest';
  policy record;
  policy_count integer := 0;
  due_night integer;
  next_night integer;
  last_done date;
  due_items jsonb := '[]'::jsonb;
  upcoming_items jsonb := '[]'::jsonb;
  full_clean_due boolean := false;
  event_item jsonb;
BEGIN
  IF NEW.hotel IS DISTINCT FROM OLD.hotel
     OR NEW.organization_slug IS DISTINCT FROM OLD.organization_slug
     OR NEW.organization_slug IS NULL
     OR NEW.hotel IS NULL
     OR coalesce(new_meta ->> 'isCancelled', 'false') = 'true'
     OR coalesce(new_meta ->> 'isNoShow', 'false') = 'true'
     OR coalesce(new_meta ->> 'notArrived', 'false') = 'true'
     OR coalesce(new_meta ->> 'checkedOutToday', 'false') = 'true'
  THEN RETURN NEW; END IF;

  -- Only compare two authoritative room snapshots with a coherent calendar
  -- date and original arrival. Never infer a stay from room number alone.
  IF coalesce(old_meta ->> 'totalNights', '') !~ '^[0-9]{1,4}$'
     OR coalesce(new_meta ->> 'totalNights', '') !~ '^[0-9]{1,4}$'
     OR coalesce(old_meta ->> 'currentNight', '') !~ '^[0-9]{1,4}$'
     OR coalesce(new_meta ->> 'currentNight', '') !~ '^[0-9]{1,4}$'
     OR coalesce(old_meta ->> 'pmsSyncDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
     OR coalesce(new_meta ->> 'pmsSyncDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
  THEN RETURN NEW; END IF;
  old_total := (old_meta ->> 'totalNights')::integer;
  new_total := (new_meta ->> 'totalNights')::integer;
  old_night := (old_meta ->> 'currentNight')::integer;
  new_night := (new_meta ->> 'currentNight')::integer;
  IF old_total < 1 OR new_total <= old_total OR old_night < 1 OR new_night < 1
     OR old_night > old_total OR new_night > new_total
  THEN RETURN NEW; END IF;
  old_work_day := (old_meta ->> 'pmsSyncDate')::date;
  new_work_day := (new_meta ->> 'pmsSyncDate')::date;
  IF new_work_day < old_work_day OR new_work_day > old_work_day + 2
     OR new_work_day > (now() AT TIME ZONE 'Europe/Budapest')::date + 1
  THEN RETURN NEW; END IF;

  -- Previo's currentNight is the completed-night count on departure day,
  -- but is completed nights + 1 on a stayover day. Compare inferred arrival
  -- across both snapshots; a different guest / rollover is NOT an extension.
  old_arrival := old_work_day - (old_night - CASE WHEN coalesce(old_meta ->> 'scheduledDepartureToday', 'false') = 'true' OR OLD.is_checkout_room THEN 0 ELSE 1 END);
  new_arrival := new_work_day - (new_night - CASE WHEN coalesce(new_meta ->> 'scheduledDepartureToday', 'false') = 'true' OR NEW.is_checkout_room THEN 0 ELSE 1 END);
  IF old_arrival <> new_arrival
     OR (old_meta ? 'arrivalDate' AND old_meta ->> 'arrivalDate' <> old_arrival::text)
     OR (new_meta ? 'arrivalDate' AND new_meta ->> 'arrivalDate' <> new_arrival::text)
     OR new_arrival >= new_work_day
     OR old_arrival + old_total < old_work_day
  THEN RETURN NEW; END IF;
  old_departure := old_arrival + old_total;
  new_departure := new_arrival + new_total;
  IF new_departure <= old_departure OR new_departure <= new_work_day
  THEN RETURN NEW; END IF;

  SELECT hc.hotel_id INTO canonical_hotel
  FROM public.hotel_configurations hc
  JOIN public.organizations org ON org.id = hc.organization_id
  WHERE org.slug = NEW.organization_slug
    AND (hc.hotel_id = NEW.hotel OR hc.hotel_name = NEW.hotel)
  LIMIT 1;
  IF canonical_hotel IS NULL THEN RETURN NEW; END IF;
  SELECT timezone INTO local_zone
  FROM public.housekeeping_automation_settings
  WHERE organization_slug = NEW.organization_slug AND hotel_id = canonical_hotel
  LIMIT 1;
  local_zone := coalesce(nullif(local_zone, ''), 'Europe/Budapest');
  -- Day counts deliberately use calendar dates, not 24-hour UTC durations.
  completed_nights := least(new_total, greatest(0, new_work_day - new_arrival));

  -- Each venue has its OWN policy. A missing policy is an explicit manager
  -- configuration request; we never silently apply the global 3/5 cadence.
  FOR policy IN
    SELECT p.* FROM public.housekeeping_stay_service_policies p
    WHERE p.organization_slug = NEW.organization_slug
      AND p.hotel_id = canonical_hotel AND p.enabled
    ORDER BY CASE WHEN p.service_code = 'full_clean' THEN 0 ELSE 1 END, p.service_code
  LOOP
    policy_count := policy_count + 1;
    due_night := NULL;
    next_night := NULL;
    IF completed_nights >= policy.first_due_after_nights THEN
      due_night := policy.first_due_after_nights;
      IF policy.repeat_every_nights IS NOT NULL THEN
        due_night := due_night + ((completed_nights - due_night) / policy.repeat_every_nights) * policy.repeat_every_nights;
      END IF;
    END IF;
    IF due_night IS NULL THEN
      next_night := policy.first_due_after_nights;
    ELSIF policy.repeat_every_nights IS NOT NULL THEN
      next_night := due_night + policy.repeat_every_nights;
    END IF;
    last_done := CASE policy.service_code
      WHEN 'towel_change' THEN NEW.last_towel_change
      WHEN 'linen_change' THEN NEW.last_linen_change
      ELSE NULL
    END;
    -- Completion dates before this guest arrived cannot satisfy this stay.
    IF due_night IS NOT NULL AND (last_done IS NULL OR last_done < new_arrival + due_night) THEN
      IF policy.service_code = 'full_clean' THEN full_clean_due := true; END IF;
      due_items := due_items || jsonb_build_array(jsonb_build_object(
        'service', policy.service_code, 'label', policy.display_label,
        'dueNight', due_night, 'dueDate', (new_arrival + due_night)::text,
        'lastRecordedCompletion', last_done
      ));
    END IF;
    IF next_night IS NOT NULL AND next_night < new_total THEN
      upcoming_items := upcoming_items || jsonb_build_array(jsonb_build_object(
        'service', policy.service_code, 'label', policy.display_label,
        'dueNight', next_night, 'dueDate', (new_arrival + next_night)::text
      ));
    END IF;
  END LOOP;
  -- A configured full clean covers towel and bed linen; don't recommend
  -- duplicate work. Existing assignments or instructions are never altered.
  IF full_clean_due THEN
    SELECT coalesce(jsonb_agg(item), '[]'::jsonb) INTO due_items
    FROM jsonb_array_elements(due_items) item
    WHERE item ->> 'service' = 'full_clean';
  END IF;

  event_item := jsonb_build_object(
    'from', old_departure, 'to', new_departure,
    'detectedOn', new_work_day, 'completedNights', completed_nights
  );
  INSERT INTO public.housekeeping_stay_extension_reviews (
    organization_slug, hotel_id, room_id, arrival_date,
    original_checkout_date, previous_checkout_date, revised_checkout_date,
    business_date, nights_completed, planned_nights, identity_status,
    services_due, next_services, policy_configured, extension_history
  ) VALUES (
    NEW.organization_slug, canonical_hotel, NEW.id, new_arrival,
    old_departure, old_departure, new_departure,
    new_work_day, completed_nights, new_total, 'needs_verification',
    due_items, upcoming_items, policy_count > 0, jsonb_build_array(event_item)
  )
  ON CONFLICT (organization_slug, hotel_id, room_id, arrival_date)
  DO UPDATE SET
    previous_checkout_date = EXCLUDED.previous_checkout_date,
    revised_checkout_date = EXCLUDED.revised_checkout_date,
    business_date = EXCLUDED.business_date,
    nights_completed = EXCLUDED.nights_completed,
    planned_nights = EXCLUDED.planned_nights,
    status = 'pending',
    identity_status = 'needs_verification',
    acknowledged_at = NULL,
    acknowledged_by = NULL,
    resolution_note = NULL,
    services_due = EXCLUDED.services_due,
    next_services = EXCLUDED.next_services,
    policy_configured = EXCLUDED.policy_configured,
    extension_history = housekeeping_stay_extension_reviews.extension_history || jsonb_build_array(event_item),
    updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER zzz_hc_detect_stay_extension
AFTER UPDATE OF pms_metadata, guest_nights_stayed, is_checkout_room ON public.rooms
FOR EACH ROW WHEN (OLD.pms_metadata IS DISTINCT FROM NEW.pms_metadata)
EXECUTE FUNCTION public.hc_record_stay_extension_review();

CREATE OR REPLACE FUNCTION public.hc_acknowledge_stay_extension(
  _review_id uuid, _identity_verified boolean, _resolution_note text DEFAULT NULL,
  _resolved boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  review_record public.housekeeping_stay_extension_reviews%ROWTYPE;
BEGIN
  SELECT * INTO review_record
  FROM public.housekeeping_stay_extension_reviews WHERE id = _review_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_next_day_housekeeping_plan(review_record.organization_slug, review_record.hotel_id) THEN
    RAISE EXCEPTION 'Not authorized for this property extension review';
  END IF;
  IF _resolved AND NOT _identity_verified AND nullif(btrim(coalesce(_resolution_note,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Explain why the candidate was dismissed';
  END IF;
  UPDATE public.housekeeping_stay_extension_reviews
  SET status = CASE WHEN _resolved THEN 'resolved' ELSE 'acknowledged' END,
      identity_status = CASE WHEN _identity_verified THEN 'verified' ELSE 'needs_verification' END,
      acknowledged_at = now(), acknowledged_by = auth.uid(),
      resolution_note = nullif(btrim(_resolution_note), ''), updated_at = now()
  WHERE id = _review_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.hc_acknowledge_stay_extension(uuid, boolean, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hc_acknowledge_stay_extension(uuid, boolean, text, boolean) TO authenticated;
