-- Trigger-only notification functions must not be callable through PostgREST.
revoke all on function public.hotelcare_notify_room_assignment() from public, anon, authenticated;
revoke all on function public.hotelcare_notify_checkout_room() from public, anon, authenticated;
revoke all on function public.hotelcare_notify_new_reservation() from public, anon, authenticated;
revoke all on function public.hotelcare_notify_revenue_automation() from public, anon, authenticated;
revoke all on function public.hotelcare_notify_housekeeping_alert() from public, anon, authenticated;
