
-- 1. pms_change_events table
CREATE TABLE IF NOT EXISTS public.pms_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  room_id uuid REFERENCES public.rooms(id) ON DELETE CASCADE,
  room_label text,
  event_type text NOT NULL,
  source text NOT NULL DEFAULT 'pms_sync',
  before jsonb,
  after jsonb,
  previo_reservation_id text,
  is_conflict boolean NOT NULL DEFAULT false,
  conflicts_with_assignment_id uuid,
  detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  resolution text,
  notes text
);

CREATE INDEX IF NOT EXISTS pms_change_events_hotel_detected_idx
  ON public.pms_change_events (hotel_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS pms_change_events_room_idx
  ON public.pms_change_events (room_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS pms_change_events_unacked_idx
  ON public.pms_change_events (hotel_id, is_conflict, acknowledged_at)
  WHERE acknowledged_at IS NULL;

ALTER TABLE public.pms_change_events ENABLE ROW LEVEL SECURITY;

-- Managers / admins of the hotel can read events
CREATE POLICY "Hotel staff can view pms change events"
  ON public.pms_change_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin','top_management')
          OR (
            p.role IN ('manager','housekeeping_manager','front_office')
            AND (
              p.assigned_hotel = pms_change_events.hotel_id
              OR p.assigned_hotel = public.get_hotel_name_from_id(pms_change_events.hotel_id)
            )
          )
        )
    )
  );

-- Managers / admins can acknowledge / resolve events
CREATE POLICY "Hotel staff can resolve pms change events"
  ON public.pms_change_events
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin','top_management')
          OR (
            p.role IN ('manager','housekeeping_manager','front_office')
            AND (
              p.assigned_hotel = pms_change_events.hotel_id
              OR p.assigned_hotel = public.get_hotel_name_from_id(pms_change_events.hotel_id)
            )
          )
        )
    )
  );

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.pms_change_events;
ALTER TABLE public.pms_change_events REPLICA IDENTITY FULL;

-- 2. pms_hold on room_assignments
ALTER TABLE public.room_assignments
  ADD COLUMN IF NOT EXISTS pms_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pms_hold_reason text,
  ADD COLUMN IF NOT EXISTS pms_hold_event_id uuid;

CREATE INDEX IF NOT EXISTS room_assignments_pms_hold_idx
  ON public.room_assignments (room_id, assignment_date)
  WHERE pms_hold = true;
