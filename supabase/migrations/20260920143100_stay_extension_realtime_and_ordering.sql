-- Publish property-scoped supervisor queue changes immediately to subscribed
-- dashboards. RLS on housekeeping_stay_extension_reviews still applies.
ALTER PUBLICATION supabase_realtime ADD TABLE public.housekeeping_stay_extension_reviews;

-- Parallel cron/manual syncs may write two different snapshots in the wrong
-- order. Never roll an existing extension review backwards or reopen it on an
-- exact duplicate. A real further extension still refreshes it normally.
CREATE OR REPLACE FUNCTION public.hc_skip_stale_extension_review()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF NEW.revised_checkout_date <= OLD.revised_checkout_date THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER hc_skip_stale_extension_review
BEFORE UPDATE OF revised_checkout_date ON public.housekeeping_stay_extension_reviews
FOR EACH ROW
EXECUTE FUNCTION public.hc_skip_stale_extension_review();

-- An unresolved rule configuration is an explicit exception: a supervisor
-- must write what was done instead of silently clearing the only alert.
CREATE OR REPLACE FUNCTION public.hc_acknowledge_stay_extension(
  _review_id uuid, _identity_verified boolean, _resolution_note text DEFAULT NULL,
  _resolved boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  review_record public.housekeeping_stay_extension_reviews%ROWTYPE;
BEGIN
  SELECT * INTO review_record
  FROM public.housekeeping_stay_extension_reviews WHERE id = _review_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_next_day_housekeeping_plan(review_record.organization_slug, review_record.hotel_id) THEN
    RAISE EXCEPTION 'Not authorized for this property extension review';
  END IF;
  IF _resolved AND (NOT _identity_verified OR NOT review_record.policy_configured)
     AND nullif(btrim(coalesce(_resolution_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to dismiss a candidate or resolve a stay with unconfigured service rules';
  END IF;
  UPDATE public.housekeeping_stay_extension_reviews
  SET status = CASE WHEN _resolved THEN 'resolved' ELSE 'acknowledged' END,
      identity_status = CASE WHEN _identity_verified THEN 'verified' ELSE 'needs_verification' END,
      acknowledged_at = now(), acknowledged_by = auth.uid(),
      resolution_note = nullif(btrim(_resolution_note), ''), updated_at = now()
  WHERE id = _review_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.hc_acknowledge_stay_extension(uuid, boolean, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hc_acknowledge_stay_extension(uuid, boolean, text, boolean) TO authenticated;
