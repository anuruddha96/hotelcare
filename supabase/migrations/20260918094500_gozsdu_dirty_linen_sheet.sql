-- Gozsdu Court Budapest's paper collection sheet is deliberately distinct from
-- the existing shared catalogue. Never change the labels/order used by RD's
-- other properties or by SLNT.
ALTER TABLE public.dirty_linen_items
  ADD COLUMN IF NOT EXISTS hotel_scope text;

CREATE UNIQUE INDEX IF NOT EXISTS dirty_linen_items_scoped_name_unique
  ON public.dirty_linen_items (hotel_scope, name)
  WHERE hotel_scope IS NOT NULL;

INSERT INTO public.dirty_linen_items (name, display_name, is_active, sort_order, hotel_scope)
SELECT v.name, v.display_name, true, v.sort_order, 'gozsdu-court'
FROM (VALUES
  (1, 'gozsdu_new_big_towel', 'NEW BIG Towel'),
  (2, 'gozsdu_new_small_towel', 'NEW Small Towel'),
  (3, 'gozsdu_big_towel', 'Big towel'),
  (4, 'gozsdu_small_towel', 'Small towel'),
  (5, 'gozsdu_pillow_cover', 'pillow cover'),
  (6, 'gozsdu_blanket_cover', 'blanket cover'),
  (7, 'gozsdu_bedsheet', 'bedsheet'),
  (8, 'gozsdu_foot_towels', 'foot towels'),
  (9, 'gozsdu_pillow_filling', 'Pillow filling'),
  (10, 'gozsdu_blanket_filling', 'blanket filling'),
  (11, 'gozsdu_big_matra_cover', 'Big matra cover'),
  (12, 'gozsdu_small_matra_cover', 'small matra cover'),
  (13, 'gozsdu_dekor_pillow_cover', 'Dekor pillow cover'),
  (14, 'gozsdu_dekor_pillow_fill', 'Dekor pillow fill'),
  (15, 'gozsdu_dark_curtain', 'Dark curtain')
) AS v(sort_order, name, display_name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.dirty_linen_items existing
  WHERE existing.hotel_scope = 'gozsdu-court' AND existing.name = v.name
);

-- The former ALL admin policy also granted SELECT, bypassing a venue-specific
-- SELECT rule. Split it so the venue guard applies to ALL roles, including admins.
DROP POLICY IF EXISTS "All authenticated users can view linen items" ON public.dirty_linen_items;
DROP POLICY IF EXISTS "Only admins can manage linen items" ON public.dirty_linen_items;
CREATE POLICY "Read own venue linen catalogue" ON public.dirty_linen_items
  FOR SELECT TO authenticated
  USING (hotel_scope IS NULL OR (
    hotel_scope = 'gozsdu-court'
    AND public.get_user_assigned_hotel(auth.uid()) IN ('gozsdu-court', 'Gozsdu Court Budapest')
  ));
CREATE POLICY "Admins insert own venue linen items" ON public.dirty_linen_items
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role(auth.uid()) = 'admin'::public.user_role
    AND (hotel_scope IS NULL OR (hotel_scope = 'gozsdu-court'
      AND public.get_user_assigned_hotel(auth.uid()) IN ('gozsdu-court', 'Gozsdu Court Budapest'))));
CREATE POLICY "Admins update own venue linen items" ON public.dirty_linen_items
  FOR UPDATE TO authenticated
  USING (public.get_user_role(auth.uid()) = 'admin'::public.user_role
    AND (hotel_scope IS NULL OR (hotel_scope = 'gozsdu-court'
      AND public.get_user_assigned_hotel(auth.uid()) IN ('gozsdu-court', 'Gozsdu Court Budapest'))))
  WITH CHECK (public.get_user_role(auth.uid()) = 'admin'::public.user_role
    AND (hotel_scope IS NULL OR (hotel_scope = 'gozsdu-court'
      AND public.get_user_assigned_hotel(auth.uid()) IN ('gozsdu-court', 'Gozsdu Court Budapest'))));
CREATE POLICY "Admins delete own venue linen items" ON public.dirty_linen_items
  FOR DELETE TO authenticated
  USING (public.get_user_role(auth.uid()) = 'admin'::public.user_role
    AND (hotel_scope IS NULL OR (hotel_scope = 'gozsdu-court'
      AND public.get_user_assigned_hotel(auth.uid()) IN ('gozsdu-court', 'Gozsdu Court Budapest'))));

-- A crafted client request cannot attach a Gozsdu-only item to a different
-- hotel even if it knows the UUID. Existing unscoped counts are unchanged.
CREATE OR REPLACE FUNCTION public.check_dirty_linen_item_hotel_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_scope text; v_hotel text;
BEGIN
  SELECT hotel_scope INTO v_scope FROM public.dirty_linen_items WHERE id = NEW.linen_item_id;
  IF v_scope IS NOT NULL THEN
    SELECT hotel INTO v_hotel FROM public.rooms WHERE id = NEW.room_id;
    IF v_scope <> 'gozsdu-court' OR v_hotel NOT IN ('gozsdu-court', 'Gozsdu Court Budapest') THEN
      RAISE EXCEPTION 'This linen item belongs to another hotel' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS enforce_dirty_linen_item_hotel_scope ON public.dirty_linen_counts;
CREATE TRIGGER enforce_dirty_linen_item_hotel_scope
  BEFORE INSERT OR UPDATE OF linen_item_id, room_id ON public.dirty_linen_counts
  FOR EACH ROW EXECUTE FUNCTION public.check_dirty_linen_item_hotel_scope();
