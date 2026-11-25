-- Historical placeholder.
--
-- The original version of this migration was malformed and was never applied
-- to production. Keep the version valid so fresh databases and --include-all
-- pushes can advance past it. The actual conservative semantic deduplication,
-- cleanup and future-write guard live in:
--   20261008093000_dedupe_demand_events_v2.sql
--
-- Intentionally no schema/data changes here.
select 1;
