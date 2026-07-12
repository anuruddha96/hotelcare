
-- 1) Queue table
CREATE TABLE IF NOT EXISTS public.pms_outbound_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  previo_room_id text,
  target_status text NOT NULL,           -- e.g. 'clean' | 'dirty' | 'inspected'
  source_assignment_id uuid REFERENCES public.room_assignments(id) ON DELETE SET NULL,
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending', -- pending|in_progress|succeeded|failed|cancelled
  last_error text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

GRANT SELECT ON public.pms_outbound_queue TO authenticated;
GRANT ALL ON public.pms_outbound_queue TO service_role;

ALTER TABLE public.pms_outbound_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel staff can view outbound queue"
  ON public.pms_outbound_queue
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
              p.assigned_hotel = pms_outbound_queue.hotel_id
              OR p.assigned_hotel = public.get_hotel_name_from_id(pms_outbound_queue.hotel_id)
            )
          )
        )
    )
  );

CREATE INDEX IF NOT EXISTS pms_outbound_queue_pending_idx
  ON public.pms_outbound_queue (next_attempt_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS pms_outbound_queue_hotel_idx
  ON public.pms_outbound_queue (hotel_id, status, created_at DESC);

-- 2) Trigger function: enqueue on supervisor approval, strictly gated
CREATE OR REPLACE FUNCTION public.enqueue_pms_outbound()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg record;
  v_room record;
  v_target text;
BEGIN
  -- Fire only on the false->true transition of supervisor_approved.
  IF NEW.supervisor_approved IS NOT TRUE
     OR OLD.supervisor_approved IS TRUE THEN
    RETURN NEW;
  END IF;

  SELECT r.id, r.previo_room_id, r.hotel
    INTO v_room
    FROM public.rooms r
   WHERE r.id = NEW.room_id;

  IF v_room.id IS NULL OR v_room.previo_room_id IS NULL THEN
    RETURN NEW; -- room not mapped to Previo yet
  END IF;

  SELECT status_push_enabled, outbound_kill_switch, outbound_room_allowlist
    INTO v_cfg
    FROM public.pms_configurations
   WHERE hotel_id = v_room.hotel
     AND pms_type = 'previo'
   LIMIT 1;

  IF v_cfg IS NULL
     OR COALESCE(v_cfg.status_push_enabled, false) = false
     OR COALESCE(v_cfg.outbound_kill_switch, true) = true THEN
    RETURN NEW; -- outbound disabled for this hotel
  END IF;

  -- Allowlist: must be non-empty AND contain this room id.
  IF v_cfg.outbound_room_allowlist IS NULL
     OR jsonb_typeof(v_cfg.outbound_room_allowlist) <> 'array'
     OR jsonb_array_length(v_cfg.outbound_room_allowlist) = 0
     OR NOT (v_cfg.outbound_room_allowlist ? v_room.id::text) THEN
    RETURN NEW;
  END IF;

  v_target := 'clean';

  INSERT INTO public.pms_outbound_queue (
    hotel_id, room_id, previo_room_id, target_status,
    source_assignment_id, payload
  ) VALUES (
    v_room.hotel, v_room.id, v_room.previo_room_id, v_target,
    NEW.id,
    jsonb_build_object(
      'trigger', 'supervisor_approved',
      'assignment_date', NEW.assignment_date
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_pms_outbound() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_enqueue_pms_outbound ON public.room_assignments;
CREATE TRIGGER trg_enqueue_pms_outbound
  AFTER UPDATE OF supervisor_approved ON public.room_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_pms_outbound();

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.touch_pms_outbound_queue_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_touch_pms_outbound_queue ON public.pms_outbound_queue;
CREATE TRIGGER trg_touch_pms_outbound_queue
  BEFORE UPDATE ON public.pms_outbound_queue
  FOR EACH ROW EXECUTE FUNCTION public.touch_pms_outbound_queue_updated_at();
