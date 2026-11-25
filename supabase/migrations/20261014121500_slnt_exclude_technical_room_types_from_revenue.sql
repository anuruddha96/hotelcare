-- SLNT's Previo inventory contains five operational "Technikai" placeholder
-- room kinds. They are physical PMS objects, but not guest accommodation.
-- Leave all PMS identifiers, historical bookings, maintenance/housekeeping
-- references, occupancy snapshots and pricing history untouched.
--
-- Future getObjectKinds syncs use the identical technical-kind exclusion in
-- previo-revenue-sync, so the flags will not be accidentally restored.

UPDATE public.room_types
SET is_sellable = false,
    counts_toward_inventory = false
WHERE hotel_id = 'slnt-group'
  AND lower(btrim(name)) IN ('technikai', 'technikai szoba', 'technical room', 'technical rooms')
  AND (is_sellable IS DISTINCT FROM false
       OR counts_toward_inventory IS DISTINCT FROM false);

-- Deliberately do not change hotel_revenue_settings.sellable_rooms: that
-- operational KPI denominator requires reconciliation against the hotel's
-- independently confirmed active physical room list (61 configured units).
