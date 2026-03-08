
-- Create reservation_status enum
CREATE TYPE public.reservation_status AS ENUM (
  'pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'
);

-- Create guests table
CREATE TABLE public.guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text,
  organization_slug text,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  nationality text,
  id_document_type text,
  id_document_number text,
  date_of_birth date,
  address text,
  city text,
  country text,
  postal_code text,
  vip_status text DEFAULT 'regular',
  notes text,
  tax_id text,
  company_name text,
  preferences jsonb DEFAULT '{}'::jsonb,
  szallas_registration_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create reservations table
CREATE TABLE public.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_number text UNIQUE,
  hotel_id text,
  organization_slug text,
  guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  room_type_requested text,
  status public.reservation_status NOT NULL DEFAULT 'pending',
  check_in_date date NOT NULL,
  check_out_date date NOT NULL,
  actual_check_in timestamptz,
  actual_check_out timestamptz,
  adults integer NOT NULL DEFAULT 1,
  children integer NOT NULL DEFAULT 0,
  total_nights integer,
  rate_per_night numeric(10,2) DEFAULT 0,
  total_amount numeric(10,2) DEFAULT 0,
  currency text DEFAULT 'HUF',
  payment_status text DEFAULT 'unpaid',
  balance_due numeric(10,2) DEFAULT 0,
  source text DEFAULT 'direct',
  source_reservation_id text,
  special_requests text,
  internal_notes text,
  created_by uuid,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.reservation_room_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid REFERENCES public.reservations(id) ON DELETE CASCADE NOT NULL,
  room_id uuid REFERENCES public.rooms(id) ON DELETE CASCADE NOT NULL,
  check_in_date date NOT NULL,
  check_out_date date NOT NULL,
  status text DEFAULT 'assigned',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.rate_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text,
  organization_slug text,
  name text NOT NULL,
  room_type text,
  base_rate numeric(10,2) NOT NULL DEFAULT 0,
  currency text DEFAULT 'HUF',
  is_active boolean DEFAULT true,
  valid_from date,
  valid_to date,
  min_stay integer DEFAULT 1,
  max_stay integer,
  cancellation_policy text,
  meal_plan text DEFAULT 'room_only',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.rate_calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_plan_id uuid REFERENCES public.rate_plans(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL,
  rate numeric(10,2) NOT NULL,
  available_rooms integer,
  min_stay_override integer,
  is_closed boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rate_plan_id, date)
);

CREATE TABLE public.channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text,
  organization_slug text,
  channel_name text NOT NULL,
  channel_type text DEFAULT 'ota',
  api_endpoint text,
  api_key_ref text,
  is_active boolean DEFAULT false,
  last_sync_at timestamptz,
  sync_status text DEFAULT 'never_synced',
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.channel_rate_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid REFERENCES public.channels(id) ON DELETE CASCADE NOT NULL,
  rate_plan_id uuid REFERENCES public.rate_plans(id) ON DELETE CASCADE NOT NULL,
  channel_rate_code text,
  markup_percent numeric(5,2) DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.guest_folios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid REFERENCES public.reservations(id) ON DELETE CASCADE,
  guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  description text NOT NULL,
  amount numeric(10,2) NOT NULL DEFAULT 0,
  charge_type text DEFAULT 'room',
  charge_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Auto-generate reservation_number trigger
CREATE OR REPLACE FUNCTION public.generate_reservation_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  seq_num integer;
BEGIN
  SELECT COALESCE(MAX(
    CAST(NULLIF(SUBSTRING(reservation_number FROM '[0-9]+$'), '') AS integer)
  ), 0) + 1
  INTO seq_num
  FROM reservations
  WHERE reservation_number LIKE 'RES-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-%';
  
  NEW.reservation_number := 'RES-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(seq_num::text, 4, '0');
  NEW.total_nights := NEW.check_out_date - NEW.check_in_date;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_generate_reservation_number
  BEFORE INSERT ON public.reservations
  FOR EACH ROW
  WHEN (NEW.reservation_number IS NULL)
  EXECUTE FUNCTION public.generate_reservation_number();

-- Enable RLS
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_room_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_rate_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_folios ENABLE ROW LEVEL SECURITY;

-- Helper function
CREATE OR REPLACE FUNCTION public.has_pms_access(user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = user_id
    AND role IN ('admin', 'manager', 'reception', 'front_office', 'housekeeping_manager', 'top_management')
  );
$$;

-- RLS policies
CREATE POLICY "PMS users can view guests" ON public.guests FOR SELECT TO authenticated
  USING (has_pms_access(auth.uid()) AND (organization_slug IS NULL OR organization_slug = get_user_organization_slug(auth.uid())));
CREATE POLICY "PMS users can insert guests" ON public.guests FOR INSERT TO authenticated
  WITH CHECK (has_pms_access(auth.uid()));
CREATE POLICY "PMS users can update guests" ON public.guests FOR UPDATE TO authenticated
  USING (has_pms_access(auth.uid()));

CREATE POLICY "PMS users can view reservations" ON public.reservations FOR SELECT TO authenticated
  USING (has_pms_access(auth.uid()) AND (organization_slug IS NULL OR organization_slug = get_user_organization_slug(auth.uid())));
CREATE POLICY "PMS users can insert reservations" ON public.reservations FOR INSERT TO authenticated
  WITH CHECK (has_pms_access(auth.uid()));
CREATE POLICY "PMS users can update reservations" ON public.reservations FOR UPDATE TO authenticated
  USING (has_pms_access(auth.uid()));

CREATE POLICY "PMS users can manage reservation rooms" ON public.reservation_room_assignments FOR ALL TO authenticated
  USING (has_pms_access(auth.uid()));

CREATE POLICY "PMS users can view rate plans" ON public.rate_plans FOR SELECT TO authenticated
  USING (has_pms_access(auth.uid()));
CREATE POLICY "Managers can manage rate plans" ON public.rate_plans FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'top_management')));

CREATE POLICY "PMS users can view rate calendar" ON public.rate_calendar FOR SELECT TO authenticated
  USING (has_pms_access(auth.uid()));
CREATE POLICY "Managers can manage rate calendar" ON public.rate_calendar FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'top_management')));

CREATE POLICY "PMS users can view channels" ON public.channels FOR SELECT TO authenticated
  USING (has_pms_access(auth.uid()));
CREATE POLICY "Managers can manage channels" ON public.channels FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'top_management')));

CREATE POLICY "PMS users can view channel mappings" ON public.channel_rate_mappings FOR SELECT TO authenticated
  USING (has_pms_access(auth.uid()));
CREATE POLICY "Managers can manage channel mappings" ON public.channel_rate_mappings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'top_management')));

CREATE POLICY "PMS users can view folios" ON public.guest_folios FOR SELECT TO authenticated
  USING (has_pms_access(auth.uid()));
CREATE POLICY "PMS users can insert folios" ON public.guest_folios FOR INSERT TO authenticated
  WITH CHECK (has_pms_access(auth.uid()));

-- Indexes
CREATE INDEX idx_reservations_hotel_dates ON public.reservations(hotel_id, check_in_date, check_out_date);
CREATE INDEX idx_reservations_status ON public.reservations(status);
CREATE INDEX idx_reservations_guest ON public.reservations(guest_id);
CREATE INDEX idx_guests_org ON public.guests(organization_slug);
CREATE INDEX idx_guests_name ON public.guests(last_name, first_name);
CREATE INDEX idx_rate_calendar_date ON public.rate_calendar(date);
CREATE INDEX idx_guest_folios_reservation ON public.guest_folios(reservation_id);
