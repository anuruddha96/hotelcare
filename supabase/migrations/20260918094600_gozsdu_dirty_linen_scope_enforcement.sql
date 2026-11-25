-- A SECURITY DEFINER check must see the actual item scope even if the
-- requesting user's RLS hides another property's catalogue row.
-- Legacy Gozsdu records may still be corrected by updating their count, but
-- newly inserted Gozsdu records must always use the new paper-sheet IDs.
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
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.check_dirty_linen_item_hotel_scope() FROM PUBLIC;
