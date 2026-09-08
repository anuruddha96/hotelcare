-- Promotions are scoped to individual billable modules.
--
-- The legacy early_bird_* columns are intentionally retained and now mean
-- Housekeeping / Operations only. This preserves existing organization data
-- while preventing an Operations promotion from leaking into Revenue plans.
-- Revenue BI and BI + Automation each get their own independent promotion.

alter table public.billing_settings
  add column if not exists revenue_bi_promo_enabled boolean not null default false,
  add column if not exists revenue_bi_promo_label text,
  add column if not exists revenue_bi_promo_note text,
  add column if not exists revenue_bi_promo_ends_at date,
  add column if not exists revenue_automation_promo_enabled boolean not null default false,
  add column if not exists revenue_automation_promo_label text,
  add column if not exists revenue_automation_promo_note text,
  add column if not exists revenue_automation_promo_ends_at date;

comment on column public.billing_settings.early_bird_enabled is
  'Legacy column retained for compatibility; scopes promotion to Operations/Housekeeping only.';
comment on column public.billing_settings.early_bird_label is
  'Legacy column retained for compatibility; Operations/Housekeeping promotion label only.';
comment on column public.billing_settings.early_bird_note is
  'Legacy column retained for compatibility; Operations/Housekeeping promotion note only.';
comment on column public.billing_settings.early_bird_ends_at is
  'Legacy column retained for compatibility; Operations/Housekeeping promotion end date only.';
comment on column public.billing_settings.revenue_bi_promo_enabled is
  'Whether the Revenue BI per-room promotion is enabled for this organization.';
comment on column public.billing_settings.revenue_automation_promo_enabled is
  'Whether the Revenue BI + Automation per-room promotion is enabled for this organization.';
