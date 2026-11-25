-- Compact, RLS-invoker view of *frozen* historical service facts. The
-- original snapshot's full PMS payload contains large OTA reservation notes,
-- which must not be repeatedly downloaded just to draw yesterday's badges.
CREATE OR REPLACE VIEW public.hc_housekeeping_room_service_history
WITH (security_invoker = true) AS
SELECT
  s.room_id,
  s.business_date,
  coalesce((s.final_state->>'is_checkout_room_at_close')::boolean, s.is_checkout_room, false) as is_checkout_room,
  coalesce((s.final_state->>'towel_change_required_for_assignment')::boolean,
           (s.final_state->>'towel_change_required_at_close')::boolean,
           s.towel_change_required, false) as towel_change_required,
  coalesce((s.final_state->>'linen_change_required_for_assignment')::boolean,
           (s.final_state->>'linen_change_required_at_close')::boolean,
           s.linen_change_required, false) as linen_change_required,
  coalesce(s.final_state->>'room_notes_at_close',s.room_notes) as room_notes,
  s.bed_configuration,
  jsonb_build_object(
    'manual_checkout',coalesce(s.final_state#>'{pms_metadata_at_close,manual_checkout}',s.pms_metadata->'manual_checkout')
  ) as pms_metadata,
  jsonb_build_object(
    'is_checkout_room_at_close',s.final_state->'is_checkout_room_at_close',
    'towel_change_required_for_assignment',s.final_state->'towel_change_required_for_assignment',
    'towel_change_required_at_close',s.final_state->'towel_change_required_at_close',
    'linen_change_required_for_assignment',s.final_state->'linen_change_required_for_assignment',
    'linen_change_required_at_close',s.final_state->'linen_change_required_at_close',
    'room_notes_at_close',s.final_state->'room_notes_at_close'
  ) as final_state
  , CASE WHEN lower(btrim(coalesce(s.hotel,''))) IN
      ('hotel memories budapest','memories budapest','memories-budapest')
      THEN s.scheduled_service_due ELSE NULL END AS scheduled_service_due
FROM public.housekeeping_room_snapshots s;

-- The added column comes last so old SELECT consumers remain compatible.
-- Keep invoker security on the existing snapshot RLS.
REVOKE ALL ON public.hc_housekeeping_room_service_history FROM PUBLIC, anon;
GRANT SELECT ON public.hc_housekeeping_room_service_history TO authenticated;
