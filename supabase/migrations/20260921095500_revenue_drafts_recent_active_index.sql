-- Applied to production as revenue_drafts_recent_active_index on 2026-09-21.
-- Rate-grid draft reads filter hotel/stay_date/superseded_at and order by
-- created_at DESC LIMIT n. Previously scanned/sorted ~500k rows (21.2s for
-- Ottofiori's 500-row sample). This index returns the same rows in ~58ms.
-- Do not delete historical drafts: they are needed for auditing.
CREATE INDEX IF NOT EXISTS idx_rrd_active_recent_hotel
  ON public.revenue_rate_drafts (hotel_id, created_at DESC)
  INCLUDE (stay_date)
  WHERE superseded_at IS NULL;
