-- Restore columns already used by the live LateMinibarApprovals workflow.
-- The frontend has referenced these fields for late minibar additions, but the
-- production room_minibar_usage table does not currently contain them. Keep
-- this migration additive and idempotent so it is safe on environments where
-- some or all columns may already exist.

alter table public.room_minibar_usage
  add column if not exists added_after_completion boolean not null default false,
  add column if not exists pending_supervisor_review boolean not null default false,
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz;

comment on column public.room_minibar_usage.added_after_completion is
  'True when minibar consumption was recorded after the related room cleaning was completed.';
comment on column public.room_minibar_usage.pending_supervisor_review is
  'True while a late minibar addition is waiting for manager/supervisor review.';
comment on column public.room_minibar_usage.reviewed_by is
  'Profile/user identifier of the supervisor who reviewed a late minibar addition.';
comment on column public.room_minibar_usage.reviewed_at is
  'Timestamp when a late minibar addition was reviewed.';

create index if not exists room_minibar_usage_pending_supervisor_review_idx
  on public.room_minibar_usage (organization_slug, usage_date desc)
  where pending_supervisor_review = true;