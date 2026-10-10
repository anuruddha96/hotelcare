-- Preserve scheduled stay dates separately from affected nightly pickup.
-- Previo can return only a subset of nights for a reservation (especially
-- across rolling sync boundaries). Never infer LOS from archived room_nights.
CREATE TABLE IF NOT EXISTS public.revenue_booking_stay_context (
  hotel_id text NOT NULL,
  reservation_id text NOT NULL,
  room_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('booked','cancelled')),
  event_at timestamptz NOT NULL,
  scheduled_arrival date NOT NULL,
  scheduled_checkout date NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(hotel_id,reservation_id,room_key,kind,event_at),
  CONSTRAINT valid_previo_scheduled_stay CHECK (scheduled_checkout>scheduled_arrival),
  FOREIGN KEY (hotel_id,reservation_id,room_key,kind,event_at)
    REFERENCES public.revenue_booking_activity_archive(hotel_id,reservation_id,room_key,kind,event_at)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_revenue_stay_context_hotel ON public.revenue_booking_stay_context(hotel_id);
ALTER TABLE public.revenue_booking_stay_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.revenue_booking_stay_context FROM PUBLIC,anon,authenticated;
-- The analytics RPC below is SECURITY INVOKER and uses an explicitly scoped,
-- safe helper to aggregate this server-only table without granting direct access.
CREATE OR REPLACE FUNCTION public.refresh_revenue_booking_stay_context()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  WITH scheduled AS (
    SELECT b.hotel_id,b.res_id AS reservation_id,
      COALESCE(NULLIF(b.room_key,''),NULLIF(b.obk_id,''),NULLIF(b.room_type_name,''),'room') AS room_key,
      'booked'::text AS kind,b.created_at_pms AS event_at,
      MIN(b.stay_from) AS arrival,MAX(b.stay_to) AS checkout
    FROM public.revenue_booking_nights b
    WHERE b.created_at_pms IS NOT NULL AND b.stay_from IS NOT NULL AND b.stay_to IS NOT NULL
    GROUP BY b.hotel_id,b.res_id,COALESCE(NULLIF(b.room_key,''),NULLIF(b.obk_id,''),NULLIF(b.room_type_name,''),'room'),b.created_at_pms
    UNION ALL
    SELECT c.hotel_id,c.res_id AS reservation_id,
      COALESCE(NULLIF(c.room_key,''),NULLIF(c.obk_id,''),NULLIF(c.room_type_name,''),'room') AS room_key,
      'cancelled'::text AS kind,c.cancelled_at AS event_at,
      MIN(c.stay_from) AS arrival,MAX(c.stay_to) AS checkout
    FROM public.revenue_cancelled_nights c
    WHERE c.cancelled_at IS NOT NULL AND c.stay_from IS NOT NULL AND c.stay_to IS NOT NULL
    GROUP BY c.hotel_id,c.res_id,COALESCE(NULLIF(c.room_key,''),NULLIF(c.obk_id,''),NULLIF(c.room_type_name,''),'room'),c.cancelled_at
  ), recorded AS (
    INSERT INTO public.revenue_booking_stay_context
       (hotel_id,reservation_id,room_key,kind,event_at,scheduled_arrival,scheduled_checkout)
    SELECT s.hotel_id,s.reservation_id,s.room_key,s.kind,s.event_at,s.arrival,s.checkout
    FROM scheduled s INNER JOIN public.revenue_booking_activity_archive a
     ON a.hotel_id=s.hotel_id AND a.reservation_id=s.reservation_id AND a.room_key=s.room_key
       AND a.kind=s.kind AND a.event_at=s.event_at
    WHERE s.checkout > s.arrival AND s.checkout-s.arrival <= 366
    ON CONFLICT(hotel_id,reservation_id,room_key,kind,event_at) DO UPDATE
      SET scheduled_arrival=EXCLUDED.scheduled_arrival,
          scheduled_checkout=EXCLUDED.scheduled_checkout,observed_at=now()
    WHERE (revenue_booking_stay_context.scheduled_arrival,revenue_booking_stay_context.scheduled_checkout)
        IS DISTINCT FROM (EXCLUDED.scheduled_arrival,EXCLUDED.scheduled_checkout)
    RETURNING 1
  )
  SELECT count(*) INTO n FROM recorded;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_revenue_booking_stay_context() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_revenue_booking_stay_context() TO service_role;
-- Archive refreshes at :05 and :35. Run scheduled-date capture after each.
SELECT cron.schedule('revenue-booking-stay-context-30min','8,38 * * * *',
  'SELECT public.refresh_revenue_booking_stay_context();');
DO $backfill$ BEGIN PERFORM public.refresh_revenue_booking_stay_context(); END $backfill$;
