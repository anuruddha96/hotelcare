-- Multi-OTA layer for the Rate & Pickup calendar: one row per hotel per
-- channel with a markup/discount rule. The calendar shows each channel's
-- effective price next to the base rate; the channel manager still receives
-- the base rate per rate plan.

CREATE TABLE IF NOT EXISTS public.pms_channel_rate_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  channel_key text NOT NULL,
  channel_title text NOT NULL,
  adjustment_kind text NOT NULL DEFAULT 'percent' CHECK (adjustment_kind IN ('percent','fixed')),
  adjustment_value numeric NOT NULL DEFAULT 0 CHECK (adjustment_value > -100 AND adjustment_value < 1000),
  rounding text NOT NULL DEFAULT 'none' CHECK (rounding IN ('none','whole','ninety_nine')),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, channel_key)
);

ALTER TABLE public.pms_channel_rate_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "PMS staff view channel rate rules"
ON public.pms_channel_rate_rules FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id) AND public.has_pms_access(auth.uid()));

CREATE POLICY "Managers create channel rate rules"
ON public.pms_channel_rate_rules FOR INSERT TO authenticated
WITH CHECK (
  (public.is_super_admin(auth.uid()) OR (public.get_user_role(auth.uid()))::text = ANY (ARRAY['admin','top_management','top_management_manager','manager','reception_manager']))
  AND public.user_can_access_hotel(auth.uid(), hotel_id)
);

CREATE POLICY "Managers update channel rate rules"
ON public.pms_channel_rate_rules FOR UPDATE TO authenticated
USING (
  (public.is_super_admin(auth.uid()) OR (public.get_user_role(auth.uid()))::text = ANY (ARRAY['admin','top_management','top_management_manager','manager','reception_manager']))
  AND public.user_can_access_hotel(auth.uid(), hotel_id)
)
WITH CHECK (
  (public.is_super_admin(auth.uid()) OR (public.get_user_role(auth.uid()))::text = ANY (ARRAY['admin','top_management','top_management_manager','manager','reception_manager']))
  AND public.user_can_access_hotel(auth.uid(), hotel_id)
);

CREATE POLICY "Managers delete channel rate rules"
ON public.pms_channel_rate_rules FOR DELETE TO authenticated
USING (
  (public.is_super_admin(auth.uid()) OR (public.get_user_role(auth.uid()))::text = ANY (ARRAY['admin','top_management','top_management_manager','manager','reception_manager']))
  AND public.user_can_access_hotel(auth.uid(), hotel_id)
);
