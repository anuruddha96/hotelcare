CREATE OR REPLACE FUNCTION public.audit_confirmed_rate_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  run_source text;
  is_auto boolean;
BEGIN
  IF NEW.status = 'pushed' AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT r.source INTO run_source
    FROM public.revenue_rate_push_runs r
    WHERE r.id = NEW.push_run_id;

    is_auto := (run_source IN ('automation', 'pickup_automation'))
      OR (NEW.created_by IS NULL AND EXISTS (
        SELECT 1 FROM public.revenue_pickup_automation_actions a
        WHERE a.hotel_id = NEW.hotel_id
          AND a.stay_date = NEW.stay_date
          AND a.room_type_name = NEW.room_type_name
          AND a.occupancy = NEW.occupancy
          AND a.new_price = NEW.new_price
          AND a.created_at > now() - interval '2 hours'
      ));

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
      CASE WHEN is_auto THEN 'push_automation' ELSE 'push' END,
      NEW.created_by,
      CASE WHEN is_auto THEN 'Automated Previo price update' ELSE 'Confirmed Previo price update' END,
      jsonb_build_object(
        'room_type_name', NEW.room_type_name,
        'occupancy', NEW.occupancy,
        'draft_id', NEW.id,
        'origin', CASE WHEN is_auto THEN 'pickup-automation' ELSE 'hotelcare-push' END,
        'percent', CASE
          WHEN NEW.old_price IS NULL OR NEW.old_price = 0 THEN NULL
          ELSE round(((NEW.new_price - NEW.old_price) / NEW.old_price) * 100, 1)
        END
      )
    );
  END IF;
  RETURN NEW;
END;
$function$;

UPDATE public.rate_change_audit ca
SET source = CASE WHEN ca.source = 'push' THEN 'push_automation' ELSE 'previo_automation_confirmed' END,
    payload = COALESCE(ca.payload, '{}'::jsonb) || jsonb_build_object('origin', 'pickup-automation')
WHERE ca.performed_at > now() - interval '4 days'
  AND ca.performed_by IS NULL
  AND ca.source IN ('push', 'previo_bulk_confirmed', 'previo_confirmed')
  AND EXISTS (
    SELECT 1 FROM public.revenue_pickup_automation_actions a
    WHERE a.hotel_id = ca.hotel_id
      AND a.stay_date = ca.stay_date
      AND a.room_type_name = ca.payload->>'room_type_name'
      AND a.occupancy = (ca.payload->>'occupancy')::int
      AND a.new_price = ca.new_rate_eur
      AND a.created_at BETWEEN ca.performed_at - interval '3 hours' AND ca.performed_at + interval '1 hour'
  );