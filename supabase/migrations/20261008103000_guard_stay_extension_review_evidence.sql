-- Keep stay-extension reviews evidence-based.
--
-- A simple change in one reservation's checkout date is not enough to call it
-- an extension. Show the review queue only when HotelCare has an explicit
-- manager Checkout -> Daily decision, or Previo has produced a contiguous
-- multi-reservation same-guest chain.
--
-- Also make the free-text review note optional when dismissing a candidate as
-- a different guest. A note remains required only when a manager resolves a
-- verified stay while the property's stayover service policy is unconfigured.

DROP TRIGGER IF EXISTS zzz_hc_detect_stay_extension ON public.rooms;
CREATE TRIGGER zzz_hc_detect_stay_extension
AFTER UPDATE OF pms_metadata, guest_nights_stayed, is_checkout_room ON public.rooms
FOR EACH ROW WHEN (
  OLD.pms_metadata IS DISTINCT FROM NEW.pms_metadata
  AND public.hc_hotel_uses_previo(NEW.hotel, coalesce(NEW.pms_metadata, '{}'::jsonb))
  AND (
    (
      coalesce(NEW.pms_metadata ->> 'manual_daily', 'false') = 'true'
      AND public.hc_manager_confirmation_day(coalesce(NEW.pms_metadata, '{}'::jsonb))
          = (now() AT TIME ZONE 'Europe/Budapest')::date
    )
    OR (
      coalesce(NEW.pms_metadata #>> '{continuousStay,linkedBy}', '') = 'previo_chain'
      AND coalesce(NEW.pms_metadata #>> '{continuousStay,confidence}', '') IN ('strong', 'probable')
      AND jsonb_typeof(NEW.pms_metadata #> '{continuousStay,reservationIds}') = 'array'
      AND jsonb_array_length(NEW.pms_metadata #> '{continuousStay,reservationIds}') >= 2
      AND jsonb_typeof(NEW.pms_metadata #> '{continuousStay,segments}') = 'array'
      AND jsonb_array_length(NEW.pms_metadata #> '{continuousStay,segments}') >= 2
    )
  )
)
EXECUTE FUNCTION public.hc_record_stay_extension_review();

-- Close unsupported open candidates created by the earlier snapshot-only
-- detector. A later real multi-reservation chain can reopen the same unique
-- review normally through hc_record_stay_extension_review().
UPDATE public.housekeeping_stay_extension_reviews AS review
SET status = 'resolved',
    resolution_note = coalesce(
      nullif(btrim(review.resolution_note), ''),
      'Automatically closed: no manager confirmation or linked-reservation extension evidence.'
    ),
    updated_at = now()
FROM public.rooms AS room
WHERE room.id = review.room_id
  AND review.status <> 'resolved'
  AND NOT (
    (
      coalesce(room.pms_metadata ->> 'manual_daily', 'false') = 'true'
      AND public.hc_manager_confirmation_day(coalesce(room.pms_metadata, '{}'::jsonb))
          = review.business_date
    )
    OR (
      coalesce(room.pms_metadata #>> '{continuousStay,linkedBy}', '') = 'previo_chain'
      AND coalesce(room.pms_metadata #>> '{continuousStay,confidence}', '') IN ('strong', 'probable')
      AND jsonb_typeof(room.pms_metadata #> '{continuousStay,reservationIds}') = 'array'
      AND jsonb_array_length(room.pms_metadata #> '{continuousStay,reservationIds}') >= 2
      AND jsonb_typeof(room.pms_metadata #> '{continuousStay,segments}') = 'array'
      AND jsonb_array_length(room.pms_metadata #> '{continuousStay,segments}') >= 2
    )
  );

CREATE OR REPLACE FUNCTION public.hc_acknowledge_stay_extension(
  _review_id uuid, _identity_verified boolean, _resolution_note text DEFAULT NULL,
  _resolved boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  review_record public.housekeeping_stay_extension_reviews%ROWTYPE;
BEGIN
  SELECT * INTO review_record
  FROM public.housekeeping_stay_extension_reviews
  WHERE id = _review_id
  FOR UPDATE;

  IF NOT FOUND
     OR NOT public.can_manage_next_day_housekeeping_plan(
       review_record.organization_slug,
       review_record.hotel_id
     )
  THEN
    RAISE EXCEPTION 'Not authorized for this property extension review';
  END IF;

  -- "Different guest / dismiss" is a classification decision, so the note is
  -- genuinely optional. Keep a required explanation only when a verified stay
  -- is being resolved despite having no configured service policy.
  IF _resolved
     AND _identity_verified
     AND NOT review_record.policy_configured
     AND nullif(btrim(coalesce(_resolution_note, '')), '') IS NULL
  THEN
    RAISE EXCEPTION 'Add a note describing how the stayover service was handled because this property has no configured service policy';
  END IF;

  UPDATE public.housekeeping_stay_extension_reviews
  SET status = CASE WHEN _resolved THEN 'resolved' ELSE 'acknowledged' END,
      identity_status = CASE WHEN _identity_verified THEN 'verified' ELSE 'needs_verification' END,
      acknowledged_at = now(),
      acknowledged_by = auth.uid(),
      resolution_note = nullif(btrim(_resolution_note), ''),
      updated_at = now()
  WHERE id = _review_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.hc_acknowledge_stay_extension(uuid, boolean, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hc_acknowledge_stay_extension(uuid, boolean, text, boolean) TO authenticated;
