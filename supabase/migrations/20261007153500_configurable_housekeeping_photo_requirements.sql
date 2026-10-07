-- Shared, tenant-scoped housekeeping photo requirements.
-- The database and mobile capture UI use the same effective category list so
-- completion cannot disagree with what the housekeeper sees.

CREATE TABLE IF NOT EXISTS public.housekeeping_photo_requirements (
  hotel_configuration_id uuid NOT NULL REFERENCES public.hotel_configurations(id) ON DELETE CASCADE,
  category text NOT NULL,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  updated_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_configuration_id, category),
  CONSTRAINT housekeeping_photo_requirements_category_check CHECK (
    category = ANY (ARRAY[
      'bed','tea_coffee_table','bathroom','trash_bin','minibar',
      'towels_linen','entrance','living_area','kitchen','balcony',
      'windows','general_cleanliness'
    ]::text[])
  )
);

ALTER TABLE public.housekeeping_photo_requirements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Top managers can view housekeeping photo requirements" ON public.housekeeping_photo_requirements;
CREATE POLICY "Top managers can view housekeeping photo requirements"
ON public.housekeeping_photo_requirements
FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (
    public.get_user_role(auth.uid())::text IN ('admin','top_management','top_management_manager')
    AND EXISTS (
      SELECT 1
      FROM public.hotel_configurations hc
      JOIN public.organizations o ON o.id = hc.organization_id
      WHERE hc.id = housekeeping_photo_requirements.hotel_configuration_id
        AND o.slug = public.get_user_organization_slug(auth.uid())
    )
  )
);

CREATE OR REPLACE FUNCTION public.effective_housekeeping_photo_categories_for_room(p_room_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  room_org text;
  room_hotel text;
  config_id uuid;
  configured text[];
BEGIN
  SELECT r.organization_slug, r.hotel
    INTO room_org, room_hotel
    FROM public.rooms r
   WHERE r.id = p_room_id;

  IF room_org IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;

  SELECT hc.id
    INTO config_id
    FROM public.hotel_configurations hc
    JOIN public.organizations o ON o.id = hc.organization_id
   WHERE o.slug = room_org
     AND hc.is_active IS DISTINCT FROM false
     AND (
       lower(trim(hc.hotel_id)) = lower(trim(room_hotel))
       OR lower(trim(hc.hotel_name)) = lower(trim(room_hotel))
     )
   ORDER BY
     CASE WHEN lower(trim(hc.hotel_id)) = lower(trim(room_hotel)) THEN 0 ELSE 1 END,
     hc.created_at
   LIMIT 1;

  IF config_id IS NOT NULL THEN
    SELECT array_agg(hpr.category ORDER BY hpr.sort_order, hpr.category)
      INTO configured
      FROM public.housekeeping_photo_requirements hpr
     WHERE hpr.hotel_configuration_id = config_id;
  END IF;

  IF configured IS NOT NULL AND cardinality(configured) > 0 THEN
    RETURN configured;
  END IF;

  IF room_org = 'slnt'
     OR (
       room_org = 'rdhotels'
       AND lower(trim(room_hotel)) IN ('gozsdu-court', 'gozsdu court budapest')
     )
  THEN
    RETURN ARRAY['bed','tea_coffee_table','bathroom','trash_bin']::text[];
  END IF;

  RETURN ARRAY['bed','tea_coffee_table','bathroom','trash_bin','minibar']::text[];
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_housekeeping_photo_requirements(p_assignment_id uuid)
RETURNS TABLE(category text, sort_order integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  assignment_room uuid;
  assignment_org text;
  assignment_worker uuid;
  caller_role text;
  categories text[];
BEGIN
  SELECT ra.room_id, ra.organization_slug, ra.assigned_to
    INTO assignment_room, assignment_org, assignment_worker
    FROM public.room_assignments ra
   WHERE ra.id = p_assignment_id;

  IF assignment_room IS NULL THEN
    RAISE EXCEPTION 'Housekeeping assignment not found' USING ERRCODE = 'P0002';
  END IF;

  caller_role := public.get_user_role(auth.uid())::text;

  IF NOT public.is_super_admin(auth.uid()) THEN
    IF assignment_org IS DISTINCT FROM public.get_user_organization_slug(auth.uid()) THEN
      RAISE EXCEPTION 'Housekeeping assignment is outside your organization' USING ERRCODE = '42501';
    END IF;
    IF assignment_worker IS DISTINCT FROM auth.uid()
       AND caller_role NOT IN ('admin','top_management','top_management_manager','manager','housekeeping_manager','supervisor')
    THEN
      RAISE EXCEPTION 'Not authorized to view housekeeping photo requirements' USING ERRCODE = '42501';
    END IF;
  END IF;

  categories := public.effective_housekeeping_photo_categories_for_room(assignment_room);

  RETURN QUERY
  SELECT u.category, (u.ordinality - 1)::integer
  FROM unnest(categories) WITH ORDINALITY AS u(category, ordinality)
  ORDER BY u.ordinality;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_housekeeping_photo_requirements(
  p_hotel_configuration_id uuid,
  p_categories text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  caller_role text;
  config_org text;
  category text;
  idx integer;
  allowed text[] := ARRAY[
    'bed','tea_coffee_table','bathroom','trash_bin','minibar',
    'towels_linen','entrance','living_area','kitchen','balcony',
    'windows','general_cleanliness'
  ]::text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in required' USING ERRCODE = '42501';
  END IF;

  caller_role := public.get_user_role(auth.uid())::text;
  IF NOT public.is_super_admin(auth.uid())
     AND caller_role NOT IN ('admin','top_management','top_management_manager')
  THEN
    RAISE EXCEPTION 'Only top managers can change photo requirements' USING ERRCODE = '42501';
  END IF;

  IF p_categories IS NULL OR cardinality(p_categories) < 1 OR cardinality(p_categories) > 12 THEN
    RAISE EXCEPTION 'Choose between 1 and 12 photo sections' USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(*) FROM unnest(p_categories) c) <> (SELECT count(DISTINCT c) FROM unnest(p_categories) c) THEN
    RAISE EXCEPTION 'Photo sections must be unique' USING ERRCODE = '22023';
  END IF;

  FOREACH category IN ARRAY p_categories LOOP
    IF NOT category = ANY (allowed) THEN
      RAISE EXCEPTION 'Unsupported photo section: %', category USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT o.slug
    INTO config_org
    FROM public.hotel_configurations hc
    JOIN public.organizations o ON o.id = hc.organization_id
   WHERE hc.id = p_hotel_configuration_id;

  IF config_org IS NULL THEN
    RAISE EXCEPTION 'Hotel configuration not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_super_admin(auth.uid())
     AND config_org IS DISTINCT FROM public.get_user_organization_slug(auth.uid())
  THEN
    RAISE EXCEPTION 'Hotel is outside your organization' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.housekeeping_photo_requirements
   WHERE hotel_configuration_id = p_hotel_configuration_id;

  FOR idx IN 1..cardinality(p_categories) LOOP
    INSERT INTO public.housekeeping_photo_requirements(
      hotel_configuration_id, category, sort_order, updated_by, updated_at
    )
    VALUES (
      p_hotel_configuration_id, p_categories[idx], idx - 1, auth.uid(), now()
    );
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.effective_housekeeping_photo_categories_for_room(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.effective_housekeeping_photo_categories_for_room(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_housekeeping_photo_requirements(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_housekeeping_photo_requirements(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.set_housekeeping_photo_requirements(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_housekeeping_photo_requirements(uuid, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_daily_cleaning_photos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  required_cats text[];
  cat text;
  photo text;
  filename text;
  found boolean;
  room_hotel text;
  manager_override_assignment text := current_setting('hotelcare.manager_clean_override_assignment', true);
  trusted_rpc_override boolean := false;
  direct_manager_override boolean := false;
BEGIN
  SELECT r.hotel
    INTO room_hotel
    FROM public.rooms AS r
   WHERE r.id = NEW.room_id;

  trusted_rpc_override :=
    manager_override_assignment = NEW.id::text
    AND auth.uid() IS NOT NULL
    AND NEW.supervisor_approved IS TRUE
    AND NEW.supervisor_approved_by = auth.uid()
    AND NEW.service_result = 'cleaned'
    AND COALESCE(NEW.is_dnd, false) = false
    AND public.get_user_role(auth.uid())::text IN (
      'admin', 'top_management', 'top_management_manager',
      'manager', 'housekeeping_manager', 'supervisor'
    )
    AND public.user_can_access_hotel(auth.uid(), room_hotel);

  direct_manager_override :=
    TG_OP = 'UPDATE'
    AND auth.uid() IS NOT NULL
    AND NEW.status = 'completed'
    AND NEW.completed_at IS DISTINCT FROM OLD.completed_at
    AND NEW.supervisor_approved IS TRUE
    AND NEW.supervisor_approved_by = auth.uid()
    AND NEW.service_result = 'cleaned'
    AND COALESCE(NEW.is_dnd, false) = false
    AND public.get_user_role(auth.uid())::text IN (
      'admin', 'top_management', 'top_management_manager',
      'manager', 'housekeeping_manager', 'supervisor'
    )
    AND public.user_can_access_hotel(auth.uid(), room_hotel);

  IF trusted_rpc_override OR direct_manager_override THEN
    NEW.notes := NULLIF(
      btrim(
        replace(
          replace(
            replace(COALESCE(NEW.notes, ''), '[NO_SERVICE]', '[OVERRIDDEN_NO_SERVICE]'),
            '[NO_BOARD_NO_CLEANING]', '[OVERRIDDEN_NO_BOARD_NO_CLEANING]'
          ),
          '[TOWEL_CHANGE_ONLY]', '[OVERRIDDEN_TOWEL_CHANGE_ONLY]'
        )
      ),
      ''
    );
    RETURN NEW;
  END IF;

  IF NEW.status = 'completed'
     AND NEW.assignment_type = 'daily_cleaning'
     AND COALESCE(NEW.is_dnd, false) = false
     AND (NEW.notes IS NULL OR NEW.notes NOT LIKE '%[NO_SERVICE]%')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
  THEN
    required_cats := public.effective_housekeeping_photo_categories_for_room(NEW.room_id);

    IF required_cats IS NULL OR cardinality(required_cats) = 0 THEN
      RAISE EXCEPTION 'Cannot complete daily cleaning: photo requirements unavailable'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.completion_photos IS NULL OR cardinality(NEW.completion_photos) = 0 THEN
      RAISE EXCEPTION 'Cannot complete daily cleaning: required photos missing (%)', array_to_string(required_cats, ', ')
        USING ERRCODE = 'check_violation';
    END IF;

    FOREACH cat IN ARRAY required_cats LOOP
      found := false;
      FOREACH photo IN ARRAY NEW.completion_photos LOOP
        filename := split_part(photo, '/', array_length(string_to_array(photo, '/'), 1));
        IF left(filename, length(cat) + 1) = cat || '_' THEN
          found := true;
          EXIT;
        END IF;
      END LOOP;
      IF NOT found THEN
        RAISE EXCEPTION 'Cannot complete daily cleaning: missing required photo for category "%"', cat
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;
