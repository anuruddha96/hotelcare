-- ============================================================================
-- Channex certification sandbox: organization "channex" + one test property.
--
-- Purpose: an isolated HotelCare tenant used ONLY for the Channex PMS
-- certification and for reception/channel-manager development. It never
-- touches RD Hotels, SLNT, the Previo test hotel or any live hotel.
--
--   organization  : channex  ("Channex Sandbox")
--   hotel_id      : channex-test-property
--   hotel_name    : Test Property - HotelCare
--   currency      : USD (Channex certification fixture)
--   room types    : Twin Room (10 rooms, 2 pax), Double Room (5 rooms, 2 pax)
--   rate plans    : Best Available Rate 100 / Bed & Breakfast Rate 120 per room type
--
-- Module settings are cloned from Hotel Memories Budapest, with contact,
-- e-mail, Previo/PMS and billing keys removed so the sandbox can never send
-- mail to real staff or call Previo.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- 1. Organization ------------------------------------------------------------
INSERT INTO public.organizations (name, slug, is_active, subscription_tier, settings)
SELECT 'Channex Sandbox', 'channex', true,
       COALESCE((SELECT o.subscription_tier
                   FROM public.hotel_configurations hc
                   JOIN public.organizations o ON o.id = hc.organization_id
                  WHERE hc.hotel_id = 'memories-budapest'), 'basic'),
       jsonb_build_object('sandbox', true, 'purpose', 'channex_certification')
WHERE NOT EXISTS (SELECT 1 FROM public.organizations WHERE slug = 'channex');

-- 2. Hotel configuration (settings cloned from Memories, sanitised) ----------
INSERT INTO public.hotel_configurations (hotel_id, hotel_name, organization_id, is_active, settings, market_city, market_country)
SELECT 'channex-test-property',
       'Test Property - HotelCare',
       (SELECT id FROM public.organizations WHERE slug = 'channex'),
       true,
       COALESCE((
         SELECT jsonb_object_agg(k, v)
           FROM public.hotel_configurations src, jsonb_each(COALESCE(src.settings, '{}'::jsonb)) AS e(k, v)
          WHERE src.hotel_id = 'memories-budapest'
            AND k !~* '(mail|recipient|phone|contact|webhook|previo|pms_|billing|stripe|invoice|slack|whatsapp|sms)'
       ), '{}'::jsonb)
       || jsonb_build_object('sandbox', true, 'native_ari', true, 'channel_manager', 'channex', 'currency', 'USD'),
       'Budapest', 'HU'
WHERE NOT EXISTS (SELECT 1 FROM public.hotel_configurations WHERE hotel_id = 'channex-test-property');

-- Organization-level settings cloned from the organization that owns Memories.
INSERT INTO public.organization_settings (organization_slug, setting_key, setting_value)
SELECT 'channex', s.setting_key, s.setting_value
  FROM public.organization_settings s
  JOIN public.organizations o ON o.slug = s.organization_slug
  JOIN public.hotel_configurations hc ON hc.organization_id = o.id AND hc.hotel_id = 'memories-budapest'
 WHERE s.setting_key !~* '(mail|recipient|phone|contact|webhook|previo|pms|billing|stripe|invoice|slack|whatsapp|sms|secret|token|key)'
   AND NOT EXISTS (SELECT 1 FROM public.organization_settings x
                    WHERE x.organization_slug = 'channex' AND x.setting_key = s.setting_key);

-- Hotel id -> display name helper used by older RLS paths.
CREATE OR REPLACE FUNCTION public.get_hotel_name_from_id(hotel_id text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN hotel_id = 'memories-budapest' THEN 'Hotel Memories Budapest'
    WHEN hotel_id = 'mika-downtown' THEN 'Hotel Mika Downtown'
    WHEN hotel_id = 'ottofiori' THEN 'Hotel Ottofiori'
    WHEN hotel_id = 'gozsdu-court' THEN 'Gozsdu Court Budapest'
    WHEN hotel_id = 'channex-test-property' THEN 'Test Property - HotelCare'
    ELSE hotel_id
  END;
$$;

-- 3. Native rate plan columns (provider-neutral) -----------------------------
ALTER TABLE public.rate_plans
  ADD COLUMN IF NOT EXISTS room_type_id uuid REFERENCES public.room_types(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_plans_hotel_code
  ON public.rate_plans(hotel_id, code) WHERE code IS NOT NULL;

-- 4. Room types -------------------------------------------------------------
INSERT INTO public.room_types (hotel_id, organization_slug, name, num_rooms, is_sellable, counts_toward_inventory,
                               base_price_eur, min_price_eur, max_price_eur, sort_order)
SELECT 'channex-test-property', 'channex', v.name, v.num_rooms, true, true, v.base, 50, 2000, v.sort_order
  FROM (VALUES ('Twin Room', 10, 100, 1), ('Double Room', 5, 100, 2)) AS v(name, num_rooms, base, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM public.room_types rt
                    WHERE rt.hotel_id = 'channex-test-property' AND rt.name = v.name);

-- 5. Rate plans (BAR + B&B per room type) ------------------------------------
INSERT INTO public.rate_plans (hotel_id, organization_slug, name, room_type, room_type_id, code, base_rate,
                               currency, meal_plan, min_stay, is_active, sort_order)
SELECT 'channex-test-property', 'channex', v.plan_name, rt.name, rt.id, v.code, v.base_rate,
       'USD', v.meal_plan, 1, true, v.sort_order
  FROM (VALUES
          ('Twin Room',   'Best Available Rate',    'TWIN-BAR', 100, 'room_only', 1),
          ('Twin Room',   'Bed & Breakfast Rate',   'TWIN-BB',  120, 'breakfast', 2),
          ('Double Room', 'Best Available Rate',    'DBL-BAR',  100, 'room_only', 3),
          ('Double Room', 'Bed & Breakfast Rate',   'DBL-BB',   120, 'breakfast', 4)
       ) AS v(room_name, plan_name, code, base_rate, meal_plan, sort_order)
  JOIN public.room_types rt ON rt.hotel_id = 'channex-test-property' AND rt.name = v.room_name
ON CONFLICT (hotel_id, code) WHERE code IS NOT NULL DO NOTHING;

-- 6. Physical rooms (reception planner + housekeeping) -----------------------
INSERT INTO public.rooms (hotel, organization_slug, room_number, room_name, room_type, room_category,
                          room_capacity, floor_number, status)
SELECT 'Test Property - HotelCare', 'channex', v.num, v.type || ' ' || v.num, v.type, v.type, 2, v.floor, 'clean'
  FROM (
    SELECT 'T' || n::text AS num, 'Twin Room' AS type, 1 AS floor FROM generate_series(101, 110) n
    UNION ALL
    SELECT 'D' || n::text, 'Double Room', 2 FROM generate_series(201, 205) n
  ) v
 WHERE NOT EXISTS (SELECT 1 FROM public.rooms r
                    WHERE r.hotel = 'Test Property - HotelCare' AND r.room_number = v.num);
