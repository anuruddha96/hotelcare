-- Initial one-time capture of all reservation-room events still present in Previo revenue facts.
-- Historical activity older than currently retained PMS facts cannot be reconstructed.
DO $backfill$ BEGIN
  PERFORM public.refresh_revenue_booking_activity_archive();
END $backfill$;
