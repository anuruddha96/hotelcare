-- Make maintenance completion photos optional and align Storage permissions
-- with property-level maintenance collaboration.

CREATE OR REPLACE FUNCTION public.work_maintenance_ticket(
  p_ticket_id uuid,
  p_action text,
  p_note text,
  p_expected_updated_at timestamptz,
  p_hold_reason text DEFAULT NULL,
  p_completion_photo text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user public.profiles%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_action text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_action, '')));
  v_note text := pg_catalog.btrim(coalesce(p_note, ''));
  v_hold_reason text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_hold_reason, '')));
  v_completion_photo text := pg_catalog.btrim(coalesce(p_completion_photo, ''));
  v_assignee_name text;
  v_assist_prefix text := '';
  v_history text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to update maintenance tickets' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_user
  FROM public.profiles
  WHERE id = auth.uid()
    AND deleted_at IS NULL;

  IF NOT FOUND OR v_user.role::text NOT IN ('maintenance', 'maintenance_manager') THEN
    RAISE EXCEPTION 'Only maintenance team members can use this workflow' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND OR v_ticket.department IS DISTINCT FROM 'maintenance' THEN
    RAISE EXCEPTION 'Maintenance ticket not found' USING ERRCODE = '22023';
  END IF;

  IF v_user.organization_slug IS NULL
     OR v_ticket.organization_slug IS DISTINCT FROM v_user.organization_slug
     OR v_user.assigned_hotel IS NULL
     OR v_ticket.hotel IS NULL
     OR public.get_hotel_name_from_id(v_user.assigned_hotel)
        IS DISTINCT FROM public.get_hotel_name_from_id(v_ticket.hotel) THEN
    RAISE EXCEPTION 'Ticket is outside your assigned property' USING ERRCODE = '42501';
  END IF;

  IF p_expected_updated_at IS NULL
     OR v_ticket.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'This ticket was updated by another user. Refresh and try again.' USING ERRCODE = '40001';
  END IF;

  IF v_action NOT IN ('start', 'hold', 'resume', 'submit') THEN
    RAISE EXCEPTION 'Unsupported maintenance action' USING ERRCODE = '22023';
  END IF;

  IF v_ticket.status = 'completed'::public.ticket_status THEN
    RAISE EXCEPTION 'Completed tickets cannot be changed from the worker view' USING ERRCODE = '22023';
  END IF;

  IF coalesce(v_ticket.pending_supervisor_approval, false) THEN
    RAISE EXCEPTION 'This ticket is already awaiting supervisor approval' USING ERRCODE = '22023';
  END IF;

  IF v_ticket.assigned_to IS NOT NULL THEN
    SELECT full_name INTO v_assignee_name
    FROM public.profiles
    WHERE id = v_ticket.assigned_to;

    IF v_ticket.assigned_to IS DISTINCT FROM auth.uid() THEN
      v_assist_prefix := 'Assisting ticket assigned to ' ||
        coalesce(v_assignee_name, 'another maintenance teammate') || '. ';
    END IF;
  END IF;

  IF v_action = 'start' THEN
    UPDATE public.tickets
    SET status = 'in_progress'::public.ticket_status,
        on_hold = false,
        hold_reason = NULL,
        updated_at = pg_catalog.now()
    WHERE id = v_ticket.id;
    v_history := v_assist_prefix || 'Work started.';

  ELSIF v_action = 'hold' THEN
    IF v_hold_reason NOT IN (
      'parts_pending', 'purchase_in_progress', 'waiting_for_access',
      'waiting_for_approval', 'external_contractor', 'other'
    ) THEN
      RAISE EXCEPTION 'Choose a valid pending reason' USING ERRCODE = '22023';
    END IF;

    UPDATE public.tickets
    SET status = 'in_progress'::public.ticket_status,
        on_hold = true,
        hold_reason = v_hold_reason,
        updated_at = pg_catalog.now()
    WHERE id = v_ticket.id;
    v_history := v_assist_prefix || 'Marked pending: ' || v_hold_reason ||
      CASE WHEN pg_catalog.length(v_note) > 0
        THEN ' — ' || pg_catalog.left(v_note, 1500)
        ELSE ''
      END;

  ELSIF v_action = 'resume' THEN
    UPDATE public.tickets
    SET status = 'in_progress'::public.ticket_status,
        on_hold = false,
        hold_reason = NULL,
        updated_at = pg_catalog.now()
    WHERE id = v_ticket.id;
    v_history := v_assist_prefix || 'Work resumed.';

  ELSE
    IF v_ticket.status IS DISTINCT FROM 'in_progress'::public.ticket_status
       OR coalesce(v_ticket.on_hold, false) THEN
      RAISE EXCEPTION 'Start or resume the ticket before submitting completion' USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.length(v_note) < 3 THEN
      RAISE EXCEPTION 'Describe the completed repair' USING ERRCODE = '22023';
    END IF;

    UPDATE public.tickets
    SET status = 'in_progress'::public.ticket_status,
        resolution_text = pg_catalog.left(v_note, 4000),
        completion_photos = CASE
          WHEN pg_catalog.length(v_completion_photo) > 0
            THEN coalesce(v_ticket.completion_photos, ARRAY[]::text[]) ||
                 ARRAY[pg_catalog.left(v_completion_photo, 1000)]
          ELSE coalesce(v_ticket.completion_photos, ARRAY[]::text[])
        END,
        pending_supervisor_approval = true,
        on_hold = false,
        hold_reason = NULL,
        updated_at = pg_catalog.now()
    WHERE id = v_ticket.id;

    v_history := v_assist_prefix || 'Completion submitted for supervisor approval: ' ||
      pg_catalog.left(v_note, 1800) ||
      CASE WHEN pg_catalog.length(v_completion_photo) > 0
        THEN ' Completion photo attached.'
        ELSE ' No completion photo attached.'
      END;
  END IF;

  INSERT INTO public.comments (ticket_id, user_id, organization_slug, content)
  VALUES (
    v_ticket.id,
    auth.uid(),
    v_ticket.organization_slug,
    '[Maintenance team action: ' || v_action || '] ' || v_history
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.work_maintenance_ticket(uuid,text,text,timestamptz,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_maintenance_ticket(uuid,text,text,timestamptz,text,text)
  TO authenticated;

DROP POLICY IF EXISTS "Maintenance teammates can upload shared ticket attachments"
  ON storage.objects;
CREATE POLICY "Maintenance teammates can upload shared ticket attachments"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'ticket-attachments'
  AND EXISTS (
    SELECT 1
    FROM public.tickets t
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE t.id::text = (storage.foldername(name))[1]
      AND t.department = 'maintenance'
      AND p.deleted_at IS NULL
      AND p.role::text IN ('maintenance', 'maintenance_manager')
      AND t.organization_slug = p.organization_slug
      AND p.assigned_hotel IS NOT NULL
      AND t.hotel IS NOT NULL
      AND public.get_hotel_name_from_id(p.assigned_hotel)
          = public.get_hotel_name_from_id(t.hotel)
  )
);

DROP POLICY IF EXISTS "Maintenance teammates can delete shared ticket attachments"
  ON storage.objects;
CREATE POLICY "Maintenance teammates can delete shared ticket attachments"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'ticket-attachments'
  AND EXISTS (
    SELECT 1
    FROM public.tickets t
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE t.id::text = (storage.foldername(name))[1]
      AND t.department = 'maintenance'
      AND p.deleted_at IS NULL
      AND p.role::text IN ('maintenance', 'maintenance_manager')
      AND t.organization_slug = p.organization_slug
      AND p.assigned_hotel IS NOT NULL
      AND t.hotel IS NOT NULL
      AND public.get_hotel_name_from_id(p.assigned_hotel)
          = public.get_hotel_name_from_id(t.hotel)
  )
);
