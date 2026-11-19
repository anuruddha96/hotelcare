-- Add Bathrobe / Köntös exclusively to Hotel Memories Budapest.
-- The existing seven shared types, their IDs, and all historical counts remain intact.
BEGIN;

INSERT INTO public.dirty_linen_items (name, display_name, is_active, sort_order, hotel_scope)
SELECT 'memories_bathrobe', 'Bathrobe / Köntös', true, 8, 'memories-budapest'
WHERE NOT EXISTS (
  SELECT 1 FROM public.dirty_linen_items
  WHERE name = 'memories_bathrobe' AND hotel_scope = 'memories-budapest'
);

-- Leave the shared, Gozsdu, and SLNT SELECT policies untouched.
-- This additional permissive SELECT rule grants visibility only to Memories staff.
DROP POLICY IF EXISTS "Hotel Memories staff read bathrobe linen item" ON public.dirty_linen_items;
CREATE POLICY "Hotel Memories staff read bathrobe linen item"
ON public.dirty_linen_items FOR SELECT TO authenticated
USING (
  hotel_scope = 'memories-budapest'
  AND public.get_user_assigned_hotel((SELECT auth.uid()))
    IN ('memories-budapest', 'Hotel Memories Budapest')
  AND public.get_user_organization_slug((SELECT auth.uid())) = 'rdhotels'
);

-- Preserve the existing Gozsdu isolation rules and extend the room/item
-- write guard so a Memories-only bathrobe cannot be logged for another hotel.
CREATE OR REPLACE FUNCTION public.check_dirty_linen_item_hotel_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_scope text; v_hotel text;
BEGIN
  SELECT hotel_scope INTO v_scope FROM public.dirty_linen_items WHERE id = NEW.linen_item_id;
  SELECT hotel INTO v_hotel FROM public.rooms WHERE id = NEW.room_id;

  IF v_scope = 'gozsdu-court' AND v_hotel NOT IN ('gozsdu-court', 'Gozsdu Court Budapest') THEN
    RAISE EXCEPTION 'This linen item belongs to Gozsdu Court Budapest only' USING ERRCODE = '42501';
  END IF;
  IF (v_scope IS NULL OR v_scope <> 'gozsdu-court')
    AND v_hotel IN ('gozsdu-court', 'Gozsdu Court Budapest') THEN
    RAISE EXCEPTION 'New Gozsdu linen records must use the dedicated catalogue' USING ERRCODE = '42501';
  END IF;
  IF v_scope = 'memories-budapest' AND
    (v_hotel IS NULL OR v_hotel NOT IN ('memories-budapest', 'Hotel Memories Budapest')) THEN
    RAISE EXCEPTION 'This linen item belongs to Hotel Memories Budapest only' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.check_dirty_linen_item_hotel_scope() FROM PUBLIC;

COMMIT;
