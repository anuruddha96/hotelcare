-- RD Hotels Work Schedule pilot ONLY. Apply to an approved test database after review;
-- never upload an Excel workbook or create duplicate login accounts from imported names.
-- The immutable profile UUID is the link to the employee's existing HotelCare login;
-- nickname is display metadata and can change without breaking a confirmed link.
CREATE TABLE public.work_schedule_employee_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL DEFAULT 'rdhotels' CHECK (organization_slug = 'rdhotels'),
  hotel_id text NOT NULL,
  source_label text NOT NULL CHECK (length(btrim(source_label)) BETWEEN 1 AND 180
    AND source_label !~ '[[:cntrl:]]'),
  staff_id uuid NOT NULL REFERENCES public.profiles(id),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One source name/alias may only point to one account in a venue; aliases are
-- venue-specific. Identical names in one worksheet must be reviewed, not guessed.
CREATE UNIQUE INDEX work_schedule_link_venue_alias_unique
  ON public.work_schedule_employee_links(hotel_id, lower(btrim(source_label)));
CREATE INDEX work_schedule_link_account ON public.work_schedule_employee_links(staff_id, hotel_id);
CREATE TABLE public.work_schedule_employee_link_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.work_schedule_employee_links(id),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  event_kind text NOT NULL CHECK (event_kind = 'confirm'),
  after_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.work_schedule_employee_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_schedule_employee_link_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_schedule_employee_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.work_schedule_employee_link_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.work_schedule_employee_links TO authenticated;
CREATE POLICY "Only the authorized venue manager can read confirmed Excel account links"
ON public.work_schedule_employee_links FOR SELECT TO authenticated
USING (organization_slug = 'rdhotels' AND public.work_schedule_can_manage(hotel_id));
-- No browser table-write grants or policies, and no employee/audit-log SELECT grant.

-- Do not modify the earlier staff_for_hotel return signature: this separate RPC
-- exposes account nickname to authorized venue managers for manual confirmation.
CREATE FUNCTION public.work_schedule_staff_accounts_for_hotel(p_hotel_id text)
RETURNS TABLE(id uuid, full_name text, nickname text, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.work_schedule_can_manage(p_hotel_id) THEN
    RAISE EXCEPTION 'Schedule accounts are not permitted for this venue' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT p.id, p.full_name, p.nickname, p.role::text
  FROM public.profiles p
  JOIN public.hotel_configurations h ON h.hotel_id = p_hotel_id
  JOIN public.organizations o ON o.id = h.organization_id
  WHERE o.slug = 'rdhotels' AND p.organization_slug = 'rdhotels'
    AND (p.assigned_hotel IN (h.hotel_id, h.hotel_name) OR p.hotel_id = h.hotel_id)
  ORDER BY p.full_name, p.nickname, p.id;
END;
$$;
REVOKE ALL ON FUNCTION public.work_schedule_staff_accounts_for_hotel(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.work_schedule_staff_accounts_for_hotel(text) TO authenticated;

-- Atomic, strictly additive alias confirmation. Existing links cannot silently be
-- reassigned to another staff account by a spreadsheet or a different manager.
-- Any correction/reassignment requires a separately reviewed and audited flow.
CREATE FUNCTION public.work_schedule_confirm_employee_links(p_hotel_id text, p_links jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_item jsonb;
  v_label text;
  v_staff uuid;
  v_existing public.work_schedule_employee_links%ROWTYPE;
  v_new public.work_schedule_employee_links%ROWTYPE;
  v_count integer := 0;
BEGIN
  IF NOT public.work_schedule_can_manage(p_hotel_id) THEN
    RAISE EXCEPTION 'Cannot link employees for this venue' USING ERRCODE = '42501';
  END IF;
  IF p_links IS NULL OR jsonb_typeof(p_links) <> 'array'
    OR jsonb_array_length(p_links) NOT BETWEEN 1 AND 150 THEN
    RAISE EXCEPTION 'Provide 1 to 150 explicitly confirmed employee links';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_links) LOOP
    IF jsonb_typeof(v_item) <> 'object' OR jsonb_typeof(v_item->'staff_id') <> 'string'
      OR jsonb_typeof(v_item->'source_label') <> 'string' THEN
      RAISE EXCEPTION 'An employee link requires a source name and account ID';
    END IF;
    v_label := btrim(v_item->>'source_label');
    IF length(v_label) NOT BETWEEN 1 AND 180 OR v_label ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'Invalid Excel employee label';
    END IF;
    v_staff := (v_item->>'staff_id')::uuid;
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.hotel_configurations h ON h.hotel_id = p_hotel_id
      JOIN public.organizations o ON o.id = h.organization_id
      WHERE p.id = v_staff AND p.organization_slug = 'rdhotels' AND o.slug = 'rdhotels'
        AND (p.assigned_hotel IN (h.hotel_id, h.hotel_name) OR p.hotel_id = h.hotel_id)
    ) THEN
      RAISE EXCEPTION 'Employee account is not assigned to the authorized venue'
        USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_existing FROM public.work_schedule_employee_links
      WHERE hotel_id = p_hotel_id AND lower(btrim(source_label)) = lower(v_label)
      FOR UPDATE;
    IF FOUND THEN
      IF v_existing.staff_id <> v_staff THEN
        RAISE EXCEPTION 'Excel name is already linked to a different account; explicit audited correction required'
          USING ERRCODE = '23505';
      END IF;
      CONTINUE; -- Idempotent confirmation preserves stable account and audit history.
    END IF;
    INSERT INTO public.work_schedule_employee_links(hotel_id, source_label, staff_id, created_by)
    VALUES (p_hotel_id, v_label, v_staff, auth.uid()) RETURNING * INTO v_new;
    INSERT INTO public.work_schedule_employee_link_events(link_id, actor_id, event_kind, after_data)
    VALUES (v_new.id, auth.uid(), 'confirm', to_jsonb(v_new));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.work_schedule_confirm_employee_links(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.work_schedule_confirm_employee_links(text,jsonb) TO authenticated;
