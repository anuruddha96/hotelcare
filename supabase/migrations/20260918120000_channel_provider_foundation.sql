-- Staged schema only. Deploy AFTER reviewing existing hotel identifiers, policies and OTA agreements.
-- This migration does not switch a hotel's live channel manager or send data to an OTA.

CREATE TABLE IF NOT EXISTS public.hotel_channel_provider_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text NOT NULL,
  provider text NOT NULL DEFAULT 'previo' CHECK (provider IN ('previo', 'hotelcare')),
  mode text NOT NULL DEFAULT 'read_only' CHECK (mode IN ('read_only', 'shadow', 'live')),
  writes_enabled boolean NOT NULL DEFAULT false,
  activation_verified_at timestamptz,
  previous_provider text CHECK (previous_provider IS NULL OR previous_provider IN ('previo', 'hotelcare')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_channel_provider_one_owner UNIQUE (organization_slug, hotel_id),
  CONSTRAINT hotel_channel_provider_no_unverified_writes CHECK (
    NOT writes_enabled OR (provider = 'hotelcare' AND mode = 'live' AND activation_verified_at IS NOT NULL)
  )
);

ALTER TABLE public.hotel_channel_provider_settings ENABLE ROW LEVEL SECURITY;
-- The authenticated application can READ its hotel's provider state, but it cannot
-- enable outbound OTA writes: only a vetted privileged backend may change this table.
CREATE POLICY hotel_channel_provider_select ON public.hotel_channel_provider_settings
  FOR SELECT TO authenticated
  USING (public.can_access_pms_hotel(auth.uid(), hotel_id, organization_slug));
REVOKE ALL ON public.hotel_channel_provider_settings FROM anon, authenticated;
GRANT SELECT ON public.hotel_channel_provider_settings TO authenticated;
GRANT ALL ON public.hotel_channel_provider_settings TO service_role;

-- Exactly-once is not guaranteed by an external OTA. Keys protect against
-- duplicate jobs locally; the provider must also support safe replay/reconciliation.
CREATE TABLE IF NOT EXISTS public.hotel_channel_delivery_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text NOT NULL,
  channel_name text NOT NULL,
  event_kind text NOT NULL CHECK (event_kind IN ('availability', 'rate', 'restriction', 'reservation_ack')),
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivery_status text NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'processing', 'delivered', 'failed', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_channel_delivery_idempotency UNIQUE (organization_slug, hotel_id, channel_name, idempotency_key)
);

CREATE INDEX IF NOT EXISTS hotel_channel_delivery_pending_idx
  ON public.hotel_channel_delivery_outbox (next_attempt_at, created_at)
  WHERE delivery_status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS hotel_channel_delivery_property_idx
  ON public.hotel_channel_delivery_outbox (organization_slug, hotel_id, created_at DESC);

ALTER TABLE public.hotel_channel_delivery_outbox ENABLE ROW LEVEL SECURITY;
-- Guest-bearing delivery payloads must never be exposed to browser clients.
REVOKE ALL ON public.hotel_channel_delivery_outbox FROM anon, authenticated;
GRANT ALL ON public.hotel_channel_delivery_outbox TO service_role;

COMMENT ON TABLE public.hotel_channel_provider_settings IS
  'Property-scoped CHM provider choice. Read-only default; no client-side activation or OTA credentials.';
COMMENT ON TABLE public.hotel_channel_delivery_outbox IS
  'Privileged channel delivery queue. No worker or OTA connector is activated by this migration.';
