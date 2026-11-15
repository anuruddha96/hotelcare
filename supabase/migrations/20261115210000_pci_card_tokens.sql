-- PCI Booking card tokens for Channex bookings (virtual credit cards).
-- HotelCare never stores or transits PAN/CVV: the pci-cards edge function has
-- Channex's secure endpoint fetched THROUGH PCI Booking (tokenization on
-- response), stores only the token URI + masked label here, and card details
-- are shown to authorized staff in PCI Booking's own iframe. Every view is
-- logged.

CREATE TABLE IF NOT EXISTS public.pci_card_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  reservation_id uuid REFERENCES public.reservations(id) ON DELETE SET NULL,
  channex_booking_id text NOT NULL,
  card_token_uri text NOT NULL,
  masked_label text,
  card_type text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channex_booking_id)
);

CREATE TABLE IF NOT EXISTS public.pci_card_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_token_id uuid NOT NULL REFERENCES public.pci_card_tokens(id) ON DELETE CASCADE,
  hotel_id text NOT NULL,
  viewed_by uuid NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pci_card_tokens_res ON public.pci_card_tokens(reservation_id);
CREATE INDEX IF NOT EXISTS pci_card_views_token ON public.pci_card_views(card_token_id, viewed_at DESC);

ALTER TABLE public.pci_card_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pci_card_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "PMS staff view card tokens"
ON public.pci_card_tokens FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id) AND public.has_pms_access(auth.uid()));

CREATE POLICY "PMS staff view card view log"
ON public.pci_card_views FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id) AND public.has_pms_access(auth.uid()));
-- Writes: service role only (the pci-cards edge function).
