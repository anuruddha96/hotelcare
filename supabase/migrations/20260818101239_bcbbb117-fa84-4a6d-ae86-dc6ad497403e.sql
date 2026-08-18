UPDATE public.pickup_snapshots
SET delta = 0, bookings_current = 0
WHERE source = 'previo_sync_diff'
  AND captured_at IN (
    '2026-08-18 09:03:22.686+00',
    '2026-08-18 09:43:08.21+00',
    '2026-08-18 07:28:28.336+00',
    '2026-08-17 05:25:47.912+00'
  )
  AND delta > 0
  AND stay_date >= (now() at time zone 'Europe/Budapest')::date + 90;