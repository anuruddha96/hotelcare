WITH bad AS (
  SELECT hotel_id, snapshot_label
  FROM public.pickup_snapshots
  WHERE source = 'previo_sync_diff'
    AND captured_at > now() - interval '30 days'
  GROUP BY hotel_id, snapshot_label
  HAVING SUM(abs(delta)) > 60
)
DELETE FROM public.pickup_snapshots ps
USING bad
WHERE ps.hotel_id = bad.hotel_id
  AND ps.snapshot_label = bad.snapshot_label
  AND ps.source = 'previo_sync_diff';