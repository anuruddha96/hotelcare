-- 1. Role helpers include top_management_manager
CREATE OR REPLACE FUNCTION public.is_revenue_user(_uid uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _uid AND role IN ('admin','top_management','top_management_manager')
  );
$function$;

CREATE OR REPLACE FUNCTION public.user_can_access_hotel(_uid uuid, _hotel_id text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _uid
      AND (
        p.role IN ('admin','top_management','top_management_manager')
        OR p.assigned_hotel = _hotel_id
        OR p.assigned_hotel = public.get_hotel_name_from_id(_hotel_id)
      )
  );
$function$;

-- 2. room_types policies
DROP POLICY IF EXISTS rev_read_room_types ON public.room_types;
CREATE POLICY rev_read_room_types ON public.room_types
FOR SELECT USING (
  organization_slug = get_user_organization_slug(auth.uid())
  AND get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role,'top_management'::user_role,'top_management_manager'::user_role,'manager'::user_role,'housekeeping_manager'::user_role])
  AND user_can_access_hotel(auth.uid(), hotel_id)
);

DROP POLICY IF EXISTS rev_write_room_types ON public.room_types;
CREATE POLICY rev_write_room_types ON public.room_types
FOR ALL USING (
  organization_slug = get_user_organization_slug(auth.uid())
  AND get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role,'top_management'::user_role,'top_management_manager'::user_role])
  AND user_can_access_hotel(auth.uid(), hotel_id)
) WITH CHECK (
  organization_slug = get_user_organization_slug(auth.uid())
  AND get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role,'top_management'::user_role,'top_management_manager'::user_role])
  AND user_can_access_hotel(auth.uid(), hotel_id)
);

-- 3. sync history readable by top management too
DROP POLICY IF EXISTS "Admins and managers can view sync history" ON public.pms_sync_history;
CREATE POLICY "Admins and managers can view sync history" ON public.pms_sync_history
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = ANY (ARRAY['admin'::user_role,'manager'::user_role,'housekeeping_manager'::user_role,'top_management'::user_role,'top_management_manager'::user_role])
  )
);

-- 4. Inventory flags
ALTER TABLE public.room_types
  ADD COLUMN IF NOT EXISTS is_sellable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS counts_toward_inventory boolean NOT NULL DEFAULT true;

ALTER TABLE public.hotel_revenue_settings
  ADD COLUMN IF NOT EXISTS sellable_rooms integer;

-- 5. Cancelled nights
CREATE TABLE IF NOT EXISTS public.revenue_cancelled_nights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text,
  stay_date date NOT NULL,
  res_id text NOT NULL,
  obk_id text,
  room_type_name text,
  nightly_price_eur numeric,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, res_id, obk_id, stay_date)
);

GRANT SELECT ON public.revenue_cancelled_nights TO authenticated;
GRANT ALL ON public.revenue_cancelled_nights TO service_role;

ALTER TABLE public.revenue_cancelled_nights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org staff can read cancelled nights" ON public.revenue_cancelled_nights
FOR SELECT USING (user_can_access_hotel(auth.uid(), hotel_id) OR is_revenue_user(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_rev_cancelled_hotel_stay ON public.revenue_cancelled_nights (hotel_id, stay_date);
CREATE INDEX IF NOT EXISTS idx_rev_cancelled_cancelled_at ON public.revenue_cancelled_nights (hotel_id, cancelled_at);

CREATE TRIGGER trg_rev_cancelled_updated_at
BEFORE UPDATE ON public.revenue_cancelled_nights
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();