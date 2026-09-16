-- Multiple Laundryners may see the same room chips. Only one may finalize a
-- collection/nothing-to-collect result per Gozsdu room and Budapest work date.
-- A competing RPC runs in a single transaction, so a unique violation rolls
-- back its dirty_linen_counts changes too. No-access reports remain possible
-- from multiple staff until an authorized collector successfully completes.
create unique index if not exists gozsdu_laundry_one_completed_room_per_day
  on public.gozsdu_laundry_room_progress
  (organization_slug, hotel_id, work_date, room_id)
  where status in ('collected', 'nothing_to_collect');
