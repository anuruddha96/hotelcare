-- HMB ONLY: preserve proven DND/No Service T/C debt on the room board
-- even before today's housekeeper assignments have been created.
-- This is a derived, short-lived board cache; never mutate rooms, PMS flags,
-- final snapshots, guest notes, or assignment ownership to show the badge.

CREATE TABLE IF NOT EXISTS public.hc_memories_daily_carry_board (
  business_date date NOT NULL,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  organization_slug text NOT NULL,
  carry_forward jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (business_date, room_id),
  CONSTRAINT hc_memories_daily_carry_active
    CHECK (carry_forward ->> 'active' = 'true')
);

CREATE INDEX IF NOT EXISTS hc_memories_daily_carry_org_day_idx
  ON public.hc_memories_daily_carry_board (organization_slug, business_date);

ALTER TABLE public.hc_memories_daily_carry_board ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hc_memories_daily_carry_board FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.hc_memories_daily_carry_board TO authenticated, service_role;

DROP POLICY IF EXISTS hc_memories_daily_carry_staff_read
  ON public.hc_memories_daily_carry_board;
CREATE POLICY hc_memories_daily_carry_staff_read
ON public.hc_memories_daily_carry_board
FOR SELECT TO authenticated
USING (
  public.is_super_admin((SELECT auth.uid()))
  OR (
    organization_slug = public.get_user_organization_slug((SELECT auth.uid()))
    AND EXISTS (
      SELECT 1
      FROM public.rooms r
      WHERE r.id = room_id
        AND r.organization_slug = hc_memories_daily_carry_board.organization_slug
        AND lower(btrim(coalesce(r.hotel,''))) IN (
          'hotel memories budapest', 'memories budapest', 'memories-budapest'
        )
        AND (
          public.get_user_role((SELECT auth.uid()))::text IN (
            'admin', 'top_management', 'top_management_manager'
          )
          OR r.hotel = ANY(public.user_assigned_hotel_keys((SELECT auth.uid())))
        )
    )
  )
);

CREATE OR REPLACE FUNCTION public.hc_refresh_memories_daily_carry_board(
  p_business_date date DEFAULT (now() AT TIME ZONE 'Europe/Budapest')::date
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
  v_upserted integer := 0;
  v_removed integer := 0;
BEGIN
  IF p_business_date IS NULL
    OR p_business_date < DATE '2026-10-21'
    OR p_business_date <> (now() AT TIME ZONE 'Europe/Budapest')::date
  THEN RETURN 0; END IF;

  -- Only one run at a time. All helper calls use the existing validated
  -- original-due snapshot proof, not the unreliable current-day room T/C flags.
  IF NOT pg_try_advisory_xact_lock(hashtext('hc_memories_daily_carry_board')) THEN
    RETURN 0;
  END IF;

  WITH verified AS MATERIALIZED (
    SELECT r.id AS room_id,
           r.organization_slug,
           checked.context -> 'carry_forward' AS payload
    FROM public.rooms r
    LEFT JOIN LATERAL (
      SELECT ra.service_result
      FROM public.room_assignments ra
      WHERE ra.room_id = r.id
        AND ra.assignment_date = p_business_date
        AND ra.status::text <> 'cancelled'
      ORDER BY
        (ra.service_result = 'cleaned') DESC,
        ra.updated_at DESC NULLS LAST, ra.created_at DESC NULLS LAST
      LIMIT 1
    ) current_work ON true
    CROSS JOIN LATERAL (
      SELECT public.hc_prove_housekeeping_carry_context(
        public.hc_memories_previous_service_context(
          r.id, p_business_date, 'daily_cleaning'
        ),
        r.id, p_business_date, 'daily_cleaning',
        current_work.service_result
      ) AS context
    ) checked
    WHERE lower(btrim(coalesce(r.hotel,''))) IN (
      'hotel memories budapest', 'memories budapest', 'memories-budapest'
    )
      AND r.organization_slug IS NOT NULL
  )
  INSERT INTO public.hc_memories_daily_carry_board AS board (
    business_date, room_id, organization_slug, carry_forward, updated_at
  )
  SELECT p_business_date, room_id, organization_slug, payload,
         statement_timestamp()
  FROM verified
  WHERE payload ->> 'active' = 'true'
  ON CONFLICT (business_date, room_id) DO UPDATE
  SET organization_slug = EXCLUDED.organization_slug,
      carry_forward = EXCLUDED.carry_forward,
      updated_at = EXCLUDED.updated_at
  WHERE board.carry_forward IS DISTINCT FROM EXCLUDED.carry_forward
    OR board.organization_slug IS DISTINCT FROM EXCLUDED.organization_slug;

  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  -- Resolve cache entries when checkout, a different reservation, a proven
  -- actual clean, or revised service evidence makes them ineligible.
  DELETE FROM public.hc_memories_daily_carry_board b
  WHERE b.business_date = p_business_date
    AND NOT EXISTS (
      SELECT 1
      FROM public.rooms r
      LEFT JOIN LATERAL (
        SELECT ra.service_result
        FROM public.room_assignments ra
        WHERE ra.room_id = r.id
          AND ra.assignment_date = p_business_date
          AND ra.status::text <> 'cancelled'
        ORDER BY
          (ra.service_result = 'cleaned') DESC,
          ra.updated_at DESC NULLS LAST, ra.created_at DESC NULLS LAST
        LIMIT 1
      ) current_work ON true
      WHERE r.id = b.room_id
        AND r.organization_slug = b.organization_slug
        AND lower(btrim(coalesce(r.hotel,''))) IN (
          'hotel memories budapest', 'memories budapest', 'memories-budapest'
        )
        AND public.hc_prove_housekeeping_carry_context(
          public.hc_memories_previous_service_context(
            r.id, p_business_date, 'daily_cleaning'
          ),
          r.id, p_business_date, 'daily_cleaning',
          current_work.service_result
        ) #>> '{carry_forward,active}' = 'true'
    );
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  DELETE FROM public.hc_memories_daily_carry_board
  WHERE business_date < p_business_date - 2;

  RETURN v_upserted + v_removed;
END;
$body$;

REVOKE ALL ON FUNCTION public.hc_refresh_memories_daily_carry_board(date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hc_refresh_memories_daily_carry_board(date)
  TO service_role;

-- Existing assignment carry refresh keeps working. This additional refresh
-- only fills the missing *unassigned-room* board path, 6 times an hour.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'hotelcare-memories-daily-carry-board',
      '5,15,25,35,45,55 * * * *',
      'SELECT public.hc_refresh_memories_daily_carry_board((now() AT TIME ZONE ''Europe/Budapest'')::date);'
    );
  END IF;
END
$cron$;

-- Backfill today's board immediately on deployment, without touching
-- assignments, room T/C flags, reservations, photos, or prior history.
SELECT public.hc_refresh_memories_daily_carry_board(
  (now() AT TIME ZONE 'Europe/Budapest')::date
);
