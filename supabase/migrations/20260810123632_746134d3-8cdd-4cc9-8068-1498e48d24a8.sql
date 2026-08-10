WITH ranked_active AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY hotel_id, stay_date, room_type_name, occupancy
           ORDER BY updated_at DESC, created_at DESC, id DESC
         ) AS rn
  FROM public.revenue_rate_drafts
  WHERE status IN ('draft', 'failed')
)
DELETE FROM public.revenue_rate_drafts d
USING ranked_active r
WHERE d.id = r.id AND r.rn > 1;

ALTER TABLE public.revenue_rate_drafts
  DROP CONSTRAINT IF EXISTS revenue_rate_drafts_hotel_id_stay_date_room_type_name_occupa_key;

CREATE UNIQUE INDEX IF NOT EXISTS revenue_rate_drafts_one_active_cell_idx
  ON public.revenue_rate_drafts (hotel_id, stay_date, room_type_name, occupancy)
  WHERE status IN ('draft', 'failed');

CREATE OR REPLACE FUNCTION public.audit_confirmed_rate_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pushed' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.rate_change_audit (
      hotel_id, organization_slug, stay_date, action,
      old_rate_eur, new_rate_eur, delta_eur, source,
      performed_by, notes, payload
    ) VALUES (
      NEW.hotel_id,
      COALESCE(NEW.organization_slug, ''),
      NEW.stay_date,
      'pushed_to_previo',
      NEW.old_price,
      NEW.new_price,
      CASE WHEN NEW.old_price IS NULL THEN NULL ELSE NEW.new_price - NEW.old_price END,
      'push',
      NEW.created_by,
      'Confirmed Previo price update',
      jsonb_build_object(
        'room_type_name', NEW.room_type_name,
        'occupancy', NEW.occupancy,
        'draft_id', NEW.id,
        'percent', CASE
          WHEN NEW.old_price IS NULL OR NEW.old_price = 0 THEN NULL
          ELSE round(((NEW.new_price - NEW.old_price) / NEW.old_price) * 100, 1)
        END
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_confirmed_rate_push() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_confirmed_rate_push() TO service_role;

DROP TRIGGER IF EXISTS trg_audit_confirmed_rate_push ON public.revenue_rate_drafts;
CREATE TRIGGER trg_audit_confirmed_rate_push
AFTER UPDATE OF status ON public.revenue_rate_drafts
FOR EACH ROW
EXECUTE FUNCTION public.audit_confirmed_rate_push();

DROP POLICY IF EXISTS audit_select_admin_topmgmt ON public.rate_change_audit;
CREATE POLICY audit_select_revenue_hotel_access
ON public.rate_change_audit
FOR SELECT
TO authenticated
USING (
  public.is_revenue_user(auth.uid())
  AND public.user_can_access_hotel(auth.uid(), hotel_id)
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.organization_slug = rate_change_audit.organization_slug
  )
);