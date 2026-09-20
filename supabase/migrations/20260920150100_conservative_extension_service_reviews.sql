-- Pre-existing last_towel_change/last_linen_change dates can have been set by
-- the old PMS refresh and generic assignment trigger when NO service occurred.
-- Until a separate, explicit service-completion record exists, they must not
-- be used to silently dismiss potentially overdue work on an extension.
-- This trigger recomputes review suggestions from the hotel's own policies.
-- It touches only the review queue: no actual cleaning, dates or assignments.
CREATE OR REPLACE FUNCTION public.hc_review_unverified_stay_services()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  policy record;
  due_night integer;
  next_night integer;
  due_day date;
  items jsonb := '[]'::jsonb;
  upcoming jsonb := '[]'::jsonb;
  full_clean_due boolean := false;
  enabled_count integer := 0;
BEGIN
  FOR policy IN
    SELECT service_code, display_label, first_due_after_nights, repeat_every_nights
    FROM public.housekeeping_stay_service_policies
    WHERE organization_slug = NEW.organization_slug
      AND hotel_id = NEW.hotel_id AND enabled = true
    ORDER BY service_code
  LOOP
    enabled_count := enabled_count + 1;
    due_night := NULL;
    next_night := policy.first_due_after_nights;
    IF NEW.nights_completed >= policy.first_due_after_nights THEN
      due_night := policy.first_due_after_nights;
      IF policy.repeat_every_nights IS NOT NULL THEN
        due_night := due_night +
          ((NEW.nights_completed - due_night) / policy.repeat_every_nights) * policy.repeat_every_nights;
        next_night := due_night + policy.repeat_every_nights;
      ELSE
        next_night := NULL;
      END IF;
    END IF;

    IF due_night IS NOT NULL THEN
      due_day := NEW.arrival_date + due_night;
      IF due_day < NEW.revised_checkout_date THEN
        items := items || jsonb_build_array(jsonb_build_object(
          'service', policy.service_code,
          'label', policy.display_label || ' (confirm if already completed)',
          'dueNight', due_night,
          'dueDate', due_day::text,
          'completionUnverified', true
        ));
        IF policy.service_code = 'full_clean' THEN full_clean_due := true; END IF;
      END IF;
    END IF;
    IF next_night IS NOT NULL AND next_night < NEW.planned_nights THEN
      upcoming := upcoming || jsonb_build_array(jsonb_build_object(
        'service', policy.service_code, 'label', policy.display_label,
        'dueNight', next_night, 'dueDate', (NEW.arrival_date + next_night)::text
      ));
    END IF;
  END LOOP;

  -- Full clean includes towels and linen; don't show duplicate instructions.
  IF full_clean_due THEN
    SELECT coalesce(jsonb_agg(value), '[]'::jsonb) INTO items
    FROM jsonb_array_elements(items) AS service_item(value)
    WHERE value ->> 'service' = 'full_clean';
  END IF;
  NEW.services_due := items;
  NEW.next_services := upcoming;
  NEW.policy_configured := enabled_count > 0;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS hc_review_unverified_stay_services ON public.housekeeping_stay_extension_reviews;
CREATE TRIGGER hc_review_unverified_stay_services
BEFORE INSERT OR UPDATE OF services_due, nights_completed, planned_nights,
  revised_checkout_date, policy_configured
ON public.housekeeping_stay_extension_reviews FOR EACH ROW
EXECUTE FUNCTION public.hc_review_unverified_stay_services();
