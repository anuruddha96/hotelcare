-- Inbound log for the Channex Open Channel receiver (channex-open-channel).
-- Each row is one changes_notification Channex pushed to us; the sandbox test
-- property only. Lets us verify on staging that ARI saved in HotelCare flows
-- out through a second channel, and is the base for a direct-booking channel.

CREATE TABLE IF NOT EXISTS public.open_channel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_code text NOT NULL,
  request_id text NOT NULL,
  unique_id uuid NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS open_channel_events_hotel_time
  ON public.open_channel_events(hotel_code, received_at DESC);

ALTER TABLE public.open_channel_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "PMS staff view open channel events"
ON public.open_channel_events FOR SELECT TO authenticated
USING (public.has_pms_access(auth.uid()));
-- Writes: service role only (the edge function).
