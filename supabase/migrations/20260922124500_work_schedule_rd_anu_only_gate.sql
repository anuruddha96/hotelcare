-- Security gate for the UNRELEASED Work Schedule pilot. This migration deliberately
-- does not enable SLNT: its dedicated tenant-scoped RPCs and housekeeping integration
-- must pass independent JWT/RLS tests before SLNT can access schedule data.
-- All grants use immutable existing profile UUIDs, not mutable nicknames or roles.
CREATE TABLE public.work_schedule_pilot_grants (
  organization_slug text NOT NULL CHECK (organization_slug = 'rdhotels'),
  hotel_id text NOT NULL,
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_slug, hotel_id, profile_id)
);
ALTER TABLE public.work_schedule_pilot_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_schedule_pilot_grants FROM PUBLIC, anon, authenticated;

-- Provision only when the existing RD username resolves to precisely one account.
-- In an empty synthetic test DB this creates zero grants, safely denying everyone.
-- Never create a second HotelCare login or transfer the account to another hotel.
DO $gate$
DECLARE v_matches integer;
BEGIN
  SELECT count(*) INTO v_matches FROM public.profiles
  WHERE organization_slug = 'rdhotels' AND lower(btrim(nickname)) = 'anu_000';
  IF v_matches > 1 THEN
    RAISE EXCEPTION 'Ambiguous anu_000 identity: no work schedule grants can be seeded';
  END IF;
  IF v_matches = 1 THEN
    INSERT INTO public.work_schedule_pilot_grants(organization_slug, hotel_id, profile_id)
    SELECT 'rdhotels', h.hotel_id, p.id
    FROM public.profiles p
    JOIN public.organizations o ON o.slug = 'rdhotels'
    JOIN public.hotel_configurations h ON h.organization_id = o.id
    WHERE p.organization_slug = 'rdhotels' AND lower(btrim(p.nickname)) = 'anu_000';
  END IF;
END
$gate$;

-- Replace the broad RD manager/HR test permission. The profile must belong to
-- the hotel's organization AND have its exact profile UUID granted for that hotel.
-- This is checked independently by every schedule read/write RPC.
CREATE OR REPLACE FUNCTION public.work_schedule_can_manage(p_hotel_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.work_schedule_pilot_grants grant_row
    JOIN public.profiles actor ON actor.id = grant_row.profile_id
    JOIN public.hotel_configurations hotel ON hotel.hotel_id = grant_row.hotel_id
    JOIN public.organizations org ON org.id = hotel.organization_id
    WHERE grant_row.hotel_id = p_hotel_id
      AND grant_row.organization_slug = 'rdhotels'
      AND org.slug = 'rdhotels'
      AND actor.id = auth.uid()
      AND actor.organization_slug = org.slug
      AND actor.role::text IN ('top_management_manager', 'admin', 'hr')
  );
$$;
REVOKE ALL ON FUNCTION public.work_schedule_can_manage(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_schedule_can_manage(text) TO authenticated;

-- The earlier pilot allowed every RD employee to see their own published shifts.
-- The user now requests RD access ONLY for anu_000, including direct REST reads.
DROP POLICY IF EXISTS "Employee published own schedule or venue manager schedule"
  ON public.work_schedule_entries;
CREATE POLICY "RD pilot schedule visible only to explicitly granted Anu account"
  ON public.work_schedule_entries FOR SELECT TO authenticated
  USING (organization_slug = 'rdhotels' AND public.work_schedule_can_manage(hotel_id));

-- Menu/route UX can check this RPC; database grants and RLS remain authoritative.
CREATE FUNCTION public.work_schedule_pilot_has_access(p_organization_slug text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
    AND p_organization_slug = 'rdhotels'
    AND EXISTS (
      SELECT 1 FROM public.work_schedule_pilot_grants grant_row
      JOIN public.profiles actor ON actor.id = grant_row.profile_id
      JOIN public.hotel_configurations hotel ON hotel.hotel_id = grant_row.hotel_id
      JOIN public.organizations org ON org.id = hotel.organization_id
      WHERE actor.id = auth.uid()
        AND actor.organization_slug = 'rdhotels'
        AND actor.role::text IN ('top_management_manager','admin','hr')
        AND grant_row.organization_slug = org.slug
        AND org.slug = p_organization_slug
    );
$$;
REVOKE ALL ON FUNCTION public.work_schedule_pilot_has_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_schedule_pilot_has_access(text) TO authenticated;

COMMENT ON TABLE public.work_schedule_pilot_grants IS
  'Fail-closed RD work schedule pilot. SLNT is not enabled by this gate; never reuse RD employee mappings in another organization.';
