CREATE TABLE public.breakfast_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text,
  location text NOT NULL,
  stay_date date NOT NULL,
  room_number text NOT NULL,
  served_count int NOT NULL DEFAULT 0,
  guest_names text[],
  served_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_breakfast_attendance_hotel_date ON public.breakfast_attendance(hotel_id, stay_date);
CREATE INDEX idx_breakfast_attendance_loc_date ON public.breakfast_attendance(location, stay_date);

ALTER TABLE public.breakfast_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers and admins can view attendance"
  ON public.breakfast_attendance
  FOR SELECT
  USING (
    public.get_user_role_safe(auth.uid()) IN ('admin','top_management','manager','housekeeping_manager')
  );

CREATE POLICY "Admins can delete attendance"
  ON public.breakfast_attendance
  FOR DELETE
  USING (public.get_user_role_safe(auth.uid()) = 'admin');
