-- Enable realtime for room status updates
ALTER TABLE public.rooms REPLICA IDENTITY FULL;
ALTER TABLE public.room_assignments REPLICA IDENTITY FULL;

-- Add realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_assignments;