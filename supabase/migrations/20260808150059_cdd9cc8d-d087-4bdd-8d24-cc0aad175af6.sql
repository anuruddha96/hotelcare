
-- CHANNELS
DROP POLICY IF EXISTS "PMS users can view channels" ON public.channels;
DROP POLICY IF EXISTS "Managers can manage channels" ON public.channels;

CREATE POLICY "PMS users can view channels in their org"
ON public.channels FOR SELECT TO authenticated
USING (
  has_pms_access(auth.uid())
  AND (organization_slug IS NULL OR organization_slug = get_user_organization_slug(auth.uid()))
);

CREATE POLICY "Managers can manage channels in their org"
ON public.channels FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['admin'::user_role,'manager'::user_role,'top_management'::user_role]))
  AND (organization_slug IS NULL OR organization_slug = get_user_organization_slug(auth.uid()))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['admin'::user_role,'manager'::user_role,'top_management'::user_role]))
  AND COALESCE(organization_slug, get_user_organization_slug(auth.uid())) = get_user_organization_slug(auth.uid())
);

-- CHANNEL RATE MAPPINGS (scoped through parent channel)
DROP POLICY IF EXISTS "PMS users can view channel mappings" ON public.channel_rate_mappings;
DROP POLICY IF EXISTS "Managers can manage channel mappings" ON public.channel_rate_mappings;

CREATE POLICY "PMS users can view channel mappings in their org"
ON public.channel_rate_mappings FOR SELECT TO authenticated
USING (
  has_pms_access(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.channels c
    WHERE c.id = channel_rate_mappings.channel_id
      AND (c.organization_slug IS NULL OR c.organization_slug = get_user_organization_slug(auth.uid()))
  )
);

CREATE POLICY "Managers can manage channel mappings in their org"
ON public.channel_rate_mappings FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['admin'::user_role,'manager'::user_role,'top_management'::user_role]))
  AND EXISTS (
    SELECT 1 FROM public.channels c
    WHERE c.id = channel_rate_mappings.channel_id
      AND (c.organization_slug IS NULL OR c.organization_slug = get_user_organization_slug(auth.uid()))
  )
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['admin'::user_role,'manager'::user_role,'top_management'::user_role]))
  AND EXISTS (
    SELECT 1 FROM public.channels c
    WHERE c.id = channel_rate_mappings.channel_id
      AND (c.organization_slug IS NULL OR c.organization_slug = get_user_organization_slug(auth.uid()))
  )
);

-- RATE PLANS
DROP POLICY IF EXISTS "PMS users can view rate plans" ON public.rate_plans;
DROP POLICY IF EXISTS "Managers can manage rate plans" ON public.rate_plans;

CREATE POLICY "PMS users can view rate plans in their org"
ON public.rate_plans FOR SELECT TO authenticated
USING (
  has_pms_access(auth.uid())
  AND (organization_slug IS NULL OR organization_slug = get_user_organization_slug(auth.uid()))
);

CREATE POLICY "Managers can manage rate plans in their org"
ON public.rate_plans FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['admin'::user_role,'manager'::user_role,'top_management'::user_role]))
  AND (organization_slug IS NULL OR organization_slug = get_user_organization_slug(auth.uid()))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['admin'::user_role,'manager'::user_role,'top_management'::user_role]))
  AND COALESCE(organization_slug, get_user_organization_slug(auth.uid())) = get_user_organization_slug(auth.uid())
);

-- RATE CALENDAR (scoped through parent rate plan)
DROP POLICY IF EXISTS "PMS users can view rate calendar" ON public.rate_calendar;
DROP POLICY IF EXISTS "Managers can manage rate calendar" ON public.rate_calendar;

CREATE POLICY "PMS users can view rate calendar in their org"
ON public.rate_calendar FOR SELECT TO authenticated
USING (
  has_pms_access(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.rate_plans rp
    WHERE rp.id = rate_calendar.rate_plan_id
      AND (rp.organization_slug IS NULL OR rp.organization_slug = get_user_organization_slug(auth.uid()))
  )
);

CREATE POLICY "Managers can manage rate calendar in their org"
ON public.rate_calendar FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['admin'::user_role,'manager'::user_role,'top_management'::user_role]))
  AND EXISTS (
    SELECT 1 FROM public.rate_plans rp
    WHERE rp.id = rate_calendar.rate_plan_id
      AND (rp.organization_slug IS NULL OR rp.organization_slug = get_user_organization_slug(auth.uid()))
  )
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
          AND p.role = ANY (ARRAY['admin'::user_role,'manager'::user_role,'top_management'::user_role]))
  AND EXISTS (
    SELECT 1 FROM public.rate_plans rp
    WHERE rp.id = rate_calendar.rate_plan_id
      AND (rp.organization_slug IS NULL OR rp.organization_slug = get_user_organization_slug(auth.uid()))
  )
);

-- GUEST FOLIOS (scoped through reservation)
DROP POLICY IF EXISTS "PMS users can view folios" ON public.guest_folios;
DROP POLICY IF EXISTS "PMS users can insert folios" ON public.guest_folios;

CREATE POLICY "PMS users can view folios in their org"
ON public.guest_folios FOR SELECT TO authenticated
USING (
  has_pms_access(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.id = guest_folios.reservation_id
      AND (r.organization_slug IS NULL OR r.organization_slug = get_user_organization_slug(auth.uid()))
  )
);

CREATE POLICY "PMS users can insert folios in their org"
ON public.guest_folios FOR INSERT TO authenticated
WITH CHECK (
  has_pms_access(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.id = guest_folios.reservation_id
      AND (r.organization_slug IS NULL OR r.organization_slug = get_user_organization_slug(auth.uid()))
  )
);

-- GUESTS / RESERVATIONS INSERT + UPDATE ORG SCOPING
DROP POLICY IF EXISTS "PMS users can insert guests" ON public.guests;
CREATE POLICY "PMS users can insert guests in their org"
ON public.guests FOR INSERT TO authenticated
WITH CHECK (
  has_pms_access(auth.uid())
  AND COALESCE(organization_slug, get_user_organization_slug(auth.uid())) = get_user_organization_slug(auth.uid())
);

DROP POLICY IF EXISTS "PMS users can update guests" ON public.guests;
CREATE POLICY "PMS users can update guests in their org"
ON public.guests FOR UPDATE TO authenticated
USING (
  has_pms_access(auth.uid())
  AND (organization_slug IS NULL OR organization_slug = get_user_organization_slug(auth.uid()))
)
WITH CHECK (
  has_pms_access(auth.uid())
  AND COALESCE(organization_slug, get_user_organization_slug(auth.uid())) = get_user_organization_slug(auth.uid())
);

DROP POLICY IF EXISTS "PMS users can insert reservations" ON public.reservations;
CREATE POLICY "PMS users can insert reservations in their org"
ON public.reservations FOR INSERT TO authenticated
WITH CHECK (
  has_pms_access(auth.uid())
  AND COALESCE(organization_slug, get_user_organization_slug(auth.uid())) = get_user_organization_slug(auth.uid())
);

DROP POLICY IF EXISTS "PMS users can update reservations" ON public.reservations;
CREATE POLICY "PMS users can update reservations in their org"
ON public.reservations FOR UPDATE TO authenticated
USING (
  has_pms_access(auth.uid())
  AND (organization_slug IS NULL OR organization_slug = get_user_organization_slug(auth.uid()))
)
WITH CHECK (
  has_pms_access(auth.uid())
  AND COALESCE(organization_slug, get_user_organization_slug(auth.uid())) = get_user_organization_slug(auth.uid())
);
