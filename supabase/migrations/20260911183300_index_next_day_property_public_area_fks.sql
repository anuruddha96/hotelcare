-- Cover the remaining foreign-key columns introduced for tomorrow public-area
-- planning. The primary lookup and assigned_to indexes are created in the base
-- migration; these indexes keep FK checks/joins efficient as assignment history grows.
create index if not exists idx_next_day_hk_public_area_assignments_area
  on public.next_day_housekeeping_public_area_assignments (public_area_id);

create index if not exists idx_next_day_hk_public_area_assignments_created_by
  on public.next_day_housekeeping_public_area_assignments (created_by);

create index if not exists idx_next_day_hk_public_area_assignments_updated_by
  on public.next_day_housekeeping_public_area_assignments (updated_by);
