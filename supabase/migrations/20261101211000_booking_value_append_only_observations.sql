-- Append-only booking-value observations, keeping the initial snapshot and subsequent
-- changes separately. Existing PMS and revenue source rows remain untouched.
-- This is an OBSERVATION ledger, not proof of an original PMS booking price.
CREATE TABLE IF NOT EXISTS public.revenue_booking_value_observations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  reservation_fingerprint text NOT NULL,
  room_fingerprint text NOT NULL,
  booking_kind text NOT NULL CHECK (booking_kind IN ('booked','cancelled')),
  booking_event_at timestamptz,
  stay_from date,
  stay_to date,
  room_nights integer,
  observed_value_as_reported numeric,
  booking_channel text,
  observation_origin text NOT NULL
    CHECK (observation_origin IN ('baseline_observed','new_event_observed','revision_observed')),
  observed_at timestamptz NOT NULL DEFAULT now(),
  approved_for_automated_training boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS revenue_booking_value_observations_hotel_observed_idx
  ON public.revenue_booking_value_observations(hotel_id,observed_at DESC);
CREATE INDEX IF NOT EXISTS revenue_booking_value_observations_hotel_event_idx
  ON public.revenue_booking_value_observations(hotel_id,booking_event_at);

ALTER TABLE public.revenue_booking_value_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.revenue_booking_value_observations FROM PUBLIC,anon;
GRANT SELECT ON TABLE public.revenue_booking_value_observations TO authenticated;
DROP POLICY IF EXISTS revenue_booking_value_observations_read
  ON public.revenue_booking_value_observations;
CREATE POLICY revenue_booking_value_observations_read
  ON public.revenue_booking_value_observations FOR SELECT TO authenticated
  USING ((select auth.uid()) IS NOT NULL
         AND public.user_can_access_hotel((select auth.uid()),hotel_id));
COMMENT ON TABLE public.revenue_booking_value_observations IS
'Immutable pseudonymized room-value observations for booking creation/cancellation and later changes. Historic seeded baseline is NOT the original booking price. Original PMS source-currency verification is pending. Only change events are appended and no AI price usage is enabled.';

CREATE OR REPLACE FUNCTION public.capture_revenue_booking_value_observation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $capture$
BEGIN
  -- The source is updated during sync; distinguish meaningful changes from
  -- periodic unchanged refreshes to minimize writes and WAL.
  IF TG_OP = 'UPDATE' AND (
    old.value_eur, old.arrival_date, old.checkout_date, old.room_nights,
    old.source_name, old.kind
  ) IS NOT DISTINCT FROM (
    new.value_eur, new.arrival_date, new.checkout_date, new.room_nights,
    new.source_name, new.kind
  ) THEN
    RETURN new;
  END IF;
  INSERT INTO public.revenue_booking_value_observations (
    hotel_id,organization_slug,reservation_fingerprint,room_fingerprint,
    booking_kind,booking_event_at,stay_from,stay_to,room_nights,
    observed_value_as_reported,booking_channel,observation_origin
  ) VALUES (
    new.hotel_id,new.organization_slug,
    encode(extensions.digest(new.hotel_id||':'||new.reservation_id,'sha256'),'hex'),
    encode(extensions.digest(new.hotel_id||':'||new.room_key,'sha256'),'hex'),
    new.kind,new.event_at,new.arrival_date,new.checkout_date,new.room_nights,
    new.value_eur,new.source_name,
    CASE WHEN TG_OP='INSERT' THEN 'new_event_observed' ELSE 'revision_observed' END
  );
  RETURN new;
END;
$capture$;
-- Trigger function cannot be called via PostgREST by anonymous/authenticated roles.
REVOKE ALL ON FUNCTION public.capture_revenue_booking_value_observation()
  FROM PUBLIC,anon,authenticated;

-- One honest baseline of values already present today. We do NOT claim that these
-- values are the ORIGINAL booking prices, nor invent past revisions.
INSERT INTO public.revenue_booking_value_observations (
 hotel_id,organization_slug,reservation_fingerprint,room_fingerprint,
 booking_kind,booking_event_at,stay_from,stay_to,room_nights,
 observed_value_as_reported,booking_channel,observation_origin
)
SELECT hotel_id,organization_slug,
 encode(extensions.digest(hotel_id||':'||reservation_id,'sha256'),'hex'),
 encode(extensions.digest(hotel_id||':'||room_key,'sha256'),'hex'),
 kind,event_at,arrival_date,checkout_date,room_nights,
 value_eur,source_name,'baseline_observed'
FROM public.revenue_booking_activity_archive;

DROP TRIGGER IF EXISTS trg_revenue_booking_value_observation
 ON public.revenue_booking_activity_archive;
CREATE TRIGGER trg_revenue_booking_value_observation
 AFTER INSERT OR UPDATE OF value_eur,arrival_date,checkout_date,room_nights,source_name,kind
 ON public.revenue_booking_activity_archive
 FOR EACH ROW
 EXECUTE FUNCTION public.capture_revenue_booking_value_observation();
