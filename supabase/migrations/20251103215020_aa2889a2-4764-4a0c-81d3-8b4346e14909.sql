-- Create PMS sync history audit table
CREATE TABLE IF NOT EXISTS public.pms_sync_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type text NOT NULL CHECK (sync_type IN ('rooms', 'reservations', 'status_update', 'minibar', 'room_kinds')),
  direction text NOT NULL CHECK (direction IN ('from_previo', 'to_previo')),
  hotel_id text,
  data jsonb,
  changed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at timestamp with time zone DEFAULT now(),
  sync_status text NOT NULL CHECK (sync_status IN ('success', 'failed', 'partial')),
  error_message text,
  created_at timestamp with time zone DEFAULT now()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_pms_sync_history_hotel_id ON public.pms_sync_history(hotel_id);
CREATE INDEX IF NOT EXISTS idx_pms_sync_history_sync_type ON public.pms_sync_history(sync_type);
CREATE INDEX IF NOT EXISTS idx_pms_sync_history_created_at ON public.pms_sync_history(created_at DESC);

-- Enable RLS
ALTER TABLE public.pms_sync_history ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Admins and managers can view sync history"
ON public.pms_sync_history
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager', 'housekeeping_manager')
  )
);

CREATE POLICY "System can insert sync history"
ON public.pms_sync_history
FOR INSERT
WITH CHECK (true);

-- Add comments for documentation
COMMENT ON TABLE public.pms_sync_history IS 'Audit log for all PMS synchronization events with Previo';
COMMENT ON COLUMN public.pms_sync_history.sync_type IS 'Type of sync: rooms, reservations, status_update, minibar, room_kinds';
COMMENT ON COLUMN public.pms_sync_history.direction IS 'Data flow direction: from_previo or to_previo';
COMMENT ON COLUMN public.pms_sync_history.hotel_id IS 'Hotel identifier from Previo system';
COMMENT ON COLUMN public.pms_sync_history.data IS 'JSON data that was synced or error details';
COMMENT ON COLUMN public.pms_sync_history.sync_status IS 'Result status: success, failed, or partial';