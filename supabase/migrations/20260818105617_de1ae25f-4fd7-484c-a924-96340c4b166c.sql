CREATE TABLE public.restaurant_webhook_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_slug text NOT NULL UNIQUE,
  hotel_id uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  secret_name text NOT NULL,
  outlet_slugs text[] NOT NULL DEFAULT ARRAY['brunch','restaurant','mitico'],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.restaurant_webhook_sources TO authenticated;
GRANT ALL ON public.restaurant_webhook_sources TO service_role;
ALTER TABLE public.restaurant_webhook_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view restaurant webhook sources"
  ON public.restaurant_webhook_sources FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.get_current_user_role() IN ('admin','top_management'));

CREATE TABLE public.restaurant_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  source_project text NOT NULL,
  source_reservation_id text NOT NULL,
  outlet_slug text NOT NULL DEFAULT 'brunch',
  guest_name text NOT NULL DEFAULT 'Guest',
  guest_email text,
  guest_phone text,
  party_size integer NOT NULL DEFAULT 2,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  service_date date NOT NULL,
  status text NOT NULL DEFAULT 'booked',
  occasion text,
  special_requests text,
  notes text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_reservations_unique_source UNIQUE (hotel_id, source_project, source_reservation_id)
);

CREATE INDEX restaurant_reservations_hotel_date_idx
  ON public.restaurant_reservations (hotel_id, service_date, starts_at);

GRANT SELECT ON public.restaurant_reservations TO authenticated;
GRANT ALL ON public.restaurant_reservations TO service_role;
ALTER TABLE public.restaurant_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view restaurant reservations of their hotel"
  ON public.restaurant_reservations FOR SELECT TO authenticated
  USING (public.user_can_access_hotel(auth.uid(), hotel_id::text));

CREATE TRIGGER restaurant_reservations_updated_at
  BEFORE UPDATE ON public.restaurant_reservations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.restaurant_webhook_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_slug text,
  outcome text NOT NULL,
  http_status integer NOT NULL,
  message text,
  source_reservation_id text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.restaurant_webhook_log TO authenticated;
GRANT ALL ON public.restaurant_webhook_log TO service_role;
ALTER TABLE public.restaurant_webhook_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view restaurant webhook log"
  ON public.restaurant_webhook_log FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.get_current_user_role() IN ('admin','top_management'));

INSERT INTO public.restaurant_webhook_sources (property_slug, hotel_id, secret_name)
VALUES ('memories', '36878e25-90e4-481f-98bd-b9615bc6d183', 'RESTAURANT_WEBHOOK_SECRET_MEMORIES');